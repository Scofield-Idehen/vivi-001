ALTER TABLE "app"."invitations" ADD COLUMN "full_name" text;--> statement-breakpoint
-- An invited person's name, given by the admin, becomes theirs on first sign-in unless they already have one.
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
-- An admin corrects a colleague's name. Only an admin of the workspace the person is in; the API
-- checks the role too, and this checks it again where it counts.
CREATE OR REPLACE FUNCTION app.rename_member(p_org uuid, p_user uuid, p_name text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp
AS $$
BEGIN
  IF p_org <> app.current_org_id() THEN
    RAISE EXCEPTION 'not this workspace' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM app.memberships m
     WHERE m.organisation_id = p_org AND m.user_id = app.current_user_id() AND m.role = 'admin'
  ) THEN
    RAISE EXCEPTION 'only an admin renames a member' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM app.memberships m WHERE m.organisation_id = p_org AND m.user_id = p_user) THEN
    RAISE EXCEPTION 'not a member' USING ERRCODE = '42501';
  END IF;
  UPDATE app.app_users SET full_name = nullif(btrim(p_name), '') WHERE id = p_user;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.rename_member(uuid, uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.rename_member(uuid, uuid, text) TO app_api;
