ALTER TYPE "app"."member_role" ADD VALUE 'owner';--> statement-breakpoint
CREATE TABLE "app"."member_homes" (
	"organisation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_homes_organisation_id_user_id_property_id_pk" PRIMARY KEY("organisation_id","user_id","property_id")
);
--> statement-breakpoint
ALTER TABLE "app"."invitations" ADD COLUMN "property_ids" uuid[];--> statement-breakpoint
ALTER TABLE "app"."invitations" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."memberships" ADD COLUMN "homes_limited" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."memberships" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."member_homes" ADD CONSTRAINT "member_homes_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "app"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."member_homes" ADD CONSTRAINT "member_homes_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "app"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_homes_property_idx" ON "app"."member_homes" USING btree ("property_id");