-- Staff skills and the people found in Guesty (1 Nov 2026).
SELECT app.enable_tenant_rls('app.guesty_staff', 'SELECT, INSERT, UPDATE');
--> statement-breakpoint
CREATE TRIGGER guesty_staff_audit AFTER INSERT OR UPDATE OR DELETE ON app.guesty_staff
  FOR EACH ROW EXECUTE FUNCTION app.audit_row();
--> statement-breakpoint
ALTER TABLE app.guesty_staff
  ADD CONSTRAINT guesty_staff_user_fk FOREIGN KEY (user_id) REFERENCES app.app_users (id) ON DELETE SET NULL;
--> statement-breakpoint
-- The field team already here keeps doing every kind of job until someone narrows it.
UPDATE app.memberships SET skills = array['cleaning', 'maintenance'] WHERE role = 'field';
--> statement-breakpoint
-- Invitations now carry skills onto the membership.
CREATE OR REPLACE FUNCTION app.accept_invitations(p_user_id uuid, p_email text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH chosen AS (
    SELECT DISTINCT ON (i.organisation_id) i.organisation_id, i.role, i.property_ids, i.owner_id, i.skills
      FROM app.invitations i
     WHERE lower(i.email) = lower(p_email)
       AND i.accepted_at IS NULL
       AND (i.expires_at IS NULL OR i.expires_at > now())
     ORDER BY i.organisation_id, i.created_at DESC
  ), joined AS (
    INSERT INTO app.memberships (organisation_id, user_id, role, homes_limited, owner_id, skills)
    SELECT c.organisation_id, p_user_id, c.role, c.property_ids IS NOT NULL, c.owner_id, c.skills FROM chosen c
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
--> statement-breakpoint
-- Adding a colleague before they first sign in (from Guesty): their sign-in account is made by the
-- API (no email sent), and this records them. Only an admin of the operator in scope may call it.
-- An email already known keeps its existing person.
CREATE OR REPLACE FUNCTION app.ensure_colleague(p_id uuid, p_email text, p_name text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM app.memberships
     WHERE organisation_id = app.current_org_id() AND user_id = app.current_user_id()
       AND role::text = 'admin'
  ) THEN
    RAISE EXCEPTION 'only an admin adds colleagues' USING ERRCODE = '42501';
  END IF;
  SELECT id INTO v_id FROM app.app_users WHERE lower(email) = lower(p_email);
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;
  INSERT INTO app.app_users (id, email, full_name) VALUES (p_id, lower(p_email), p_name);
  RETURN p_id;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.ensure_colleague(uuid, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.ensure_colleague(uuid, text, text) TO app_api;
