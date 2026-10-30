CREATE TABLE "app"."expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"property_id" uuid,
	"claim_id" uuid,
	"spent_on" date NOT NULL,
	"category" text NOT NULL,
	"description" text NOT NULL,
	"vendor" text,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"charge_to" text DEFAULT 'owner' NOT NULL,
	"receipt_path" text,
	"receipt_name" text,
	"receipt_type" text,
	"receipt_bytes" bigint,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expenses_category" CHECK ("app"."expenses"."category" in ('cleaning', 'laundry', 'repairs', 'supplies', 'utilities', 'furnishing', 'other')),
	CONSTRAINT "expenses_charge_to" CHECK ("app"."expenses"."charge_to" in ('owner', 'company')),
	CONSTRAINT "expenses_description_length" CHECK (char_length("app"."expenses"."description") between 1 and 300),
	CONSTRAINT "expenses_amount" CHECK ("app"."expenses"."amount_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "app"."owners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"company" text,
	"email" text,
	"phone" text,
	"fee_basis_points" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "owners_name_length" CHECK (char_length("app"."owners"."name") between 1 and 120),
	CONSTRAINT "owners_fee" CHECK ("app"."owners"."fee_basis_points" between 0 and 10000),
	CONSTRAINT "owners_notes_length" CHECK ("app"."owners"."notes" is null or char_length("app"."owners"."notes") <= 2000)
);
--> statement-breakpoint
ALTER TABLE "app"."properties" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."expenses" ADD CONSTRAINT "expenses_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "app"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."expenses" ADD CONSTRAINT "expenses_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "app"."properties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."expenses" ADD CONSTRAINT "expenses_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "app"."claims"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."expenses" ADD CONSTRAINT "expenses_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."owners" ADD CONSTRAINT "owners_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "app"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expenses_org_spent_idx" ON "app"."expenses" USING btree ("organisation_id","spent_on");--> statement-breakpoint
CREATE INDEX "expenses_property_idx" ON "app"."expenses" USING btree ("property_id","spent_on");--> statement-breakpoint
CREATE INDEX "expenses_claim_idx" ON "app"."expenses" USING btree ("claim_id");--> statement-breakpoint
CREATE INDEX "owners_org_idx" ON "app"."owners" USING btree ("organisation_id");