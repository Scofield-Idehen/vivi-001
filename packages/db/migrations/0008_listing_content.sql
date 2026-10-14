CREATE TYPE "app"."cancellation_policy" AS ENUM('flexible', 'moderate', 'firm', 'strict', 'non_refundable');--> statement-breakpoint
CREATE TYPE "app"."check_in_method" AS ENUM('smart_lock', 'keypad', 'lockbox', 'host_greets', 'building_staff');--> statement-breakpoint
CREATE TYPE "app"."room_kind" AS ENUM('bedroom', 'living_room', 'other');--> statement-breakpoint
CREATE TABLE "app"."property_amenities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "property_amenities_property_code_key" UNIQUE("property_id","code")
);
--> statement-breakpoint
CREATE TABLE "app"."property_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"storage_path" text NOT NULL,
	"url" text NOT NULL,
	"position" integer NOT NULL,
	"caption" text,
	"room_id" uuid,
	"width" integer,
	"height" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "property_photos_storage_path_key" UNIQUE("storage_path"),
	CONSTRAINT "property_photos_caption_length" CHECK (char_length("app"."property_photos"."caption") <= 200)
);
--> statement-breakpoint
CREATE TABLE "app"."property_rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"kind" "app"."room_kind" NOT NULL,
	"name" text,
	"beds" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"private_bathroom" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "property_rooms_beds_array" CHECK (jsonb_typeof("app"."property_rooms"."beds") = 'array')
);
--> statement-breakpoint
ALTER TABLE "app"."properties" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "app"."properties" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "app"."properties" ADD COLUMN "the_space" text;--> statement-breakpoint
ALTER TABLE "app"."properties" ADD COLUMN "guest_access" text;--> statement-breakpoint
ALTER TABLE "app"."properties" ADD COLUMN "neighbourhood" text;--> statement-breakpoint
ALTER TABLE "app"."properties" ADD COLUMN "getting_around" text;--> statement-breakpoint
ALTER TABLE "app"."properties" ADD COLUMN "other_notes" text;--> statement-breakpoint
ALTER TABLE "app"."properties" ADD COLUMN "check_in_method" "app"."check_in_method";--> statement-breakpoint
ALTER TABLE "app"."properties" ADD COLUMN "pets_allowed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."properties" ADD COLUMN "smoking_allowed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."properties" ADD COLUMN "events_allowed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."properties" ADD COLUMN "children_allowed" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."properties" ADD COLUMN "quiet_hours_start" time;--> statement-breakpoint
ALTER TABLE "app"."properties" ADD COLUMN "quiet_hours_end" time;--> statement-breakpoint
ALTER TABLE "app"."properties" ADD COLUMN "house_rules" text;--> statement-breakpoint
ALTER TABLE "app"."properties" ADD COLUMN "min_nights" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."properties" ADD COLUMN "max_nights" integer;--> statement-breakpoint
ALTER TABLE "app"."properties" ADD COLUMN "instant_book" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."properties" ADD COLUMN "advance_notice_hours" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."properties" ADD COLUMN "booking_window_days" integer DEFAULT 365;--> statement-breakpoint
ALTER TABLE "app"."properties" ADD COLUMN "preparation_days" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."properties" ADD COLUMN "cancellation_policy" "app"."cancellation_policy" DEFAULT 'moderate' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."properties" ADD COLUMN "base_price_minor" integer;--> statement-breakpoint
ALTER TABLE "app"."properties" ADD COLUMN "weekend_price_minor" integer;--> statement-breakpoint
ALTER TABLE "app"."properties" ADD COLUMN "cleaning_fee_minor" integer;--> statement-breakpoint
ALTER TABLE "app"."properties" ADD COLUMN "extra_guest_fee_minor" integer;--> statement-breakpoint
ALTER TABLE "app"."properties" ADD COLUMN "extra_guest_from" integer;--> statement-breakpoint
ALTER TABLE "app"."properties" ADD COLUMN "security_deposit_minor" integer;--> statement-breakpoint
ALTER TABLE "app"."properties" ADD COLUMN "licence_number" text;--> statement-breakpoint
-- The composite keys below need this first: drizzle-kit wrote it after them.
ALTER TABLE "app"."properties" ADD CONSTRAINT "properties_org_id_key" UNIQUE("organisation_id","id");--> statement-breakpoint
ALTER TABLE "app"."property_amenities" ADD CONSTRAINT "property_amenities_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "app"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."property_amenities" ADD CONSTRAINT "property_amenities_property_fk" FOREIGN KEY ("organisation_id","property_id") REFERENCES "app"."properties"("organisation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."property_photos" ADD CONSTRAINT "property_photos_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "app"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."property_photos" ADD CONSTRAINT "property_photos_room_id_property_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "app"."property_rooms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."property_photos" ADD CONSTRAINT "property_photos_property_fk" FOREIGN KEY ("organisation_id","property_id") REFERENCES "app"."properties"("organisation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."property_rooms" ADD CONSTRAINT "property_rooms_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "app"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."property_rooms" ADD CONSTRAINT "property_rooms_property_fk" FOREIGN KEY ("organisation_id","property_id") REFERENCES "app"."properties"("organisation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "property_photos_property_idx" ON "app"."property_photos" USING btree ("property_id","position");--> statement-breakpoint
CREATE INDEX "property_rooms_property_idx" ON "app"."property_rooms" USING btree ("property_id","position");--> statement-breakpoint
ALTER TABLE "app"."properties" ADD CONSTRAINT "properties_title_length" CHECK (char_length("app"."properties"."title") <= 50);--> statement-breakpoint
ALTER TABLE "app"."properties" ADD CONSTRAINT "properties_summary_length" CHECK (char_length("app"."properties"."summary") <= 500);--> statement-breakpoint
ALTER TABLE "app"."properties" ADD CONSTRAINT "properties_stay_lengths" CHECK ("app"."properties"."min_nights" >= 1 and ("app"."properties"."max_nights" is null or "app"."properties"."max_nights" >= "app"."properties"."min_nights"));--> statement-breakpoint
ALTER TABLE "app"."properties" ADD CONSTRAINT "properties_quiet_hours" CHECK (("app"."properties"."quiet_hours_start" is null) = ("app"."properties"."quiet_hours_end" is null));--> statement-breakpoint
ALTER TABLE "app"."properties" ADD CONSTRAINT "properties_booking_rules" CHECK ("app"."properties"."advance_notice_hours" >= 0 and "app"."properties"."preparation_days" >= 0 and ("app"."properties"."booking_window_days" is null or "app"."properties"."booking_window_days" > 0));--> statement-breakpoint
ALTER TABLE "app"."properties" ADD CONSTRAINT "properties_fees_positive" CHECK (coalesce("app"."properties"."base_price_minor", 1) > 0 and coalesce("app"."properties"."weekend_price_minor", 1) > 0
          and coalesce("app"."properties"."cleaning_fee_minor", 1) > 0 and coalesce("app"."properties"."extra_guest_fee_minor", 1) > 0
          and coalesce("app"."properties"."security_deposit_minor", 1) > 0 and coalesce("app"."properties"."extra_guest_from", 1) > 0);