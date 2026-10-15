-- Changes reach the channels through the outbox, queued by the database in the same transaction as
-- the change itself, so a saved change is never lost and no code path can forget to send one.
-- Only properties V-01 runs (managed_by = 'v01') queue anything: a property still on Guesty, or not
-- connected yet, sends nothing to Airbnb, Booking.com or Vrbo (decision of 14 October 2026).
-- The worker trims each queued range to the nights from today, where the operator is.

-- Queues one range of nights for one property, if V-01 runs its channels. Called only by the
-- trigger functions below, which run as the owner; no application role may call it.
CREATE OR REPLACE FUNCTION app.queue_for_channels(
  p_property uuid,
  p_kind app.outbox_kind,
  p_from date,
  p_to date
) RETURNS void
LANGUAGE sql
SET search_path = app, pg_temp
AS $$
  INSERT INTO app.ari_outbox (organisation_id, property_id, kind, date_from, date_to)
  SELECT p.organisation_id, p.id, p_kind, p_from, p_to
    FROM app.properties p
   WHERE p.id = p_property
     AND p.managed_by = 'v01'
     AND p.archived_at IS NULL
     AND p_from <= p_to;
$$;
--> statement-breakpoint

-- Bookings and blocks: whenever nights are held or released, availability goes out for them.
-- A changed stay queues both its old and its new nights.
CREATE OR REPLACE FUNCTION app.queue_occupancy_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.property_id = OLD.property_id AND NEW.nights = OLD.nights THEN
    RETURN NULL;
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM app.queue_for_channels(OLD.property_id, 'availability', lower(OLD.nights), upper(OLD.nights) - 1);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM app.queue_for_channels(NEW.property_id, 'availability', lower(NEW.nights), upper(NEW.nights) - 1);
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER occupancies_queue AFTER INSERT OR UPDATE OR DELETE ON app.occupancies
  FOR EACH ROW EXECUTE FUNCTION app.queue_occupancy_change();
--> statement-breakpoint

-- Nightly prices and stay rules: one queued range per property per statement, however many nights
-- the statement changed. Postgres allows one event per trigger that reads the changed rows, so there
-- are three triggers sharing this function.
CREATE OR REPLACE FUNCTION app.queue_calendar_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO app.ari_outbox (organisation_id, property_id, kind, date_from, date_to)
    SELECT p.organisation_id, p.id, 'restrictions', min(c.night), max(c.night)
      FROM new_rows c JOIN app.properties p ON p.id = c.property_id
     WHERE p.managed_by = 'v01' AND p.archived_at IS NULL
     GROUP BY p.organisation_id, p.id;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO app.ari_outbox (organisation_id, property_id, kind, date_from, date_to)
    SELECT p.organisation_id, p.id, 'restrictions', min(c.night), max(c.night)
      FROM (SELECT property_id, night FROM new_rows
            UNION ALL
            SELECT property_id, night FROM old_rows) c
      JOIN app.properties p ON p.id = c.property_id
     WHERE p.managed_by = 'v01' AND p.archived_at IS NULL
     GROUP BY p.organisation_id, p.id;
  ELSE
    INSERT INTO app.ari_outbox (organisation_id, property_id, kind, date_from, date_to)
    SELECT p.organisation_id, p.id, 'restrictions', min(c.night), max(c.night)
      FROM old_rows c JOIN app.properties p ON p.id = c.property_id
     WHERE p.managed_by = 'v01' AND p.archived_at IS NULL
     GROUP BY p.organisation_id, p.id;
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER calendar_days_queue_insert AFTER INSERT ON app.calendar_days
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION app.queue_calendar_change();
--> statement-breakpoint
CREATE TRIGGER calendar_days_queue_update AFTER UPDATE ON app.calendar_days
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION app.queue_calendar_change();
--> statement-breakpoint
CREATE TRIGGER calendar_days_queue_delete AFTER DELETE ON app.calendar_days
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION app.queue_calendar_change();
--> statement-breakpoint

-- A property's usual price, price limits or stay lengths: every night ahead without its own rules
-- changes, so the whole horizon goes again (500 nights, as Channex's full sync; a day either side
-- covers any time zone, and the worker trims it).
CREATE OR REPLACE FUNCTION app.queue_usual_rules_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp
AS $$
BEGIN
  IF (NEW.base_price_minor, NEW.weekend_price_minor, NEW.min_price_minor, NEW.max_price_minor,
      NEW.min_nights, NEW.max_nights, NEW.price_owner)
     IS DISTINCT FROM
     (OLD.base_price_minor, OLD.weekend_price_minor, OLD.min_price_minor, OLD.max_price_minor,
      OLD.min_nights, OLD.max_nights, OLD.price_owner) THEN
    PERFORM app.queue_for_channels(NEW.id, 'restrictions', current_date - 1, current_date + 500);
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER properties_queue_rules AFTER UPDATE ON app.properties
  FOR EACH ROW EXECUTE FUNCTION app.queue_usual_rules_change();
--> statement-breakpoint

-- Nothing in schema app is callable by PUBLIC. Triggers fire whoever changes the rows.
REVOKE ALL ON FUNCTION
  app.queue_for_channels(uuid, app.outbox_kind, date, date),
  app.queue_occupancy_change(),
  app.queue_calendar_change(),
  app.queue_usual_rules_change()
FROM PUBLIC;
