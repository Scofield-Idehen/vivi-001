-- The V-01 console: who V-01's staff are, read-only support access to an operator's workspace,
-- and the functions the console reads through.
--
-- The console never queries operator tables directly. Every console function checks that the
-- caller is V-01 staff with the right role, and returns totals, statuses and operator metadata,
-- never guests' details. To see an operator's own data, a staff member opens a support grant:
-- time-limited, read-only, with a reason the operator can read, and every request logged.

-- Staff and the console log: no application role may touch these tables directly.
ALTER TABLE app.platform_staff ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.platform_audit ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON app.platform_staff, app.platform_audit FROM app_base, app_api, app_worker, app_jobs;
--> statement-breakpoint

-- Support grants are the operator's data too: their members can read the grants for their own
-- workspace (the same tenant policy as every operator table). Only the functions below write them.
SELECT app.enable_tenant_rls('app.support_access_grants', 'SELECT');
--> statement-breakpoint
CREATE TRIGGER support_access_grants_audit
  AFTER INSERT OR UPDATE OR DELETE ON app.support_access_grants
  FOR EACH ROW EXECUTE FUNCTION app.audit_row();
--> statement-breakpoint

-- Who is V-01 staff ---------------------------------------------------------------------------
-- The caller's role at V-01, or NULL for everyone else.
CREATE OR REPLACE FUNCTION app.platform_role() RETURNS app.platform_role
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp
AS $$
  SELECT s.role FROM app.platform_staff s WHERE s.user_id = app.current_user_id();
$$;
--> statement-breakpoint
-- Called by the API after it has verified the sign-in token, so the email is trusted. Links a staff
-- entry added by email to the person's sign-in, then returns their role (NULL if not staff).
CREATE OR REPLACE FUNCTION app.link_platform_staff(p_user_id uuid, p_email text) RETURNS app.platform_role
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp
AS $$
DECLARE
  v_role app.platform_role;
BEGIN
  IF p_user_id IS DISTINCT FROM app.current_user_id() THEN
    RAISE EXCEPTION 'Staff can only be linked to the person signing in' USING ERRCODE = '42501';
  END IF;
  UPDATE app.platform_staff s
     SET user_id = p_user_id
   WHERE s.email = lower(btrim(p_email))
     AND s.user_id IS NULL;
  SELECT s.role INTO v_role FROM app.platform_staff s WHERE s.user_id = p_user_id;
  RETURN v_role;
END
$$;
--> statement-breakpoint
-- Raises unless the caller is V-01 staff with one of the allowed roles. Used by every console function.
CREATE OR REPLACE FUNCTION app.require_platform_role(p_allowed app.platform_role[]) RETURNS app.platform_role
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp
AS $$
DECLARE
  v_role app.platform_role;
BEGIN
  SELECT s.role INTO v_role FROM app.platform_staff s WHERE s.user_id = app.current_user_id();
  IF v_role IS NULL OR NOT (v_role = ANY (p_allowed)) THEN
    RAISE EXCEPTION 'This is for V-01 staff only' USING ERRCODE = '42501';
  END IF;
  RETURN v_role;
END
$$;
--> statement-breakpoint

-- Console reads -------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.console_overview()
RETURNS TABLE (
  operators integer,
  operators_live integer,
  properties integer,
  properties_on_v01 integer,
  arrivals_today integer,
  departures_today integer,
  bookings_last_7_days integer,
  outbox_waiting integer,
  outbox_failed integer,
  webhooks_waiting integer,
  webhooks_failed integer,
  support_sessions_active integer,
  last_sent_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp
AS $$
#variable_conflict use_column
BEGIN
  PERFORM app.require_platform_role(ARRAY['owner', 'support', 'viewer']::app.platform_role[]);
  RETURN QUERY
  WITH local_today AS (
    -- "Today" is each operator's own calendar day.
    SELECT st.organisation_id, (now() AT TIME ZONE st.time_zone)::date AS day
      FROM app.organisation_settings st
  )
  SELECT
    (SELECT count(*)::int FROM app.organisations o),
    (SELECT count(DISTINCT p.organisation_id)::int FROM app.properties p
      WHERE p.managed_by = 'v01' AND p.archived_at IS NULL),
    (SELECT count(*)::int FROM app.properties p WHERE p.archived_at IS NULL),
    (SELECT count(*)::int FROM app.properties p WHERE p.archived_at IS NULL AND p.managed_by = 'v01'),
    (SELECT count(*)::int FROM app.reservations r JOIN local_today t ON t.organisation_id = r.organisation_id
      WHERE r.status = 'confirmed' AND r.check_in = t.day),
    (SELECT count(*)::int FROM app.reservations r JOIN local_today t ON t.organisation_id = r.organisation_id
      WHERE r.status = 'confirmed' AND r.check_out = t.day),
    (SELECT count(*)::int FROM app.reservations r
      WHERE r.created_at > now() - interval '7 days' AND r.status <> 'inquiry'),
    (SELECT count(*)::int FROM app.ari_outbox ob WHERE ob.status IN ('pending', 'sending')),
    (SELECT count(*)::int FROM app.ari_outbox ob WHERE ob.status = 'failed'),
    (SELECT count(*)::int FROM app.webhook_events w WHERE w.processed_at IS NULL AND w.attempts < 20),
    (SELECT count(*)::int FROM app.webhook_events w WHERE w.processed_at IS NULL AND w.attempts >= 20),
    (SELECT count(*)::int FROM app.support_access_grants g WHERE g.ended_at IS NULL AND g.expires_at > now()),
    (SELECT max(ob.sent_at) FROM app.ari_outbox ob);
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.console_operators()
RETURNS TABLE (
  id uuid,
  name text,
  slug text,
  created_at timestamptz,
  properties integer,
  properties_on_v01 integer,
  members integer,
  channel_accounts integer,
  channel_accounts_connected integer,
  channels text[],
  outbox_waiting integer,
  outbox_failed integer,
  webhooks_failed integer,
  last_activity_at timestamptz,
  support_active boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp
AS $$
#variable_conflict use_column
BEGIN
  PERFORM app.require_platform_role(ARRAY['owner', 'support', 'viewer']::app.platform_role[]);
  RETURN QUERY
  SELECT
    o.id, o.name, o.slug, o.created_at,
    coalesce(p.total, 0), coalesce(p.on_v01, 0), coalesce(m.total, 0),
    coalesce(ca.total, 0), coalesce(ca.connected, 0), coalesce(ca.channels, ARRAY[]::text[]),
    coalesce(ob.waiting, 0), coalesce(ob.failed, 0), coalesce(wh.failed, 0),
    al.last_at,
    EXISTS (
      SELECT 1 FROM app.support_access_grants g
       WHERE g.organisation_id = o.id AND g.ended_at IS NULL AND g.expires_at > now()
    )
    FROM app.organisations o
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS total, (count(*) FILTER (WHERE pp.managed_by = 'v01'))::int AS on_v01
        FROM app.properties pp WHERE pp.organisation_id = o.id AND pp.archived_at IS NULL
    ) p ON true
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS total FROM app.memberships mm WHERE mm.organisation_id = o.id
    ) m ON true
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS total,
             (count(*) FILTER (WHERE a.status = 'connected'))::int AS connected,
             array_agg(DISTINCT a.channel::text ORDER BY a.channel::text) FILTER (WHERE a.status = 'connected')
               AS channels
        FROM app.channel_accounts a WHERE a.organisation_id = o.id
    ) ca ON true
    LEFT JOIN LATERAL (
      SELECT (count(*) FILTER (WHERE x.status IN ('pending', 'sending')))::int AS waiting,
             (count(*) FILTER (WHERE x.status = 'failed'))::int AS failed
        FROM app.ari_outbox x WHERE x.organisation_id = o.id
    ) ob ON true
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS failed FROM app.webhook_events w
       WHERE w.organisation_id = o.id AND w.processed_at IS NULL AND w.attempts >= 20
    ) wh ON true
    LEFT JOIN LATERAL (
      SELECT max(l.created_at) AS last_at FROM app.audit_log l WHERE l.organisation_id = o.id
    ) al ON true
   ORDER BY o.name;
END
$$;
--> statement-breakpoint
-- One operator, with its settings. Logged, because it is a deliberate look at one operator.
CREATE OR REPLACE FUNCTION app.console_operator(p_org uuid)
RETURNS TABLE (
  id uuid,
  name text,
  legal_name text,
  slug text,
  created_at timestamptz,
  display_name text,
  currency text,
  time_zone text,
  country_code text,
  properties integer,
  properties_on_v01 integer,
  members integer,
  channel_accounts integer,
  channel_accounts_connected integer,
  channels text[],
  outbox_waiting integer,
  outbox_failed integer,
  webhooks_failed integer,
  last_activity_at timestamptz,
  support_active boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp
AS $$
#variable_conflict use_column
BEGIN
  PERFORM app.require_platform_role(ARRAY['owner', 'support', 'viewer']::app.platform_role[]);
  IF NOT EXISTS (SELECT 1 FROM app.organisations o WHERE o.id = p_org) THEN
    RETURN;
  END IF;
  INSERT INTO app.platform_audit (staff_user_id, action, organisation_id)
  VALUES (app.current_user_id(), 'console.operator.view', p_org);
  RETURN QUERY
  SELECT
    c.id, c.name, o.legal_name, c.slug, c.created_at,
    b.display_name, st.currency::text, st.time_zone, st.country_code::text,
    c.properties, c.properties_on_v01, c.members, c.channel_accounts, c.channel_accounts_connected,
    c.channels, c.outbox_waiting, c.outbox_failed, c.webhooks_failed, c.last_activity_at, c.support_active
    FROM app.console_operators() c
    JOIN app.organisations o ON o.id = c.id
    LEFT JOIN app.organisation_settings st ON st.organisation_id = c.id
    LEFT JOIN app.organisation_brand b ON b.organisation_id = c.id
   WHERE c.id = p_org;
END
$$;
--> statement-breakpoint
-- An operator's team and open invitations: work emails and roles, for support. Owners and support only.
CREATE OR REPLACE FUNCTION app.console_operator_team(p_org uuid)
RETURNS TABLE (
  email text,
  full_name text,
  role app.member_role,
  status text,
  since timestamptz,
  last_seen_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp
AS $$
#variable_conflict use_column
BEGIN
  PERFORM app.require_platform_role(ARRAY['owner', 'support']::app.platform_role[]);
  RETURN QUERY
  SELECT u.email, u.full_name, m.role, 'active'::text, m.created_at, u.last_seen_at
    FROM app.memberships m JOIN app.app_users u ON u.id = m.user_id
   WHERE m.organisation_id = p_org
  UNION ALL
  SELECT lower(i.email), NULL::text, i.role, 'invited'::text, i.created_at, NULL::timestamptz
    FROM app.invitations i
   WHERE i.organisation_id = p_org AND i.accepted_at IS NULL
     AND (i.expires_at IS NULL OR i.expires_at > now())
   ORDER BY 4, 1;
END
$$;
--> statement-breakpoint
-- Channel sync health per operator, plus one row (no operator) for webhooks not yet matched to any property.
CREATE OR REPLACE FUNCTION app.console_sync_health()
RETURNS TABLE (
  organisation_id uuid,
  organisation_name text,
  outbox_waiting integer,
  outbox_failed integer,
  oldest_waiting_at timestamptz,
  last_sent_at timestamptz,
  webhooks_waiting integer,
  webhooks_failed integer,
  last_webhook_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp
AS $$
#variable_conflict use_column
BEGIN
  PERFORM app.require_platform_role(ARRAY['owner', 'support', 'viewer']::app.platform_role[]);
  RETURN QUERY
  SELECT o.id, o.name,
         coalesce(ob.waiting, 0), coalesce(ob.failed, 0), ob.oldest_waiting, ob.last_sent,
         coalesce(wh.waiting, 0), coalesce(wh.failed, 0), wh.last_received
    FROM app.organisations o
    LEFT JOIN LATERAL (
      SELECT (count(*) FILTER (WHERE x.status IN ('pending', 'sending')))::int AS waiting,
             (count(*) FILTER (WHERE x.status = 'failed'))::int AS failed,
             min(x.created_at) FILTER (WHERE x.status IN ('pending', 'sending')) AS oldest_waiting,
             max(x.sent_at) AS last_sent
        FROM app.ari_outbox x WHERE x.organisation_id = o.id
    ) ob ON true
    LEFT JOIN LATERAL (
      SELECT (count(*) FILTER (WHERE w.processed_at IS NULL AND w.attempts < 20))::int AS waiting,
             (count(*) FILTER (WHERE w.processed_at IS NULL AND w.attempts >= 20))::int AS failed,
             max(w.received_at) AS last_received
        FROM app.webhook_events w WHERE w.organisation_id = o.id
    ) wh ON true
  UNION ALL
  SELECT NULL::uuid, NULL::text, 0, 0, NULL::timestamptz, NULL::timestamptz,
         (count(*) FILTER (WHERE w.attempts < 20))::int,
         (count(*) FILTER (WHERE w.attempts >= 20))::int,
         max(w.received_at)
    FROM app.webhook_events w
   WHERE w.organisation_id IS NULL AND w.processed_at IS NULL
  ORDER BY 2 NULLS LAST;
END
$$;
--> statement-breakpoint
-- The latest sync problems, newest first. Messages are cut short; they come from the channel manager
-- and from our own worker, and carry ids and dates, not guests' details.
CREATE OR REPLACE FUNCTION app.console_sync_errors(p_limit integer)
RETURNS TABLE (
  source text,
  organisation_id uuid,
  organisation_name text,
  at timestamptz,
  attempts integer,
  message text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp
AS $$
#variable_conflict use_column
BEGIN
  PERFORM app.require_platform_role(ARRAY['owner', 'support', 'viewer']::app.platform_role[]);
  RETURN QUERY
  SELECT * FROM (
    SELECT 'outbox'::text, x.organisation_id, o.name, coalesce(x.locked_at, x.created_at), x.attempts,
           left(x.last_error, 300)
      FROM app.ari_outbox x JOIN app.organisations o ON o.id = x.organisation_id
     WHERE x.last_error IS NOT NULL AND x.status <> 'sent'
    UNION ALL
    SELECT 'webhook'::text, w.organisation_id, o.name, coalesce(w.locked_at, w.received_at), w.attempts,
           left(w.error, 300)
      FROM app.webhook_events w LEFT JOIN app.organisations o ON o.id = w.organisation_id
     WHERE w.error IS NOT NULL AND w.processed_at IS NULL
  ) e
  ORDER BY 4 DESC
  LIMIT least(greatest(p_limit, 1), 200);
END
$$;
--> statement-breakpoint

-- Support access ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.console_support_log(p_org uuid, p_limit integer)
RETURNS TABLE (
  id uuid,
  organisation_id uuid,
  organisation_name text,
  staff_email text,
  reason text,
  started_at timestamptz,
  expires_at timestamptz,
  ended_at timestamptz,
  active boolean,
  requests integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp
AS $$
#variable_conflict use_column
BEGIN
  PERFORM app.require_platform_role(ARRAY['owner', 'support', 'viewer']::app.platform_role[]);
  RETURN QUERY
  SELECT g.id, g.organisation_id, o.name, g.staff_email, g.reason, g.started_at, g.expires_at, g.ended_at,
         (g.ended_at IS NULL AND g.expires_at > now()),
         (SELECT count(*)::int FROM app.platform_audit a WHERE a.grant_id = g.id AND a.action = 'support.request')
    FROM app.support_access_grants g JOIN app.organisations o ON o.id = g.organisation_id
   WHERE p_org IS NULL OR g.organisation_id = p_org
   ORDER BY g.started_at DESC
   LIMIT least(greatest(p_limit, 1), 500);
END
$$;
--> statement-breakpoint
-- Opens read-only access to one operator's workspace for the caller. Any open grant the caller
-- already has for that operator is closed first, so there is only ever one.
CREATE OR REPLACE FUNCTION app.console_start_support_access(p_org uuid, p_reason text, p_minutes integer)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp
AS $$
DECLARE
  v_user uuid := app.current_user_id();
  v_email text;
  v_id uuid;
BEGIN
  PERFORM app.require_platform_role(ARRAY['owner', 'support']::app.platform_role[]);
  IF p_minutes IS NULL OR p_minutes < 5 OR p_minutes > 240 THEN
    RAISE EXCEPTION 'Support access lasts between 5 minutes and 4 hours' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM app.organisations o WHERE o.id = p_org) THEN
    RAISE EXCEPTION 'No such operator' USING ERRCODE = 'P0002';
  END IF;
  SELECT u.email INTO v_email FROM app.app_users u WHERE u.id = v_user;

  UPDATE app.support_access_grants g
     SET ended_at = now()
   WHERE g.staff_user_id = v_user AND g.organisation_id = p_org
     AND g.ended_at IS NULL AND g.expires_at > now();

  INSERT INTO app.support_access_grants (organisation_id, staff_user_id, staff_email, reason, expires_at)
  VALUES (p_org, v_user, v_email, btrim(p_reason), now() + make_interval(mins => p_minutes))
  RETURNING support_access_grants.id INTO v_id;

  INSERT INTO app.platform_audit (staff_user_id, action, organisation_id, grant_id, detail)
  VALUES (v_user, 'support.start', p_org, v_id, jsonb_build_object('minutes', p_minutes));
  RETURN v_id;
END
$$;
--> statement-breakpoint
-- Ends a grant early. Staff end their own; an owner can end anyone's. False if it was not open.
CREATE OR REPLACE FUNCTION app.console_end_support_access(p_grant uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp
AS $$
DECLARE
  v_user uuid := app.current_user_id();
  v_role app.platform_role;
  v_org uuid;
BEGIN
  v_role := app.require_platform_role(ARRAY['owner', 'support']::app.platform_role[]);
  UPDATE app.support_access_grants g
     SET ended_at = now()
   WHERE g.id = p_grant AND g.ended_at IS NULL AND g.expires_at > now()
     AND (g.staff_user_id = v_user OR v_role = 'owner')
  RETURNING g.organisation_id INTO v_org;
  IF v_org IS NULL THEN
    RETURN false;
  END IF;
  INSERT INTO app.platform_audit (staff_user_id, action, organisation_id, grant_id)
  VALUES (v_user, 'support.end', v_org, p_grant);
  RETURN true;
END
$$;
--> statement-breakpoint
-- The caller's open grants, for the web app to list the workspaces they can open right now.
CREATE OR REPLACE FUNCTION app.my_support_grants()
RETURNS TABLE (id uuid, organisation_id uuid, organisation_name text, expires_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp
AS $$
  SELECT g.id, g.organisation_id, o.name, g.expires_at
    FROM app.support_access_grants g
    JOIN app.organisations o ON o.id = g.organisation_id
    JOIN app.platform_staff s ON s.user_id = g.staff_user_id AND s.role IN ('owner', 'support')
   WHERE g.staff_user_id = app.current_user_id()
     AND g.ended_at IS NULL AND g.expires_at > now()
   ORDER BY o.name;
$$;
--> statement-breakpoint
-- The caller's open grant for one operator, or NULL. The API asks this before letting someone who
-- is not a member into a workspace. Staff whose role was removed lose access at once.
CREATE OR REPLACE FUNCTION app.active_support_grant(p_org uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp
AS $$
  SELECT g.id
    FROM app.support_access_grants g
    JOIN app.platform_staff s ON s.user_id = g.staff_user_id AND s.role IN ('owner', 'support')
   WHERE g.staff_user_id = app.current_user_id() AND g.organisation_id = p_org
     AND g.ended_at IS NULL AND g.expires_at > now()
   ORDER BY g.expires_at DESC
   LIMIT 1;
$$;
--> statement-breakpoint
-- Records one request made under a grant, allowed or refused. Raises if the grant is no longer open.
CREATE OR REPLACE FUNCTION app.log_support_request(
  p_grant uuid,
  p_method text,
  p_path text,
  p_allowed boolean
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp
AS $$
BEGIN
  INSERT INTO app.platform_audit (staff_user_id, action, organisation_id, grant_id, detail)
  SELECT g.staff_user_id, 'support.request', g.organisation_id, g.id,
         jsonb_build_object('method', left(p_method, 10), 'path', left(p_path, 300), 'allowed', p_allowed)
    FROM app.support_access_grants g
   WHERE g.id = p_grant AND g.staff_user_id = app.current_user_id()
     AND g.ended_at IS NULL AND g.expires_at > now();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Support access has ended' USING ERRCODE = '42501';
  END IF;
END
$$;
--> statement-breakpoint

-- Function privileges: nothing new is callable by PUBLIC, and only the API may use these.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION
  app.platform_role(),
  app.link_platform_staff(uuid, text),
  app.console_overview(),
  app.console_operators(),
  app.console_operator(uuid),
  app.console_operator_team(uuid),
  app.console_sync_health(),
  app.console_sync_errors(integer),
  app.console_support_log(uuid, integer),
  app.console_start_support_access(uuid, text, integer),
  app.console_end_support_access(uuid),
  app.my_support_grants(),
  app.active_support_grant(uuid),
  app.log_support_request(uuid, text, text, boolean)
TO app_api;
