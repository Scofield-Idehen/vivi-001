-- Security layer: roles, row-level security, the double-booking guard, the audit trail,
-- and the few narrow system functions the worker uses.
--
-- Rules for every later migration (checked by packages/db/test/security-coverage.test.ts):
--   * A new operator table carries organisation_id and calls app.enable_tenant_rls().
--   * A new function in schema app is revoked from PUBLIC and granted explicitly.

-- Extensions -------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS extensions;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;
--> statement-breakpoint

-- Roles ------------------------------------------------------------------------------
-- Created without login. `pnpm db:roles` turns login on with passwords from the environment.
--   app_base    group role holding table privileges; never logs in
--   app_api     the Node API
--   app_worker  the Node worker; also runs the sys_* functions
--   app_jobs    pg-boss; owns only its own job tables, sees nothing in schema app
-- None of them can bypass row-level security.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_base') THEN
    CREATE ROLE app_base NOLOGIN NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_api') THEN
    CREATE ROLE app_api NOLOGIN NOBYPASSRLS IN ROLE app_base;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_worker') THEN
    CREATE ROLE app_worker NOLOGIN NOBYPASSRLS IN ROLE app_base;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_jobs') THEN
    CREATE ROLE app_jobs NOLOGIN NOBYPASSRLS;
  END IF;
END
$$;
--> statement-breakpoint
REVOKE ALL ON SCHEMA app FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA app TO app_base;
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS pgboss;
--> statement-breakpoint
GRANT USAGE, CREATE ON SCHEMA pgboss TO app_jobs;
--> statement-breakpoint
DO $$
BEGIN
  -- pg-boss keeps its own schema; it is made above. On Supabase the postgres role does not own the
  -- database, so this extra grant is skipped there rather than failing the migration.
  EXECUTE format('GRANT CREATE ON DATABASE %I TO app_jobs', current_database());
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'Skipped GRANT CREATE ON DATABASE for app_jobs (not the database owner)';
END
$$;
--> statement-breakpoint

-- Scope -------------------------------------------------------------------------------
-- The API and worker set these per transaction (packages/db/src/client.ts).
-- Unset means NULL, and NULL matches no operator, so a forgotten scope returns nothing.
CREATE OR REPLACE FUNCTION app.current_org_id() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE
AS $$ SELECT nullif(current_setting('app.org_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE
AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint

-- Standard operator isolation: rows are visible and writable only inside their operator's scope.
CREATE OR REPLACE FUNCTION app.enable_tenant_rls(
  p_table regclass,
  p_privileges text DEFAULT 'SELECT, INSERT, UPDATE, DELETE'
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', p_table);
  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %s', p_table);
  EXECUTE format(
    'CREATE POLICY tenant_isolation ON %s USING (organisation_id = app.current_org_id()) '
    'WITH CHECK (organisation_id = app.current_org_id())',
    p_table
  );
  EXECUTE format('REVOKE ALL ON %s FROM app_base', p_table);
  IF p_privileges <> '' THEN
    EXECUTE format('GRANT %s ON %s TO app_base', p_privileges, p_table);
  END IF;
END
$$;
--> statement-breakpoint
SELECT app.enable_tenant_rls('app.organisation_settings', 'SELECT, UPDATE');
--> statement-breakpoint
SELECT app.enable_tenant_rls('app.organisation_brand', 'SELECT, UPDATE');
--> statement-breakpoint
SELECT app.enable_tenant_rls('app.invitations');
--> statement-breakpoint
SELECT app.enable_tenant_rls('app.properties', 'SELECT, INSERT, UPDATE');
--> statement-breakpoint
SELECT app.enable_tenant_rls('app.channel_accounts', 'SELECT, INSERT, UPDATE');
--> statement-breakpoint
SELECT app.enable_tenant_rls('app.channel_listings', 'SELECT, INSERT, UPDATE');
--> statement-breakpoint
SELECT app.enable_tenant_rls('app.channex_mappings', 'SELECT, INSERT, UPDATE');
--> statement-breakpoint
SELECT app.enable_tenant_rls('app.channex_channels', 'SELECT, INSERT, UPDATE');
--> statement-breakpoint
SELECT app.enable_tenant_rls('app.guests', 'SELECT, INSERT, UPDATE');
--> statement-breakpoint
-- Bookings are never hard-deleted; cancellations change status.
SELECT app.enable_tenant_rls('app.reservations', 'SELECT, INSERT, UPDATE');
--> statement-breakpoint
SELECT app.enable_tenant_rls('app.channex_bookings', 'SELECT, INSERT, UPDATE');
--> statement-breakpoint
SELECT app.enable_tenant_rls('app.reservation_revisions', 'SELECT, INSERT, UPDATE');
--> statement-breakpoint
SELECT app.enable_tenant_rls('app.blocks');
--> statement-breakpoint
-- Written only by triggers.
SELECT app.enable_tenant_rls('app.occupancies', 'SELECT');
--> statement-breakpoint
SELECT app.enable_tenant_rls('app.ari_outbox', 'SELECT, INSERT, UPDATE');
--> statement-breakpoint
SELECT app.enable_tenant_rls('app.sync_log', 'SELECT, INSERT');
--> statement-breakpoint
-- Written only by triggers; nobody can edit or delete history.
SELECT app.enable_tenant_rls('app.audit_log', 'SELECT');
--> statement-breakpoint

-- Operators: a person sees the operators they belong to; changes only inside the current scope.
ALTER TABLE app.organisations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY organisations_member_read ON app.organisations FOR SELECT
  USING (
    id = app.current_org_id()
    OR id IN (SELECT m.organisation_id FROM app.memberships m WHERE m.user_id = app.current_user_id())
  );
--> statement-breakpoint
CREATE POLICY organisations_update ON app.organisations FOR UPDATE
  USING (id = app.current_org_id()) WITH CHECK (id = app.current_org_id());
--> statement-breakpoint
GRANT SELECT ON app.organisations TO app_base;
--> statement-breakpoint
GRANT UPDATE (name, legal_name) ON app.organisations TO app_base;
--> statement-breakpoint

-- People: you see yourself and the people in your current operator; you write only your own row.
ALTER TABLE app.app_users ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY app_users_read ON app.app_users FOR SELECT
  USING (
    id = app.current_user_id()
    OR id IN (SELECT m.user_id FROM app.memberships m WHERE m.organisation_id = app.current_org_id())
  );
--> statement-breakpoint
CREATE POLICY app_users_insert_self ON app.app_users FOR INSERT
  WITH CHECK (id = app.current_user_id());
--> statement-breakpoint
CREATE POLICY app_users_update_self ON app.app_users FOR UPDATE
  USING (id = app.current_user_id()) WITH CHECK (id = app.current_user_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON app.app_users TO app_base;
--> statement-breakpoint

-- Memberships: your own across operators, everyone's inside the current operator.
ALTER TABLE app.memberships ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY memberships_read ON app.memberships FOR SELECT
  USING (user_id = app.current_user_id() OR organisation_id = app.current_org_id());
--> statement-breakpoint
CREATE POLICY memberships_insert ON app.memberships FOR INSERT
  WITH CHECK (organisation_id = app.current_org_id());
--> statement-breakpoint
CREATE POLICY memberships_update ON app.memberships FOR UPDATE
  USING (organisation_id = app.current_org_id()) WITH CHECK (organisation_id = app.current_org_id());
--> statement-breakpoint
CREATE POLICY memberships_delete ON app.memberships FOR DELETE
  USING (organisation_id = app.current_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON app.memberships TO app_base;
--> statement-breakpoint

-- Webhook inbox: a platform table with no operator until the worker resolves one.
-- The API may only insert; the worker reads and updates. Nobody else.
GRANT INSERT ON app.webhook_events TO app_api;
--> statement-breakpoint
GRANT SELECT, UPDATE ON app.webhook_events TO app_worker;
--> statement-breakpoint

-- Double-booking guard ------------------------------------------------------------------
-- Postgres refuses two confirmed stays or blocks on the same property whose nights overlap,
-- whatever the application code does. Nights are [check_in, check_out): a departure and an
-- arrival on the same day do not overlap. A refused booking raises SQLSTATE 23P01.
ALTER TABLE app.occupancies
  ADD CONSTRAINT occupancies_no_overlap EXCLUDE USING gist (property_id WITH =, nights WITH &&);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.sync_reservation_occupancy() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM app.occupancies WHERE source_type = 'reservation' AND source_id = OLD.id;
    RETURN OLD;
  END IF;
  IF NEW.status = 'confirmed' THEN
    INSERT INTO app.occupancies (organisation_id, property_id, nights, source_type, source_id)
    VALUES (NEW.organisation_id, NEW.property_id, daterange(NEW.check_in, NEW.check_out, '[)'),
            'reservation', NEW.id)
    ON CONFLICT (source_type, source_id) DO UPDATE
      SET organisation_id = EXCLUDED.organisation_id,
          property_id = EXCLUDED.property_id,
          nights = EXCLUDED.nights;
  ELSE
    DELETE FROM app.occupancies WHERE source_type = 'reservation' AND source_id = NEW.id;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER reservations_occupancy
  AFTER INSERT OR UPDATE OF status, check_in, check_out, property_id OR DELETE ON app.reservations
  FOR EACH ROW EXECUTE FUNCTION app.sync_reservation_occupancy();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.sync_block_occupancy() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM app.occupancies WHERE source_type = 'block' AND source_id = OLD.id;
    RETURN OLD;
  END IF;
  INSERT INTO app.occupancies (organisation_id, property_id, nights, source_type, source_id)
  VALUES (NEW.organisation_id, NEW.property_id, daterange(NEW.starts_on, NEW.ends_on, '[)'),
          'block', NEW.id)
  ON CONFLICT (source_type, source_id) DO UPDATE
    SET organisation_id = EXCLUDED.organisation_id,
        property_id = EXCLUDED.property_id,
        nights = EXCLUDED.nights;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER blocks_occupancy
  AFTER INSERT OR UPDATE OF starts_on, ends_on, property_id OR DELETE ON app.blocks
  FOR EACH ROW EXECUTE FUNCTION app.sync_block_occupancy();
--> statement-breakpoint

-- Audit trail --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.audit_row() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp
AS $$
DECLARE
  v_row jsonb := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
BEGIN
  IF TG_OP = 'UPDATE' AND (to_jsonb(OLD) - 'updated_at') = (to_jsonb(NEW) - 'updated_at') THEN
    RETURN NULL;
  END IF;
  INSERT INTO app.audit_log (organisation_id, actor_user_id, action, entity_type, entity_id, before, after)
  VALUES (
    (v_row ->> 'organisation_id')::uuid,
    app.current_user_id(),
    lower(TG_OP),
    TG_TABLE_NAME,
    (v_row ->> 'id')::uuid,
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END
  );
  RETURN NULL;
END
$$;
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'organisation_settings', 'organisation_brand', 'memberships', 'invitations', 'properties',
    'channel_accounts', 'channel_listings', 'channex_mappings', 'channex_channels',
    'reservations', 'blocks'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.audit_row()',
      t || '_audit', t
    );
  END LOOP;
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'organisations', 'organisation_settings', 'organisation_brand', 'properties',
    'channel_accounts', 'channel_listings', 'reservations'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at()',
      t || '_touch', t
    );
  END LOOP;
END
$$;
--> statement-breakpoint

-- Sign-in --------------------------------------------------------------------------------
-- Turns pending invitations for an email into memberships. Called by the API after it has
-- verified the person's sign-in token, so the email is trusted.
CREATE OR REPLACE FUNCTION app.accept_invitations(p_user_id uuid, p_email text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  INSERT INTO app.memberships (organisation_id, user_id, role)
  SELECT DISTINCT ON (i.organisation_id) i.organisation_id, p_user_id, i.role
    FROM app.invitations i
   WHERE lower(i.email) = lower(p_email)
     AND i.accepted_at IS NULL
     AND (i.expires_at IS NULL OR i.expires_at > now())
   ORDER BY i.organisation_id, i.created_at DESC
  ON CONFLICT (organisation_id, user_id) DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE app.invitations
     SET accepted_at = now(), accepted_by = p_user_id
   WHERE lower(email) = lower(p_email)
     AND accepted_at IS NULL
     AND (expires_at IS NULL OR expires_at > now());
  RETURN v_count;
END
$$;
--> statement-breakpoint

-- Worker system functions -----------------------------------------------------------------
-- The only paths that cross operators. Each returns the operator id with every row, and the
-- worker then does the real work inside that operator's scope.
CREATE OR REPLACE FUNCTION app.sys_claim_outbox(p_limit integer)
RETURNS TABLE (
  id bigint, organisation_id uuid, property_id uuid, kind app.outbox_kind,
  date_from date, date_to date, attempts integer
)
LANGUAGE sql SECURITY DEFINER SET search_path = app, pg_temp
AS $$
  WITH due AS (
    SELECT o.id
      FROM app.ari_outbox o
     WHERE (o.status = 'pending' AND o.next_attempt_at <= now())
        OR (o.status = 'sending' AND o.locked_at < now() - interval '10 minutes')
     ORDER BY o.next_attempt_at, o.id
     LIMIT p_limit
     FOR UPDATE SKIP LOCKED
  )
  UPDATE app.ari_outbox o
     SET status = 'sending', locked_at = now(), attempts = o.attempts + 1
    FROM due
   WHERE o.id = due.id
  RETURNING o.id, o.organisation_id, o.property_id, o.kind, o.date_from, o.date_to, o.attempts;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.sys_claim_webhook_events(p_limit integer)
RETURNS TABLE (
  id bigint, provider text, event text, external_property_id text, payload jsonb, attempts integer
)
LANGUAGE sql SECURITY DEFINER SET search_path = app, pg_temp
AS $$
  WITH due AS (
    SELECT w.id
      FROM app.webhook_events w
     WHERE w.processed_at IS NULL
       AND w.attempts < 20
       AND (w.locked_at IS NULL OR w.locked_at < now() - interval '5 minutes')
     ORDER BY w.received_at, w.id
     LIMIT p_limit
     FOR UPDATE SKIP LOCKED
  )
  UPDATE app.webhook_events w
     SET locked_at = now(), attempts = w.attempts + 1
    FROM due
   WHERE w.id = due.id
  RETURNING w.id, w.provider, w.event, w.external_property_id, w.payload, w.attempts;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.sys_resolve_channex_property(p_channex_property_id text)
RETURNS TABLE (organisation_id uuid, property_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp
AS $$
  SELECT m.organisation_id, m.property_id
    FROM app.channex_mappings m
   WHERE m.channex_property_id = p_channex_property_id;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.sys_list_organisations()
RETURNS TABLE (id uuid, name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp
AS $$
  SELECT o.id, o.name FROM app.organisations o ORDER BY o.name;
$$;
--> statement-breakpoint

-- Function privileges: nothing in schema app is callable by PUBLIC.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.current_org_id(), app.current_user_id() TO app_base;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.accept_invitations(uuid, text) TO app_api;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION
  app.sys_claim_outbox(integer),
  app.sys_claim_webhook_events(integer),
  app.sys_resolve_channex_property(text),
  app.sys_list_organisations()
TO app_worker;
