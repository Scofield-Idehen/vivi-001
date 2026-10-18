CREATE TYPE "app"."channex_setup_status" AS ENUM('queued', 'working', 'done', 'failed');--> statement-breakpoint
CREATE TABLE "app"."channex_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"channex_group_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channex_groups_org_key" UNIQUE("organisation_id"),
	CONSTRAINT "channex_groups_channex_key" UNIQUE("channex_group_id")
);
--> statement-breakpoint
CREATE TABLE "app"."channex_setups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"status" "app"."channex_setup_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"last_error" text,
	"requested_by" uuid,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channex_setups_property_key" UNIQUE("property_id")
);
--> statement-breakpoint
ALTER TABLE "app"."channex_groups" ADD CONSTRAINT "channex_groups_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "app"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."channex_setups" ADD CONSTRAINT "channex_setups_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "app"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."channex_setups" ADD CONSTRAINT "channex_setups_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "app"."properties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."channex_setups" ADD CONSTRAINT "channex_setups_requested_by_app_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "app"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "channex_setups_org_idx" ON "app"."channex_setups" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "channex_setups_due_idx" ON "app"."channex_setups" USING btree ("next_attempt_at") WHERE "app"."channex_setups"."status" in ('queued', 'working');--> statement-breakpoint
-- Both belong to one operator. The API asks for a connection; the worker makes it.
SELECT app.enable_tenant_rls('app.channex_groups');
--> statement-breakpoint
SELECT app.enable_tenant_rls('app.channex_setups');
--> statement-breakpoint
-- Who asked for a connection, and every change of its state, is in the audit log.
CREATE TRIGGER channex_setups_audit AFTER INSERT OR UPDATE OR DELETE ON app.channex_setups
  FOR EACH ROW EXECUTE FUNCTION app.audit_row();
--> statement-breakpoint
CREATE TRIGGER channex_setups_touch BEFORE UPDATE ON app.channex_setups
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
