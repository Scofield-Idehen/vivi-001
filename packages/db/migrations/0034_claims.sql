CREATE TABLE "app"."claim_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"claim_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"storage_path" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"bytes" bigint NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claim_files_storage_path_key" UNIQUE("storage_path"),
	CONSTRAINT "claim_files_kind" CHECK ("app"."claim_files"."kind" in ('photo', 'receipt', 'other')),
	CONSTRAINT "claim_files_name_length" CHECK (char_length("app"."claim_files"."file_name") between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "app"."claim_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"claim_id" uuid NOT NULL,
	"description" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claim_items_description_length" CHECK (char_length("app"."claim_items"."description") between 1 and 300),
	CONSTRAINT "claim_items_amount" CHECK ("app"."claim_items"."amount_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "app"."claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"place" text NOT NULL,
	"deadline" date NOT NULL,
	"summary" text,
	"filed_on" date,
	"filed_reference" text,
	"received_minor" bigint,
	"outcome" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claims_reservation_key" UNIQUE("reservation_id"),
	CONSTRAINT "claims_status" CHECK ("app"."claims"."status" in ('open', 'filed', 'paid', 'closed')),
	CONSTRAINT "claims_place" CHECK ("app"."claims"."place" in ('airbnb', 'booking_com', 'vrbo', 'expedia', 'guest', 'insurer')),
	CONSTRAINT "claims_summary_length" CHECK ("app"."claims"."summary" is null or char_length("app"."claims"."summary") <= 4000),
	CONSTRAINT "claims_outcome_length" CHECK ("app"."claims"."outcome" is null or char_length("app"."claims"."outcome") <= 2000),
	CONSTRAINT "claims_reference_length" CHECK ("app"."claims"."filed_reference" is null or char_length("app"."claims"."filed_reference") <= 120),
	CONSTRAINT "claims_received" CHECK ("app"."claims"."received_minor" is null or "app"."claims"."received_minor" >= 0)
);
--> statement-breakpoint
ALTER TABLE "app"."claim_files" ADD CONSTRAINT "claim_files_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "app"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."claim_files" ADD CONSTRAINT "claim_files_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "app"."claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."claim_files" ADD CONSTRAINT "claim_files_uploaded_by_app_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "app"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."claim_items" ADD CONSTRAINT "claim_items_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "app"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."claim_items" ADD CONSTRAINT "claim_items_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "app"."claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."claims" ADD CONSTRAINT "claims_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "app"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."claims" ADD CONSTRAINT "claims_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "app"."reservations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."claims" ADD CONSTRAINT "claims_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "claim_files_claim_idx" ON "app"."claim_files" USING btree ("claim_id");--> statement-breakpoint
CREATE INDEX "claim_items_claim_idx" ON "app"."claim_items" USING btree ("claim_id");--> statement-breakpoint
CREATE INDEX "claims_org_status_idx" ON "app"."claims" USING btree ("organisation_id","status","deadline");