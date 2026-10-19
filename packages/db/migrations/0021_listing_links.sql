ALTER TYPE "app"."listing_status" ADD VALUE 'linking' BEFORE 'live';--> statement-breakpoint
CREATE TABLE "app"."channel_account_listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"channel_account_id" uuid NOT NULL,
	"external_listing_id" text NOT NULL,
	"title" text,
	"url" text,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_account_listings_key" UNIQUE("channel_account_id","external_listing_id")
);
--> statement-breakpoint
ALTER TABLE "app"."channel_accounts" ALTER COLUMN "status" SET DEFAULT 'disconnected';--> statement-breakpoint
ALTER TABLE "app"."channel_accounts" ADD COLUMN "external_account_id" text;--> statement-breakpoint
ALTER TABLE "app"."channel_accounts" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "app"."channel_listings" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "app"."channel_listings" ADD COLUMN "requested_by" uuid;--> statement-breakpoint
ALTER TABLE "app"."channex_channels" ADD COLUMN "connect_url" text;--> statement-breakpoint
ALTER TABLE "app"."channex_channels" ADD COLUMN "active" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."channex_channels" ADD COLUMN "last_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."channel_account_listings" ADD CONSTRAINT "channel_account_listings_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "app"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."channel_account_listings" ADD CONSTRAINT "channel_account_listings_channel_account_id_channel_accounts_id_fk" FOREIGN KEY ("channel_account_id") REFERENCES "app"."channel_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "channel_account_listings_org_idx" ON "app"."channel_account_listings" USING btree ("organisation_id");--> statement-breakpoint
ALTER TABLE "app"."channel_listings" ADD CONSTRAINT "channel_listings_requested_by_app_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "app"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- A cache of what Channex sees; the worker rewrites it, the API only reads it.
SELECT app.enable_tenant_rls('app.channel_account_listings', 'SELECT, INSERT, UPDATE, DELETE');
--> statement-breakpoint
CREATE TRIGGER channel_account_listings_audit AFTER INSERT OR UPDATE OR DELETE ON app.channel_account_listings
  FOR EACH ROW EXECUTE FUNCTION app.audit_row();
