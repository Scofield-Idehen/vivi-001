CREATE TABLE "app"."calendar_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"night" date NOT NULL,
	"price_minor" integer,
	"min_nights" integer,
	"closed_to_arrival" boolean DEFAULT false NOT NULL,
	"closed_to_departure" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_days_property_night_key" UNIQUE("property_id","night"),
	CONSTRAINT "calendar_days_price_range" CHECK ("app"."calendar_days"."price_minor" is null or "app"."calendar_days"."price_minor" between 1 and 100000000),
	CONSTRAINT "calendar_days_min_nights" CHECK ("app"."calendar_days"."min_nights" is null or "app"."calendar_days"."min_nights" between 1 and 365)
);
--> statement-breakpoint
ALTER TABLE "app"."calendar_days" ADD CONSTRAINT "calendar_days_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "app"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."calendar_days" ADD CONSTRAINT "calendar_days_property_fk" FOREIGN KEY ("organisation_id","property_id") REFERENCES "app"."properties"("organisation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calendar_days_org_night_idx" ON "app"."calendar_days" USING btree ("organisation_id","night");