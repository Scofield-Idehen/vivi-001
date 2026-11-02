-- The booking website (2 Nov 2026).

-- Bookings made on it: the operator's own rows, by home, audited.
SELECT app.enable_tenant_rls('app.site_bookings', 'SELECT, INSERT, UPDATE');
--> statement-breakpoint
CREATE POLICY home_access ON app.site_bookings AS RESTRICTIVE USING
  ((SELECT app.my_homes()) IS NULL OR property_id = ANY ((SELECT app.my_homes())::uuid[]));
--> statement-breakpoint
CREATE TRIGGER site_bookings_audit AFTER INSERT OR UPDATE OR DELETE ON app.site_bookings
  FOR EACH ROW EXECUTE FUNCTION app.audit_row();
--> statement-breakpoint
CREATE TRIGGER site_bookings_touch BEFORE UPDATE ON app.site_bookings
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
--> statement-breakpoint

-- A service fee of at most 20%.
ALTER TABLE app.organisation_settings ADD CONSTRAINT organisation_settings_booking_fee
  CHECK (booking_service_fee_bp IS NULL OR booking_service_fee_bp BETWEEN 1 AND 2000);
--> statement-breakpoint
ALTER TABLE app.organisation_settings ADD CONSTRAINT organisation_settings_booking_terms_length
  CHECK (booking_terms IS NULL OR char_length(booking_terms) <= 8000);
--> statement-breakpoint

-- A home whose channels Guesty still runs can't be on the site: a booking made there would not
-- close its nights on Airbnb or Booking.com.
ALTER TABLE app.properties ADD CONSTRAINT properties_booking_site_managed
  CHECK (NOT on_booking_site OR managed_by <> 'guesty');
--> statement-breakpoint

-- Which operator a booking website address belongs to, only while its site is switched on.
-- Nothing else about the operator is returned; the API reads the site in that operator's scope.
CREATE OR REPLACE FUNCTION app.booking_site_org(p_slug text)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp
AS $$
  SELECT o.id
    FROM app.organisations o
    JOIN app.organisation_settings s ON s.organisation_id = o.id
   WHERE o.slug = p_slug AND s.booking_site
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.booking_site_org(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.booking_site_org(text) TO app_api;
