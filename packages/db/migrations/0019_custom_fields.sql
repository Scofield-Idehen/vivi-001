CREATE TYPE "app"."field_kind" AS ENUM('text', 'long_text', 'link', 'secret');--> statement-breakpoint
CREATE TABLE "app"."custom_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "app"."field_kind" NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_fields_name_length" CHECK (char_length("app"."custom_fields"."name") between 1 and 60)
);
--> statement-breakpoint
CREATE TABLE "app"."property_field_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"field_id" uuid NOT NULL,
	"value" text,
	"secret" "bytea",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "property_field_values_property_field_key" UNIQUE("property_id","field_id"),
	CONSTRAINT "property_field_values_one_kind" CHECK ("app"."property_field_values"."value" is null or "app"."property_field_values"."secret" is null),
	CONSTRAINT "property_field_values_value_length" CHECK ("app"."property_field_values"."value" is null or char_length("app"."property_field_values"."value") <= 4000)
);
--> statement-breakpoint
ALTER TABLE "app"."custom_fields" ADD CONSTRAINT "custom_fields_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "app"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."property_field_values" ADD CONSTRAINT "property_field_values_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "app"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."property_field_values" ADD CONSTRAINT "property_field_values_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "app"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."property_field_values" ADD CONSTRAINT "property_field_values_field_id_custom_fields_id_fk" FOREIGN KEY ("field_id") REFERENCES "app"."custom_fields"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "custom_fields_org_idx" ON "app"."custom_fields" USING btree ("organisation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_fields_org_name_key" ON "app"."custom_fields" USING btree ("organisation_id",lower("name"));--> statement-breakpoint
CREATE INDEX "property_field_values_org_idx" ON "app"."property_field_values" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "property_field_values_property_idx" ON "app"."property_field_values" USING btree ("property_id");--> statement-breakpoint
-- Secrets (lock codes, Wi-Fi passwords) arrive already encrypted by the API (AES-256-GCM with
-- FIELD_SECRET_KEY): neither the plain text nor the key ever reaches the database or its logs.
--> statement-breakpoint
-- Both belong to one operator.
SELECT app.enable_tenant_rls('app.custom_fields');
--> statement-breakpoint
SELECT app.enable_tenant_rls('app.property_field_values');
--> statement-breakpoint
-- Every change is in the audit log. A secret's bytes are there encrypted, as they are in the table.
CREATE TRIGGER custom_fields_audit AFTER INSERT OR UPDATE OR DELETE ON app.custom_fields
  FOR EACH ROW EXECUTE FUNCTION app.audit_row();
--> statement-breakpoint
CREATE TRIGGER property_field_values_audit AFTER INSERT OR UPDATE OR DELETE ON app.property_field_values
  FOR EACH ROW EXECUTE FUNCTION app.audit_row();
--> statement-breakpoint
CREATE TRIGGER custom_fields_touch BEFORE UPDATE ON app.custom_fields
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER property_field_values_touch BEFORE UPDATE ON app.property_field_values
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
