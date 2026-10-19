CREATE TYPE "app"."task_kind" AS ENUM('cleaning', 'maintenance', 'inspection');--> statement-breakpoint
CREATE TYPE "app"."task_status" AS ENUM('open', 'in_progress', 'done', 'cancelled');--> statement-breakpoint
CREATE TABLE "app"."task_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"storage_path" text NOT NULL,
	"url" text NOT NULL,
	"width" integer,
	"height" integer,
	"taken_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_photos_storage_path_key" UNIQUE("storage_path")
);
--> statement-breakpoint
CREATE TABLE "app"."task_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"kind" "app"."task_kind" NOT NULL,
	"title" text NOT NULL,
	"checklist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"automatic" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_templates_org_kind_key" UNIQUE("organisation_id","kind"),
	CONSTRAINT "task_templates_title_length" CHECK (char_length("app"."task_templates"."title") between 1 and 120)
);
--> statement-breakpoint
CREATE TABLE "app"."tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"reservation_id" uuid,
	"kind" "app"."task_kind" NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"status" "app"."task_status" DEFAULT 'open' NOT NULL,
	"due_on" date NOT NULL,
	"due_time" time,
	"assignee_user_id" uuid,
	"checklist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" uuid,
	"done_by" uuid,
	"done_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_source" CHECK ("app"."tasks"."source" in ('check_out', 'manual', 'report')),
	CONSTRAINT "tasks_title_length" CHECK (char_length("app"."tasks"."title") between 1 and 120),
	CONSTRAINT "tasks_notes_length" CHECK ("app"."tasks"."notes" is null or char_length("app"."tasks"."notes") <= 4000)
);
--> statement-breakpoint
ALTER TABLE "app"."properties" ADD COLUMN "cleaner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."task_photos" ADD CONSTRAINT "task_photos_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "app"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."task_photos" ADD CONSTRAINT "task_photos_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "app"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."task_photos" ADD CONSTRAINT "task_photos_taken_by_app_users_id_fk" FOREIGN KEY ("taken_by") REFERENCES "app"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."task_templates" ADD CONSTRAINT "task_templates_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "app"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tasks" ADD CONSTRAINT "tasks_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "app"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tasks" ADD CONSTRAINT "tasks_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "app"."reservations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tasks" ADD CONSTRAINT "tasks_assignee_user_id_app_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "app"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tasks" ADD CONSTRAINT "tasks_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tasks" ADD CONSTRAINT "tasks_done_by_app_users_id_fk" FOREIGN KEY ("done_by") REFERENCES "app"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tasks" ADD CONSTRAINT "tasks_property_fk" FOREIGN KEY ("organisation_id","property_id") REFERENCES "app"."properties"("organisation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_photos_task_idx" ON "app"."task_photos" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "tasks_org_due_idx" ON "app"."tasks" USING btree ("organisation_id","due_on");--> statement-breakpoint
CREATE INDEX "tasks_property_idx" ON "app"."tasks" USING btree ("property_id","status");--> statement-breakpoint
CREATE INDEX "tasks_assignee_idx" ON "app"."tasks" USING btree ("assignee_user_id","due_on");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_check_out_once" ON "app"."tasks" USING btree ("reservation_id","kind") WHERE "app"."tasks"."source" = 'check_out';--> statement-breakpoint
ALTER TABLE "app"."properties" ADD CONSTRAINT "properties_cleaner_user_id_app_users_id_fk" FOREIGN KEY ("cleaner_user_id") REFERENCES "app"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
SELECT app.enable_tenant_rls('app.tasks');
--> statement-breakpoint
SELECT app.enable_tenant_rls('app.task_templates', 'SELECT, INSERT, UPDATE');
--> statement-breakpoint
CREATE TRIGGER tasks_touch BEFORE UPDATE ON app.tasks
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER task_templates_touch BEFORE UPDATE ON app.task_templates
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER tasks_audit AFTER INSERT OR UPDATE OR DELETE ON app.tasks
  FOR EACH ROW EXECUTE FUNCTION app.audit_row();
--> statement-breakpoint
CREATE TRIGGER task_templates_audit AFTER INSERT OR UPDATE OR DELETE ON app.task_templates
  FOR EACH ROW EXECUTE FUNCTION app.audit_row();
--> statement-breakpoint
-- What each kind of task starts with. Made with the workspace; an admin edits them on the Tasks page.
CREATE OR REPLACE FUNCTION app.standard_task_templates(p_org uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp
AS $$
DECLARE
  n integer;
BEGIN
  INSERT INTO app.task_templates (organisation_id, kind, title, checklist, automatic)
  SELECT p_org, s.kind::app.task_kind, s.title, s.checklist::jsonb, s.automatic
    FROM (VALUES
      ('cleaning', 'Clean after check-out',
       '["Strip and remake every bed", "Bathrooms: shower, basin, toilet, mirrors, fresh towels", "Kitchen: surfaces, hob, oven, fridge, bins out, dishwasher empty", "Floors throughout", "Restock: toilet rolls, bin bags, tea and coffee, toiletries", "Check for damage and anything left behind", "Windows and doors locked, heating as set, lights off"]',
       true),
      ('maintenance', 'Maintenance visit', '["Note what was found", "Note what was fixed or still needs doing"]', false),
      ('inspection', 'Inspection', '["Walk every room", "Note anything worn, broken or missing"]', false)
    ) AS s(kind, title, checklist, automatic)
   WHERE NOT EXISTS (
     SELECT 1 FROM app.task_templates t WHERE t.organisation_id = p_org AND t.kind = s.kind::app.task_kind
   );
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.standard_task_templates(uuid) FROM PUBLIC;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.organisation_standard_fields()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp
AS $$
BEGIN
  PERFORM app.standard_custom_fields(NEW.id);
  PERFORM app.standard_task_templates(NEW.id);
  RETURN NEW;
END
$$;
--> statement-breakpoint
SELECT app.standard_task_templates(o.id) FROM app.organisations o;
--> statement-breakpoint
SELECT app.enable_tenant_rls('app.task_photos');
--> statement-breakpoint
CREATE TRIGGER task_photos_audit AFTER INSERT OR UPDATE OR DELETE ON app.task_photos
  FOR EACH ROW EXECUTE FUNCTION app.audit_row();
