CREATE TABLE "app"."site_bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"check_in" date NOT NULL,
	"check_out" date NOT NULL,
	"adults" integer NOT NULL,
	"children" integer DEFAULT 0 NOT NULL,
	"infants" integer DEFAULT 0 NOT NULL,
	"pets" integer DEFAULT 0 NOT NULL,
	"guest_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"request" text,
	"currency" char(3) NOT NULL,
	"nights_minor" bigint NOT NULL,
	"cleaning_minor" bigint DEFAULT 0 NOT NULL,
	"extra_guests_minor" bigint DEFAULT 0 NOT NULL,
	"service_minor" bigint DEFAULT 0 NOT NULL,
	"total_minor" bigint NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"session_id" text NOT NULL,
	"payment_intent_id" text,
	"url" text,
	"expires_at" timestamp with time zone,
	"reservation_id" uuid,
	"live" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "site_bookings_session_key" UNIQUE("session_id"),
	CONSTRAINT "site_bookings_status" CHECK ("app"."site_bookings"."status" in ('open', 'booked', 'refused', 'expired')),
	CONSTRAINT "site_bookings_dates_order" CHECK ("app"."site_bookings"."check_out" > "app"."site_bookings"."check_in"),
	CONSTRAINT "site_bookings_total" CHECK ("app"."site_bookings"."total_minor" > 0),
	CONSTRAINT "site_bookings_request_length" CHECK ("app"."site_bookings"."request" is null or char_length("app"."site_bookings"."request") <= 1000)
);
--> statement-breakpoint
ALTER TABLE "app"."organisation_settings" ADD COLUMN "booking_site" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."organisation_settings" ADD COLUMN "booking_service_fee_bp" integer;--> statement-breakpoint
ALTER TABLE "app"."organisation_settings" ADD COLUMN "booking_terms" text;--> statement-breakpoint
ALTER TABLE "app"."properties" ADD COLUMN "on_booking_site" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."site_bookings" ADD CONSTRAINT "site_bookings_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "app"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."site_bookings" ADD CONSTRAINT "site_bookings_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "app"."properties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."site_bookings" ADD CONSTRAINT "site_bookings_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "app"."reservations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "site_bookings_org_idx" ON "app"."site_bookings" USING btree ("organisation_id","created_at");