CREATE TYPE "app"."platform_role" AS ENUM('owner', 'support', 'viewer');--> statement-breakpoint
CREATE TABLE "app"."platform_audit" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."platform_audit_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"staff_user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"organisation_id" uuid,
	"grant_id" uuid,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."platform_staff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"user_id" uuid,
	"role" "app"."platform_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_staff_email_key" UNIQUE("email"),
	CONSTRAINT "platform_staff_user_key" UNIQUE("user_id"),
	CONSTRAINT "platform_staff_email_lowercase" CHECK ("app"."platform_staff"."email" = lower("app"."platform_staff"."email"))
);
--> statement-breakpoint
CREATE TABLE "app"."support_access_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"staff_user_id" uuid NOT NULL,
	"staff_email" text NOT NULL,
	"reason" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "support_access_grants_reason_length" CHECK (length(btrim("app"."support_access_grants"."reason")) between 5 and 500),
	CONSTRAINT "support_access_grants_window" CHECK ("app"."support_access_grants"."expires_at" > "app"."support_access_grants"."started_at" and "app"."support_access_grants"."expires_at" <= "app"."support_access_grants"."started_at" + interval '4 hours'),
	CONSTRAINT "support_access_grants_ended_after_start" CHECK ("app"."support_access_grants"."ended_at" is null or "app"."support_access_grants"."ended_at" >= "app"."support_access_grants"."started_at")
);
--> statement-breakpoint
ALTER TABLE "app"."platform_audit" ADD CONSTRAINT "platform_audit_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "app"."organisations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."platform_audit" ADD CONSTRAINT "platform_audit_grant_id_support_access_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "app"."support_access_grants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."platform_staff" ADD CONSTRAINT "platform_staff_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."support_access_grants" ADD CONSTRAINT "support_access_grants_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "app"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."support_access_grants" ADD CONSTRAINT "support_access_grants_staff_user_id_app_users_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "app"."app_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_audit_created_idx" ON "app"."platform_audit" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "platform_audit_org_idx" ON "app"."platform_audit" USING btree ("organisation_id","created_at");--> statement-breakpoint
CREATE INDEX "platform_audit_grant_idx" ON "app"."platform_audit" USING btree ("grant_id");--> statement-breakpoint
CREATE INDEX "support_access_grants_org_idx" ON "app"."support_access_grants" USING btree ("organisation_id","started_at");--> statement-breakpoint
CREATE INDEX "support_access_grants_staff_idx" ON "app"."support_access_grants" USING btree ("staff_user_id","expires_at");