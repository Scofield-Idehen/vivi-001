-- The damage deposit on the guest's page (1 Nov 2026): what the API needs to show or ask for it,
-- by the stay's private key. Only confirmed stays. The operator's id is returned so the API can
-- record the request in that operator's scope; nothing else about the operator is exposed.
CREATE OR REPLACE FUNCTION app.guest_deposit(p_key text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp
AS $$
  SELECT jsonb_build_object(
    'orgId', r.organisation_id,
    'reservationId', r.id,
    'channel', r.channel,
    'checkIn', r.check_in,
    'checkOut', r.check_out,
    'currency', coalesce(r.currency, s.currency, 'GBP'),
    'email', g.email,
    'home', p.name,
    'amountMinor', p.security_deposit_minor,
    'ask', p.deposit_ask,
    'gates', p.deposit_gates_codes,
    'onAirbnb', p.deposit_on_airbnb,
    'request', (
      SELECT jsonb_build_object('id', c.id, 'status', c.status, 'url', c.url, 'expiresAt', c.expires_at)
        FROM app.card_requests c
       WHERE c.reservation_id = r.id AND c.kind = 'deposit'
       ORDER BY c.created_at DESC LIMIT 1
    )
  )
    FROM app.reservations r
    JOIN app.properties p ON p.id = r.property_id
    JOIN app.organisation_settings s ON s.organisation_id = r.organisation_id
    LEFT JOIN app.guests g ON g.id = r.guest_id
   WHERE r.guest_key = p_key AND r.status = 'confirmed'
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.guest_deposit(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.guest_deposit(text) TO app_api;
