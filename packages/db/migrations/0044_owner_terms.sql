CREATE TABLE "app"."home_payees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"payee_name" text NOT NULL,
	"bank_sealed" "bytea",
	"account_hint" text,
	"reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "home_payees_property_key" UNIQUE("property_id"),
	CONSTRAINT "home_payees_name_length" CHECK (char_length("app"."home_payees"."payee_name") between 1 and 120),
	CONSTRAINT "home_payees_hint" CHECK ("app"."home_payees"."account_hint" is null or "app"."home_payees"."account_hint" ~ '^[0-9]{2,4}$')
);
--> statement-breakpoint
CREATE TABLE "app"."home_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"deal" text NOT NULL,
	"fee_basis_points" integer,
	"rent_minor" bigint,
	"maintenance_by" text DEFAULT 'company' NOT NULL,
	"contract_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "home_terms_property_month_key" UNIQUE("property_id","effective_from"),
	CONSTRAINT "home_terms_deal" CHECK ("app"."home_terms"."deal" in ('percentage', 'fixed_rent', 'no_fee')),
	CONSTRAINT "home_terms_first_of_month" CHECK (extract(day from "app"."home_terms"."effective_from") = 1),
	CONSTRAINT "home_terms_values" CHECK (("app"."home_terms"."deal" = 'percentage' and "app"."home_terms"."fee_basis_points" between 0 and 10000 and "app"."home_terms"."rent_minor" is null)
        or ("app"."home_terms"."deal" = 'fixed_rent' and "app"."home_terms"."rent_minor" >= 0 and "app"."home_terms"."fee_basis_points" is null)
        or ("app"."home_terms"."deal" = 'no_fee' and "app"."home_terms"."fee_basis_points" is null and "app"."home_terms"."rent_minor" is null)),
	CONSTRAINT "home_terms_maintenance" CHECK ("app"."home_terms"."maintenance_by" in ('company', 'owner'))
);
--> statement-breakpoint
CREATE TABLE "app"."owner_contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"title" text NOT NULL,
	"signed_on" date,
	"starts_on" date,
	"ends_on" date,
	"file_path" text,
	"file_name" text,
	"file_type" text,
	"file_bytes" bigint,
	"shared_with_owner" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "owner_contracts_title_length" CHECK (char_length("app"."owner_contracts"."title") between 1 and 120),
	CONSTRAINT "owner_contracts_dates" CHECK ("app"."owner_contracts"."ends_on" is null or "app"."owner_contracts"."starts_on" is null or "app"."owner_contracts"."ends_on" >= "app"."owner_contracts"."starts_on")
);
--> statement-breakpoint
ALTER TABLE "app"."reservation_payments" ADD COLUMN "refund_for" text;--> statement-breakpoint
ALTER TABLE "app"."reservations" ADD COLUMN "cleaning_minor" bigint;--> statement-breakpoint
ALTER TABLE "app"."claims" ADD COLUMN "received_on" date;--> statement-breakpoint
ALTER TABLE "app"."expenses" ADD COLUMN "task_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."properties" ADD COLUMN "cleaning_cost_minor" bigint;--> statement-breakpoint
ALTER TABLE "app"."tasks" ADD COLUMN "cost_minor" bigint;--> statement-breakpoint
ALTER TABLE "app"."home_payees" ADD CONSTRAINT "home_payees_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "app"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."home_payees" ADD CONSTRAINT "home_payees_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "app"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."home_terms" ADD CONSTRAINT "home_terms_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "app"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."home_terms" ADD CONSTRAINT "home_terms_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "app"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."home_terms" ADD CONSTRAINT "home_terms_contract_id_owner_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "app"."owner_contracts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."home_terms" ADD CONSTRAINT "home_terms_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."owner_contracts" ADD CONSTRAINT "owner_contracts_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "app"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."owner_contracts" ADD CONSTRAINT "owner_contracts_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "app"."owners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."owner_contracts" ADD CONSTRAINT "owner_contracts_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "owner_contracts_owner_idx" ON "app"."owner_contracts" USING btree ("owner_id");--> statement-breakpoint
ALTER TABLE "app"."reservation_payments" ADD CONSTRAINT "reservation_payments_refund_for" CHECK ("app"."reservation_payments"."refund_for" is null or ("app"."reservation_payments"."refund_for" in ('stay', 'cleaning') and "app"."reservation_payments"."amount_minor" < 0));