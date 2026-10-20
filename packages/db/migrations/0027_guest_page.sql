ALTER TABLE "app"."tasks" DROP CONSTRAINT "tasks_source";--> statement-breakpoint
ALTER TABLE "app"."reservations" ADD COLUMN "guest_key" text DEFAULT md5(gen_random_uuid()::text || gen_random_uuid()::text) NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."organisation_brand" ADD COLUMN "guest_phone" text;--> statement-breakpoint
ALTER TABLE "app"."custom_fields" ADD COLUMN "guest_visible" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."reservations" ADD CONSTRAINT "reservations_guest_key_key" UNIQUE("guest_key");--> statement-breakpoint
ALTER TABLE "app"."tasks" ADD CONSTRAINT "tasks_source" CHECK ("app"."tasks"."source" in ('check_out', 'manual', 'report'));--> statement-breakpoint
-- The standard fields guests should see: the top lock code, the Wi-Fi, the check-in instructions.
-- The bottom lock is for maintenance and stays with the team.
UPDATE app.custom_fields SET guest_visible = true
 WHERE lower(name) IN ('top lock code', 'wi-fi name', 'wi-fi password', 'check-in instructions');
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.standard_custom_fields(p_org uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp
AS $$
DECLARE
  n integer;
BEGIN
  INSERT INTO app.custom_fields (organisation_id, name, kind, position, guest_visible)
  SELECT p_org, s.name, s.kind::app.field_kind,
         (SELECT coalesce(max(f.position), -1) FROM app.custom_fields f WHERE f.organisation_id = p_org) + s.ord,
         s.guest
    FROM (VALUES
      ('Top lock code', 'secret', 1, true),
      ('Bottom lock code', 'secret', 2, false),
      ('Wi-Fi name', 'text', 3, true),
      ('Wi-Fi password', 'secret', 4, true),
      ('Check-in instructions', 'link', 5, true)
    ) AS s(name, kind, ord, guest)
   WHERE NOT EXISTS (
     SELECT 1 FROM app.custom_fields f
      WHERE f.organisation_id = p_org AND lower(f.name) = lower(s.name)
   );
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.standard_custom_fields(uuid) FROM PUBLIC;
--> statement-breakpoint
-- The guest's page for their stay, by the private key in their link. The API has no operator
-- context on a public request, so this reads past row-level security on purpose, and returns only
-- what a guest may see: the home, the dates and times, the rules, the contact, and the fields
-- marked for guests. Secrets come sealed; the API opens them only between arrival and departure.
-- A cancelled booking has no page.
CREATE OR REPLACE FUNCTION app.guest_stay(p_key text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp
AS $$
  SELECT jsonb_build_object(
    'reservationId', r.id,
    'status', r.status,
    'guestName', g.full_name,
    'checkIn', r.check_in,
    'checkOut', r.check_out,
    'checkInTime', to_char(coalesce(r.check_in_time, p.check_in_time), 'HH24:MI'),
    'checkOutTime', to_char(coalesce(r.check_out_time, p.check_out_time), 'HH24:MI'),
    'adults', r.adults,
    'children', r.children,
    'infants', r.infants,
    'timeZone', s.time_zone,
    'property', jsonb_build_object(
      'name', p.name,
      'title', p.title,
      'summary', p.summary,
      'addressLine1', p.address_line1,
      'addressLine2', p.address_line2,
      'city', p.city,
      'postcode', p.postcode,
      'countryCode', p.country_code,
      'gettingAround', p.getting_around,
      'guestAccess', p.guest_access,
      'checkInMethod', p.check_in_method,
      'houseRules', p.house_rules,
      'petsAllowed', p.pets_allowed,
      'smokingAllowed', p.smoking_allowed,
      'eventsAllowed', p.events_allowed,
      'childrenAllowed', p.children_allowed,
      'quietHoursStart', to_char(p.quiet_hours_start, 'HH24:MI'),
      'quietHoursEnd', to_char(p.quiet_hours_end, 'HH24:MI'),
      'maxGuests', p.max_guests,
      'photoUrl', (SELECT ph.url FROM app.property_photos ph WHERE ph.property_id = p.id ORDER BY ph.position LIMIT 1)
    ),
    'brand', jsonb_build_object(
      'displayName', b.display_name,
      'logoLightUrl', b.logo_light_url,
      'accentHex', b.accent_hex,
      'phone', b.guest_phone,
      'email', b.sender_email
    ),
    'fields', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'name', f.name, 'kind', f.kind, 'value', v.value,
        'secret', CASE WHEN v.secret IS NULL THEN NULL ELSE encode(v.secret, 'base64') END
      ) ORDER BY f.position)
        FROM app.custom_fields f
        JOIN app.property_field_values v ON v.field_id = f.id AND v.property_id = p.id
       WHERE f.organisation_id = r.organisation_id AND f.guest_visible
         AND (v.value IS NOT NULL OR v.secret IS NOT NULL)
    ), '[]'::jsonb)
  )
    FROM app.reservations r
    JOIN app.properties p ON p.id = r.property_id
    JOIN app.organisation_settings s ON s.organisation_id = r.organisation_id
    JOIN app.organisation_brand b ON b.organisation_id = r.organisation_id
    LEFT JOIN app.guests g ON g.id = r.guest_id
   WHERE r.guest_key = p_key
     AND r.status = 'confirmed'
     AND p.archived_at IS NULL;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.guest_stay(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.guest_stay(text) TO app_api;
