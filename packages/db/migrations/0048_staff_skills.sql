CREATE TABLE "app"."guesty_staff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"guesty_user_id" text NOT NULL,
	"full_name" text NOT NULL,
	"email" text,
	"phone" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"skills" text[] DEFAULT '{}'::text[] NOT NULL,
	"property_ids" uuid[],
	"user_id" uuid,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guesty_staff_user_key" UNIQUE("organisation_id","guesty_user_id")
);
--> statement-breakpoint
ALTER TABLE "app"."invitations" ADD COLUMN "skills" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."memberships" ADD COLUMN "skills" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."guesty_staff" ADD CONSTRAINT "guesty_staff_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "app"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "guesty_staff_org_idx" ON "app"."guesty_staff" USING btree ("organisation_id");--> statement-breakpoint
ALTER TABLE "app"."invitations" ADD CONSTRAINT "invitations_skills" CHECK ("app"."invitations"."skills" <@ array['cleaning', 'maintenance']::text[]);--> statement-breakpoint
ALTER TABLE "app"."memberships" ADD CONSTRAINT "memberships_skills" CHECK ("app"."memberships"."skills" <@ array['cleaning', 'maintenance']::text[]);