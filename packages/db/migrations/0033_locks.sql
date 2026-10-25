CREATE TABLE "app"."lock_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"provider" text DEFAULT 'ttlock' NOT NULL,
	"username" text NOT NULL,
	"token_sealed" "bytea" NOT NULL,
	"status" text DEFAULT 'connected' NOT NULL,
	"last_error" text,
	"gateways" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lock_accounts_org_key" UNIQUE("organisation_id"),
	CONSTRAINT "lock_accounts_status_check" CHECK ("app"."lock_accounts"."status" in ('connected', 'error'))
);
--> statement-breakpoint
CREATE TABLE "app"."lock_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"lock_id" uuid NOT NULL,
	"reservation_id" uuid,
	"task_id" uuid,
	"kind" text NOT NULL,
	"code_sealed" "bytea" NOT NULL,
	"provider_code_id" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"sent_starts_at" timestamp with time zone,
	"sent_ends_at" timestamp with time zone,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lock_codes_kind_check" CHECK ("app"."lock_codes"."kind" in ('guest', 'crew')),
	CONSTRAINT "lock_codes_status_check" CHECK ("app"."lock_codes"."status" in ('pending', 'set', 'failed', 'removed')),
	CONSTRAINT "lock_codes_owner_check" CHECK (("app"."lock_codes"."kind" = 'guest' and "app"."lock_codes"."reservation_id" is not null) or ("app"."lock_codes"."kind" = 'crew' and "app"."lock_codes"."task_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "app"."locks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"provider_lock_id" text NOT NULL,
	"name" text NOT NULL,
	"property_id" uuid,
	"battery" integer,
	"has_gateway" boolean DEFAULT false NOT NULL,
	"makes_codes" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "locks_provider_key" UNIQUE("account_id","provider_lock_id")
);
--> statement-breakpoint
ALTER TABLE "app"."lock_accounts" ADD CONSTRAINT "lock_accounts_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "app"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."lock_codes" ADD CONSTRAINT "lock_codes_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "app"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."lock_codes" ADD CONSTRAINT "lock_codes_lock_id_locks_id_fk" FOREIGN KEY ("lock_id") REFERENCES "app"."locks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."lock_codes" ADD CONSTRAINT "lock_codes_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "app"."reservations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."lock_codes" ADD CONSTRAINT "lock_codes_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "app"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."locks" ADD CONSTRAINT "locks_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "app"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."locks" ADD CONSTRAINT "locks_account_id_lock_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "app"."lock_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."locks" ADD CONSTRAINT "locks_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "app"."properties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lock_codes_stay_key" ON "app"."lock_codes" USING btree ("lock_id","reservation_id") WHERE "app"."lock_codes"."reservation_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "lock_codes_job_key" ON "app"."lock_codes" USING btree ("lock_id","task_id") WHERE "app"."lock_codes"."task_id" is not null;--> statement-breakpoint
CREATE INDEX "lock_codes_org_status_idx" ON "app"."lock_codes" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE INDEX "locks_property_idx" ON "app"."locks" USING btree ("property_id");--> statement-breakpoint
-- Smart locks: tenant-isolated like everything else. The API connects the account and places
-- locks; the worker makes, changes and removes the codes.
SELECT app.enable_tenant_rls('app.lock_accounts');
--> statement-breakpoint
SELECT app.enable_tenant_rls('app.locks');
--> statement-breakpoint
SELECT app.enable_tenant_rls('app.lock_codes', 'SELECT, INSERT, UPDATE, DELETE');
--> statement-breakpoint
CREATE INDEX "locks_org_idx" ON "app"."locks" USING btree ("organisation_id");
--> statement-breakpoint
CREATE TRIGGER lock_accounts_touch BEFORE UPDATE ON app.lock_accounts
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER locks_touch BEFORE UPDATE ON app.locks
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER lock_codes_touch BEFORE UPDATE ON app.lock_codes
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
--> statement-breakpoint
-- Who connected or disconnected the account, and who put a lock on which home or turned codes on.
-- Not the codes themselves: the worker updates those every few minutes.
CREATE TRIGGER lock_accounts_audit AFTER INSERT OR UPDATE OR DELETE ON app.lock_accounts
  FOR EACH ROW EXECUTE FUNCTION app.audit_row();
--> statement-breakpoint
CREATE TRIGGER locks_audit AFTER INSERT OR UPDATE OR DELETE ON app.locks
  FOR EACH ROW EXECUTE FUNCTION app.audit_row();

--> statement-breakpoint
-- The guest's page gains the stay's door code (sealed; opened by the API from arrival to departure).
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
    ), '[]'::jsonb),
    -- The stay's own door code, sealed, once the lock holds it. The API opens it on the same days as other secrets.
    'doorCode', (
      SELECT encode(c.code_sealed, 'base64') FROM app.lock_codes c
       WHERE c.reservation_id = r.id AND c.kind = 'guest' AND c.status = 'set'
       ORDER BY c.created_at LIMIT 1
    )
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
