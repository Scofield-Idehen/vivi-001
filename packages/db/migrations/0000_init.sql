CREATE SCHEMA "app";
--> statement-breakpoint
CREATE TYPE "app"."channel" AS ENUM('airbnb', 'booking_com', 'vrbo', 'expedia', 'direct');--> statement-breakpoint
CREATE TYPE "app"."channel_account_status" AS ENUM('pending', 'connected', 'error', 'disconnected');--> statement-breakpoint
CREATE TYPE "app"."listing_status" AS ENUM('live', 'closing', 'archived');--> statement-breakpoint
CREATE TYPE "app"."managed_by" AS ENUM('guesty', 'v01');--> statement-breakpoint
CREATE TYPE "app"."member_role" AS ENUM('admin', 'operations', 'guest_comms', 'accounts', 'field');--> statement-breakpoint
CREATE TYPE "app"."outbox_kind" AS ENUM('availability', 'restrictions');--> statement-breakpoint
CREATE TYPE "app"."outbox_status" AS ENUM('pending', 'sending', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "app"."price_owner" AS ENUM('v01', 'pricelabs');--> statement-breakpoint
CREATE TYPE "app"."reservation_status" AS ENUM('inquiry', 'request', 'confirmed', 'cancelled', 'conflict');--> statement-breakpoint
CREATE TABLE "app"."blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blocks_dates_order" CHECK ("app"."blocks"."ends_on" > "app"."blocks"."starts_on")
);
--> statement-breakpoint
CREATE TABLE "app"."channex_bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"channex_booking_id" text NOT NULL,
	"last_revision_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channex_bookings_reservation_key" UNIQUE("reservation_id"),
	CONSTRAINT "channex_bookings_channex_key" UNIQUE("channex_booking_id")
);
--> statement-breakpoint
CREATE TABLE "app"."guests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"full_name" text,
	"email" text,
	"phone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."occupancies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"nights" daterange NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	CONSTRAINT "occupancies_source_key" UNIQUE("source_type","source_id"),
	CONSTRAINT "occupancies_source_type" CHECK ("app"."occupancies"."source_type" in ('reservation', 'block'))
);
--> statement-breakpoint
CREATE TABLE "app"."reservation_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"reservation_id" uuid,
	"provider" text DEFAULT 'channex' NOT NULL,
	"external_revision_id" text NOT NULL,
	"revision_status" text,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"acked_at" timestamp with time zone,
	CONSTRAINT "reservation_revisions_external_key" UNIQUE("provider","external_revision_id")
);
--> statement-breakpoint
CREATE TABLE "app"."reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"channel" "app"."channel" NOT NULL,
	"channel_account_id" uuid,
	"channel_reference" text,
	"status" "app"."reservation_status" NOT NULL,
	"check_in" date NOT NULL,
	"check_out" date NOT NULL,
	"guest_id" uuid,
	"adults" integer DEFAULT 1 NOT NULL,
	"children" integer DEFAULT 0 NOT NULL,
	"infants" integer DEFAULT 0 NOT NULL,
	"currency" char(3),
	"total_minor" bigint,
	"payout_minor" bigint,
	"notes" text,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservations_channel_reference_key" UNIQUE("organisation_id","channel","channel_reference"),
	CONSTRAINT "reservations_dates_order" CHECK ("app"."reservations"."check_out" > "app"."reservations"."check_in")
);
--> statement-breakpoint
CREATE TABLE "app"."channel_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"channel" "app"."channel" NOT NULL,
	"label" text NOT NULL,
	"login_holder" text,
	"two_factor_holder" text,
	"status" "app"."channel_account_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_accounts_org_label_key" UNIQUE("organisation_id","label"),
	CONSTRAINT "channel_accounts_id_channel_key" UNIQUE("id","channel")
);
--> statement-breakpoint
CREATE TABLE "app"."channel_listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"channel_account_id" uuid NOT NULL,
	"channel" "app"."channel" NOT NULL,
	"external_listing_id" text NOT NULL,
	"status" "app"."listing_status" DEFAULT 'live' NOT NULL,
	"live_from" date,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_listings_account_external_key" UNIQUE("channel_account_id","external_listing_id")
);
--> statement-breakpoint
CREATE TABLE "app"."channex_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"channel_account_id" uuid NOT NULL,
	"channex_channel_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channex_channels_account_key" UNIQUE("channel_account_id"),
	CONSTRAINT "channex_channels_channex_key" UNIQUE("channex_channel_id")
);
--> statement-breakpoint
CREATE TABLE "app"."channex_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"channex_property_id" text NOT NULL,
	"channex_room_type_id" text,
	"channex_rate_plan_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channex_mappings_property_key" UNIQUE("property_id"),
	CONSTRAINT "channex_mappings_channex_property_key" UNIQUE("channex_property_id")
);
--> statement-breakpoint
CREATE TABLE "app"."app_users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"full_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	CONSTRAINT "app_users_email_key" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "app"."invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "app"."member_role" NOT NULL,
	"invited_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"accepted_by" uuid
);
--> statement-breakpoint
CREATE TABLE "app"."memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "app"."member_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_org_user_key" UNIQUE("organisation_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "app"."organisation_brand" (
	"organisation_id" uuid PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"logo_light_url" text,
	"logo_dark_url" text,
	"accent_hex" text,
	"sender_name" text,
	"sender_email" text,
	"email_domain" text,
	"legal_footer" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organisation_brand_accent_hex" CHECK ("app"."organisation_brand"."accent_hex" ~ '^#[0-9A-Fa-f]{6}$')
);
--> statement-breakpoint
CREATE TABLE "app"."organisation_settings" (
	"organisation_id" uuid PRIMARY KEY NOT NULL,
	"currency" char(3) DEFAULT 'GBP' NOT NULL,
	"time_zone" text DEFAULT 'Europe/London' NOT NULL,
	"locale" text DEFAULT 'en-GB' NOT NULL,
	"country_code" char(2) DEFAULT 'GB' NOT NULL,
	"vat_number" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."organisations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"legal_name" text,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organisations_slug_key" UNIQUE("slug"),
	CONSTRAINT "organisations_slug_format" CHECK ("app"."organisations"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
CREATE TABLE "app"."ari_outbox" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."ari_outbox_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"organisation_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"kind" "app"."outbox_kind" NOT NULL,
	"date_from" date NOT NULL,
	"date_to" date NOT NULL,
	"status" "app"."outbox_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"last_error" text,
	"provider_task_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app"."audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"organisation_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."sync_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."sync_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"organisation_id" uuid NOT NULL,
	"property_id" uuid,
	"direction" text NOT NULL,
	"kind" text NOT NULL,
	"provider_task_id" text,
	"status" text NOT NULL,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."webhook_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."webhook_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"provider" text NOT NULL,
	"event" text NOT NULL,
	"external_property_id" text,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organisation_id" uuid,
	"processed_at" timestamp with time zone,
	"locked_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "app"."properties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"internal_code" text,
	"address_line1" text,
	"address_line2" text,
	"city" text,
	"postcode" text,
	"country_code" char(2) NOT NULL,
	"area" text,
	"property_type" text,
	"bedrooms" integer,
	"max_guests" integer NOT NULL,
	"check_in_time" time DEFAULT '15:00' NOT NULL,
	"check_out_time" time DEFAULT '10:00' NOT NULL,
	"slack_channel" text,
	"managed_by" "app"."managed_by" DEFAULT 'guesty' NOT NULL,
	"price_owner" "app"."price_owner" DEFAULT 'v01' NOT NULL,
	"min_price_minor" integer,
	"max_price_minor" integer,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "properties_org_code_key" UNIQUE("organisation_id","internal_code"),
	CONSTRAINT "properties_max_guests_positive" CHECK ("app"."properties"."max_guests" > 0),
	CONSTRAINT "properties_price_limits" CHECK ("app"."properties"."min_price_minor" is null or "app"."properties"."max_price_minor" is null or "app"."properties"."min_price_minor" <= "app"."properties"."max_price_minor")
);
--> statement-breakpoint
ALTER TABLE "app"."blocks" ADD CONSTRAINT "blocks_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "app"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."blocks" ADD CONSTRAINT "blocks_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "app"."properties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."blocks" ADD CONSTRAINT "blocks_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."channex_bookings" ADD CONSTRAINT "channex_bookings_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "app"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."channex_bookings" ADD CONSTRAINT "channex_bookings_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "app"."reservations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."guests" ADD CONSTRAINT "guests_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "app"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."occupancies" ADD CONSTRAINT "occupancies_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "app"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."occupancies" ADD CONSTRAINT "occupancies_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "app"."properties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reservation_revisions" ADD CONSTRAINT "reservation_revisions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "app"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reservation_revisions" ADD CONSTRAINT "reservation_revisions_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "app"."reservations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reservations" ADD CONSTRAINT "reservations_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "app"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reservations" ADD CONSTRAINT "reservations_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "app"."properties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reservations" ADD CONSTRAINT "reservations_channel_account_id_channel_accounts_id_fk" FOREIGN KEY ("channel_account_id") REFERENCES "app"."channel_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reservations" ADD CONSTRAINT "reservations_guest_id_guests_id_fk" FOREIGN KEY ("guest_id") REFERENCES "app"."guests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."channel_accounts" ADD CONSTRAINT "channel_accounts_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "app"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."channel_listings" ADD CONSTRAINT "channel_listings_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "app"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."channel_listings" ADD CONSTRAINT "channel_listings_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "app"."properties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."channel_listings" ADD CONSTRAINT "channel_listings_account_channel_fk" FOREIGN KEY ("channel_account_id","channel") REFERENCES "app"."channel_accounts"("id","channel") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."channex_channels" ADD CONSTRAINT "channex_channels_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "app"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."channex_channels" ADD CONSTRAINT "channex_channels_channel_account_id_channel_accounts_id_fk" FOREIGN KEY ("channel_account_id") REFERENCES "app"."channel_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."channex_mappings" ADD CONSTRAINT "channex_mappings_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "app"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."channex_mappings" ADD CONSTRAINT "channex_mappings_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "app"."properties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."invitations" ADD CONSTRAINT "invitations_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "app"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."invitations" ADD CONSTRAINT "invitations_invited_by_app_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "app"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."invitations" ADD CONSTRAINT "invitations_accepted_by_app_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "app"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."memberships" ADD CONSTRAINT "memberships_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "app"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."memberships" ADD CONSTRAINT "memberships_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."organisation_brand" ADD CONSTRAINT "organisation_brand_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "app"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."organisation_settings" ADD CONSTRAINT "organisation_settings_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "app"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ari_outbox" ADD CONSTRAINT "ari_outbox_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "app"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ari_outbox" ADD CONSTRAINT "ari_outbox_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "app"."properties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."audit_log" ADD CONSTRAINT "audit_log_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "app"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."sync_log" ADD CONSTRAINT "sync_log_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "app"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."sync_log" ADD CONSTRAINT "sync_log_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "app"."properties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."webhook_events" ADD CONSTRAINT "webhook_events_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "app"."organisations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."properties" ADD CONSTRAINT "properties_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "app"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "blocks_org_idx" ON "app"."blocks" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "blocks_property_idx" ON "app"."blocks" USING btree ("property_id","starts_on");--> statement-breakpoint
CREATE INDEX "channex_bookings_org_idx" ON "app"."channex_bookings" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "guests_org_idx" ON "app"."guests" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "occupancies_org_idx" ON "app"."occupancies" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "reservation_revisions_org_idx" ON "app"."reservation_revisions" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "reservations_org_idx" ON "app"."reservations" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "reservations_property_dates_idx" ON "app"."reservations" USING btree ("property_id","check_in");--> statement-breakpoint
CREATE INDEX "channel_accounts_org_idx" ON "app"."channel_accounts" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "channel_listings_org_idx" ON "app"."channel_listings" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "channel_listings_property_idx" ON "app"."channel_listings" USING btree ("property_id");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_listings_one_live_per_channel" ON "app"."channel_listings" USING btree ("property_id","channel") WHERE "app"."channel_listings"."status" = 'live';--> statement-breakpoint
CREATE INDEX "channex_channels_org_idx" ON "app"."channex_channels" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "channex_mappings_org_idx" ON "app"."channex_mappings" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "invitations_org_idx" ON "app"."invitations" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "invitations_email_idx" ON "app"."invitations" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "app"."memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ari_outbox_org_idx" ON "app"."ari_outbox" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "ari_outbox_due_idx" ON "app"."ari_outbox" USING btree ("next_attempt_at") WHERE "app"."ari_outbox"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "audit_log_org_created_idx" ON "app"."audit_log" USING btree ("organisation_id","created_at");--> statement-breakpoint
CREATE INDEX "sync_log_org_created_idx" ON "app"."sync_log" USING btree ("organisation_id","created_at");--> statement-breakpoint
CREATE INDEX "webhook_events_unprocessed_idx" ON "app"."webhook_events" USING btree ("received_at") WHERE "app"."webhook_events"."processed_at" is null;--> statement-breakpoint
CREATE INDEX "properties_org_idx" ON "app"."properties" USING btree ("organisation_id");