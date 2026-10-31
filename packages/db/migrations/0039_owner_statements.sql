CREATE TABLE "app"."owner_statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"month" text NOT NULL,
	"status" text DEFAULT 'final' NOT NULL,
	"snapshot" jsonb NOT NULL,
	"earned_minor" bigint NOT NULL,
	"fee_minor" bigint NOT NULL,
	"expenses_minor" bigint NOT NULL,
	"net_minor" bigint NOT NULL,
	"finalised_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finalised_by" uuid,
	"paid_on" date,
	"paid_reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "owner_statements_owner_month_key" UNIQUE("owner_id","month"),
	CONSTRAINT "owner_statements_status" CHECK ("app"."owner_statements"."status" in ('final', 'paid')),
	CONSTRAINT "owner_statements_month" CHECK ("app"."owner_statements"."month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "owner_statements_reference_length" CHECK ("app"."owner_statements"."paid_reference" is null or char_length("app"."owner_statements"."paid_reference") <= 120)
);
--> statement-breakpoint
ALTER TABLE "app"."owner_statements" ADD CONSTRAINT "owner_statements_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "app"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."owner_statements" ADD CONSTRAINT "owner_statements_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "app"."owners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."owner_statements" ADD CONSTRAINT "owner_statements_finalised_by_app_users_id_fk" FOREIGN KEY ("finalised_by") REFERENCES "app"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "owner_statements_org_month_idx" ON "app"."owner_statements" USING btree ("organisation_id","month");