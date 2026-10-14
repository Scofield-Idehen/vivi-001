-- The console counts properties still on Guesty, rather than "everything not run by V-01".
-- A property added in V-01 (managed_by = 'none') isn't on Guesty, so it no longer counts as one.
-- Each function gains a properties_on_guesty column; a new result column needs DROP and CREATE.
DROP FUNCTION app.console_operator(uuid);
--> statement-breakpoint
DROP FUNCTION app.console_operators();
--> statement-breakpoint
DROP FUNCTION app.console_overview();
--> statement-breakpoint
CREATE FUNCTION app.console_overview()
RETURNS TABLE (
  operators integer,
  operators_live integer,
  properties integer,
  properties_on_v01 integer,
  properties_on_guesty integer,
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
    (SELECT count(*)::int FROM app.properties p WHERE p.archived_at IS NULL AND p.managed_by = 'guesty'),
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
CREATE FUNCTION app.console_operators()
RETURNS TABLE (
  id uuid,
  name text,
  slug text,
  created_at timestamptz,
  properties integer,
  properties_on_v01 integer,
  properties_on_guesty integer,
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
    coalesce(p.total, 0), coalesce(p.on_v01, 0), coalesce(p.on_guesty, 0), coalesce(m.total, 0),
    coalesce(ca.total, 0), coalesce(ca.connected, 0), coalesce(ca.channels, ARRAY[]::text[]),
    coalesce(ob.waiting, 0), coalesce(ob.failed, 0), coalesce(wh.failed, 0),
    al.last_at,
    EXISTS (
      SELECT 1 FROM app.support_access_grants g
       WHERE g.organisation_id = o.id AND g.ended_at IS NULL AND g.expires_at > now()
    )
    FROM app.organisations o
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS total,
             (count(*) FILTER (WHERE pp.managed_by = 'v01'))::int AS on_v01,
             (count(*) FILTER (WHERE pp.managed_by = 'guesty'))::int AS on_guesty
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
CREATE FUNCTION app.console_operator(p_org uuid)
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
  properties_on_guesty integer,
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
    c.properties, c.properties_on_v01, c.properties_on_guesty, c.members, c.channel_accounts,
    c.channel_accounts_connected, c.channels, c.outbox_waiting, c.outbox_failed, c.webhooks_failed,
    c.last_activity_at, c.support_active
    FROM app.console_operators() c
    JOIN app.organisations o ON o.id = c.id
    LEFT JOIN app.organisation_settings st ON st.organisation_id = c.id
    LEFT JOIN app.organisation_brand b ON b.organisation_id = c.id
   WHERE c.id = p_org;
END
$$;
--> statement-breakpoint
-- Same privileges as before: not callable by PUBLIC, only by the API.
REVOKE ALL ON FUNCTION app.console_overview(), app.console_operators(), app.console_operator(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.console_overview(), app.console_operators(), app.console_operator(uuid) TO app_api;
