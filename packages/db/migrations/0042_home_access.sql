-- Access by home and the owner log-in (1 Nov 2026).
--
-- A person can be limited to some homes (memberships.homes_limited + member_homes), and an owner
-- who logs in sees only their own homes (memberships.owner_id, role 'owner'). Row-level security
-- enforces both: every table that belongs to a home gets a second, RESTRICTIVE policy on top of
-- the operator policy, so a query that forgets to filter still only returns the person's homes.
-- Everyone else (and the worker, which has no user) sees every home, as before.

ALTER TABLE app.memberships
  ADD CONSTRAINT memberships_owner_fk FOREIGN KEY (owner_id) REFERENCES app.owners (id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE app.invitations
  ADD CONSTRAINT invitations_owner_fk FOREIGN KEY (owner_id) REFERENCES app.owners (id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE app.member_homes
  ADD CONSTRAINT member_homes_membership_fk FOREIGN KEY (organisation_id, user_id)
  REFERENCES app.memberships (organisation_id, user_id) ON DELETE CASCADE;
--> statement-breakpoint
SELECT app.enable_tenant_rls('app.member_homes', 'SELECT, INSERT, DELETE');
--> statement-breakpoint
CREATE TRIGGER member_homes_audit AFTER INSERT OR UPDATE OR DELETE ON app.member_homes
  FOR EACH ROW EXECUTE FUNCTION app.audit_row();
--> statement-breakpoint

-- The homes the current person may see in the current operator, or NULL for every home.
-- Policies call it as `(SELECT app.my_homes())` so Postgres works it out once per query.
-- The role is compared as text: the 'owner' value is added in the same migration run.
CREATE OR REPLACE FUNCTION app.my_homes() RETURNS uuid[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp
AS $$
DECLARE
  m record;
BEGIN
  SELECT role::text AS role, homes_limited, owner_id INTO m
    FROM app.memberships
   WHERE organisation_id = app.current_org_id() AND user_id = app.current_user_id();
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF m.role = 'owner' THEN
    RETURN coalesce(
      (SELECT array_agg(p.id) FROM app.properties p
        WHERE p.organisation_id = app.current_org_id() AND p.owner_id = m.owner_id),
      '{}'::uuid[]);
  END IF;
  IF m.homes_limited THEN
    RETURN coalesce(
      (SELECT array_agg(h.property_id) FROM app.member_homes h
        WHERE h.organisation_id = app.current_org_id() AND h.user_id = app.current_user_id()),
      '{}'::uuid[]);
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.my_homes() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.my_homes() TO app_base;
--> statement-breakpoint

-- A guest is visible when one of their stays is in a visible home, or they have no stay yet
-- (a guest is saved just before their booking).
CREATE OR REPLACE FUNCTION app.guest_visible(p_guest uuid, p_homes uuid[]) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM app.reservations r WHERE r.guest_id = p_guest AND r.property_id = ANY (p_homes))
      OR NOT EXISTS (SELECT 1 FROM app.reservations r WHERE r.guest_id = p_guest)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.guest_visible(uuid, uuid[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.guest_visible(uuid, uuid[]) TO app_base;
--> statement-breakpoint

DO $$
DECLARE
  t text;
BEGIN
  -- Tables with the home in property_id. A record with no home is hidden from someone limited.
  FOREACH t IN ARRAY ARRAY[
    'ari_outbox', 'blocks', 'calendar_days', 'channel_listings', 'channex_mappings', 'channex_setups',
    'guesty_listings', 'guesty_channel_listings', 'message_threads', 'occupancies',
    'property_amenities', 'property_field_values', 'property_photos', 'property_rooms',
    'reservations', 'tasks', 'locks', 'sync_log', 'expenses', 'member_homes'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY home_access ON app.%I AS RESTRICTIVE USING '
      '((SELECT app.my_homes()) IS NULL OR property_id = ANY ((SELECT app.my_homes())::uuid[]))',
      t
    );
  END LOOP;
  -- Tables that belong to a booking.
  FOREACH t IN ARRAY ARRAY[
    'channex_bookings', 'reservation_revisions', 'reservation_charges', 'reservation_payments',
    'claims', 'guesty_reservations'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY home_access ON app.%I AS RESTRICTIVE USING '
      '((SELECT app.my_homes()) IS NULL OR EXISTS (SELECT 1 FROM app.reservations r WHERE r.id = reservation_id))',
      t
    );
  END LOOP;
END
$$;
--> statement-breakpoint
CREATE POLICY home_access ON app.properties AS RESTRICTIVE USING
  ((SELECT app.my_homes()) IS NULL OR id = ANY ((SELECT app.my_homes())::uuid[]));
--> statement-breakpoint
CREATE POLICY home_access ON app.claim_items AS RESTRICTIVE USING
  ((SELECT app.my_homes()) IS NULL OR EXISTS (SELECT 1 FROM app.claims c WHERE c.id = claim_id));
--> statement-breakpoint
CREATE POLICY home_access ON app.claim_files AS RESTRICTIVE USING
  ((SELECT app.my_homes()) IS NULL OR EXISTS (SELECT 1 FROM app.claims c WHERE c.id = claim_id));
--> statement-breakpoint
CREATE POLICY home_access ON app.messages AS RESTRICTIVE USING
  ((SELECT app.my_homes()) IS NULL OR EXISTS (SELECT 1 FROM app.message_threads m WHERE m.id = thread_id));
--> statement-breakpoint
CREATE POLICY home_access ON app.task_photos AS RESTRICTIVE USING
  ((SELECT app.my_homes()) IS NULL OR EXISTS (SELECT 1 FROM app.tasks k WHERE k.id = task_id));
--> statement-breakpoint
CREATE POLICY home_access ON app.lock_codes AS RESTRICTIVE USING
  ((SELECT app.my_homes()) IS NULL
   OR EXISTS (SELECT 1 FROM app.reservations r WHERE r.id = reservation_id)
   OR EXISTS (SELECT 1 FROM app.tasks k WHERE k.id = task_id));
--> statement-breakpoint
CREATE POLICY home_access ON app.guests AS RESTRICTIVE USING
  ((SELECT app.my_homes()) IS NULL OR app.guest_visible(id, (SELECT app.my_homes())::uuid[]));
--> statement-breakpoint
-- Owners and their statements: visible when the owner has a visible home.
CREATE POLICY home_access ON app.owners AS RESTRICTIVE USING
  ((SELECT app.my_homes()) IS NULL OR EXISTS (SELECT 1 FROM app.properties p WHERE p.owner_id = owners.id));
--> statement-breakpoint
CREATE POLICY home_access ON app.owner_statements AS RESTRICTIVE USING
  ((SELECT app.my_homes()) IS NULL OR EXISTS (SELECT 1 FROM app.owners o WHERE o.id = owner_id));
--> statement-breakpoint
-- History of a home's records stays with the home: someone limited reads none of the trail.
CREATE POLICY home_access ON app.audit_log AS RESTRICTIVE USING ((SELECT app.my_homes()) IS NULL);
--> statement-breakpoint

-- Invitations carry the homes and the owner into the membership.
CREATE OR REPLACE FUNCTION app.accept_invitations(p_user_id uuid, p_email text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH chosen AS (
    SELECT DISTINCT ON (i.organisation_id) i.organisation_id, i.role, i.property_ids, i.owner_id
      FROM app.invitations i
     WHERE lower(i.email) = lower(p_email)
       AND i.accepted_at IS NULL
       AND (i.expires_at IS NULL OR i.expires_at > now())
     ORDER BY i.organisation_id, i.created_at DESC
  ), joined AS (
    INSERT INTO app.memberships (organisation_id, user_id, role, homes_limited, owner_id)
    SELECT c.organisation_id, p_user_id, c.role, c.property_ids IS NOT NULL, c.owner_id FROM chosen c
    ON CONFLICT (organisation_id, user_id) DO NOTHING
    RETURNING organisation_id
  ), homes AS (
    INSERT INTO app.member_homes (organisation_id, user_id, property_id)
    SELECT c.organisation_id, p_user_id, p.id
      FROM chosen c
      JOIN joined j ON j.organisation_id = c.organisation_id
      JOIN app.properties p ON p.organisation_id = c.organisation_id AND p.id = ANY (c.property_ids)
    ON CONFLICT DO NOTHING
  )
  SELECT count(*) INTO v_count FROM joined;

  UPDATE app.app_users u
     SET full_name = i.full_name
    FROM (
      SELECT full_name FROM app.invitations
       WHERE lower(email) = lower(p_email) AND accepted_at IS NULL AND full_name IS NOT NULL
         AND (expires_at IS NULL OR expires_at > now())
       ORDER BY created_at DESC LIMIT 1
    ) i
   WHERE u.id = p_user_id AND u.full_name IS NULL;

  UPDATE app.invitations
     SET accepted_at = now(), accepted_by = p_user_id
   WHERE lower(email) = lower(p_email)
     AND accepted_at IS NULL
     AND (expires_at IS NULL OR expires_at > now());
  RETURN v_count;
END
$$;
