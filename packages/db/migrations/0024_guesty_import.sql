ALTER TYPE "app"."outbox_status" ADD VALUE 'skipped';--> statement-breakpoint
CREATE TABLE "app"."guesty_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"channel" "app"."channel" NOT NULL,
	"account_key" text NOT NULL,
	"channel_account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guesty_accounts_key" UNIQUE("organisation_id","channel","account_key")
);
--> statement-breakpoint
CREATE TABLE "app"."guesty_channel_listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"channel" "app"."channel" NOT NULL,
	"guesty_account_id" uuid NOT NULL,
	"external_listing_id" text NOT NULL,
	"raw" jsonb NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guesty_channel_listings_key" UNIQUE("property_id","channel","external_listing_id")
);
--> statement-breakpoint
CREATE TABLE "app"."guesty_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"dry_run" boolean DEFAULT false NOT NULL,
	"summary" jsonb,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "app"."guesty_listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"guesty_listing_id" text NOT NULL,
	"nickname" text,
	"active" boolean NOT NULL,
	"raw" jsonb NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guesty_listings_guesty_key" UNIQUE("guesty_listing_id"),
	CONSTRAINT "guesty_listings_property_key" UNIQUE("property_id")
);
--> statement-breakpoint
CREATE TABLE "app"."guesty_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"guesty_reservation_id" text NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guesty_reservations_guesty_key" UNIQUE("guesty_reservation_id"),
	CONSTRAINT "guesty_reservations_reservation_key" UNIQUE("reservation_id")
);
--> statement-breakpoint
CREATE TABLE "app"."integration_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"client_id" text NOT NULL,
	"access_token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"remaining_today" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_tokens_key" UNIQUE("provider","client_id")
);
--> statement-breakpoint
ALTER TABLE "app"."guesty_accounts" ADD CONSTRAINT "guesty_accounts_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "app"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."guesty_accounts" ADD CONSTRAINT "guesty_accounts_channel_account_id_channel_accounts_id_fk" FOREIGN KEY ("channel_account_id") REFERENCES "app"."channel_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."guesty_channel_listings" ADD CONSTRAINT "guesty_channel_listings_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "app"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."guesty_channel_listings" ADD CONSTRAINT "guesty_channel_listings_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "app"."properties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."guesty_channel_listings" ADD CONSTRAINT "guesty_channel_listings_guesty_account_id_guesty_accounts_id_fk" FOREIGN KEY ("guesty_account_id") REFERENCES "app"."guesty_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."guesty_imports" ADD CONSTRAINT "guesty_imports_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "app"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."guesty_listings" ADD CONSTRAINT "guesty_listings_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "app"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."guesty_listings" ADD CONSTRAINT "guesty_listings_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "app"."properties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."guesty_reservations" ADD CONSTRAINT "guesty_reservations_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "app"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."guesty_reservations" ADD CONSTRAINT "guesty_reservations_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "app"."reservations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "guesty_accounts_org_idx" ON "app"."guesty_accounts" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "guesty_channel_listings_org_idx" ON "app"."guesty_channel_listings" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "guesty_imports_org_idx" ON "app"."guesty_imports" USING btree ("organisation_id","started_at");--> statement-breakpoint
CREATE INDEX "guesty_listings_org_idx" ON "app"."guesty_listings" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "guesty_reservations_org_idx" ON "app"."guesty_reservations" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "integration_tokens_expiry_idx" ON "app"."integration_tokens" USING btree ("expires_at");--> statement-breakpoint
SELECT app.enable_tenant_rls('app.guesty_imports', 'SELECT, INSERT, UPDATE');
--> statement-breakpoint
SELECT app.enable_tenant_rls('app.guesty_listings', 'SELECT, INSERT, UPDATE, DELETE');
--> statement-breakpoint
SELECT app.enable_tenant_rls('app.guesty_accounts', 'SELECT, INSERT, UPDATE, DELETE');
--> statement-breakpoint
SELECT app.enable_tenant_rls('app.guesty_channel_listings', 'SELECT, INSERT, UPDATE, DELETE');
--> statement-breakpoint
SELECT app.enable_tenant_rls('app.guesty_reservations', 'SELECT, INSERT, UPDATE, DELETE');
--> statement-breakpoint
-- Tokens for outside services: only the worker, which asks for them. Nobody reads them back.
ALTER TABLE app.integration_tokens ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY integration_tokens_worker ON app.integration_tokens TO app_worker USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON app.integration_tokens TO app_worker;
--> statement-breakpoint
-- The standard custom fields every workspace starts with (Alpha, 19 Oct 2026): the two lock codes,
-- the Wi-Fi name and password, and the check-in instructions link. Added when an operator is made,
-- and here once for operators that have no fields yet. An admin can rename or remove them.
CREATE OR REPLACE FUNCTION app.standard_custom_fields(p_org uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp
AS $$
DECLARE
  n integer;
BEGIN
  IF EXISTS (SELECT 1 FROM app.custom_fields f WHERE f.organisation_id = p_org) THEN
    RETURN 0;
  END IF;
  INSERT INTO app.custom_fields (organisation_id, name, kind, position)
  VALUES
    (p_org, 'Top lock code', 'secret', 0),
    (p_org, 'Bottom lock code', 'secret', 1),
    (p_org, 'Wi-Fi name', 'text', 2),
    (p_org, 'Wi-Fi password', 'secret', 3),
    (p_org, 'Check-in instructions', 'link', 4);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.standard_custom_fields(uuid) FROM PUBLIC;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.organisation_standard_fields()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp
AS $$
BEGIN
  PERFORM app.standard_custom_fields(NEW.id);
  RETURN NEW;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.organisation_standard_fields() FROM PUBLIC;
--> statement-breakpoint
DROP TRIGGER IF EXISTS organisations_standard_fields ON app.organisations;
--> statement-breakpoint
CREATE TRIGGER organisations_standard_fields AFTER INSERT ON app.organisations
  FOR EACH ROW EXECUTE FUNCTION app.organisation_standard_fields();
--> statement-breakpoint
SELECT app.standard_custom_fields(o.id) FROM app.organisations o;
--> statement-breakpoint
-- The worker's hand-run tools name an operator by slug (pnpm guesty:import --org vivistays).
CREATE OR REPLACE FUNCTION app.sys_organisation_by_slug(p_slug text)
RETURNS TABLE (id uuid, name text, slug text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp
AS $$
  SELECT o.id, o.name, o.slug FROM app.organisations o WHERE o.slug = p_slug;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.sys_organisation_by_slug(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.sys_organisation_by_slug(text) TO app_worker;
