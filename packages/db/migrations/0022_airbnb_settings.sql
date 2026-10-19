ALTER TABLE "app"."channel_listings" ADD COLUMN "channex_mapping_id" text;--> statement-breakpoint
ALTER TABLE "app"."channel_listings" ADD COLUMN "published_wanted" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."channel_listings" ADD COLUMN "published" boolean;--> statement-breakpoint
ALTER TABLE "app"."channel_listings" ADD COLUMN "settings_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."channel_listings" ADD COLUMN "settings_error" text;--> statement-breakpoint
-- A change to a property's fees or booking rules makes its live Airbnb links due for a settings push.
CREATE OR REPLACE FUNCTION app.listing_settings_due() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp
AS $$
BEGIN
  IF (NEW.base_price_minor, NEW.weekend_price_minor, NEW.cleaning_fee_minor, NEW.extra_guest_fee_minor,
      NEW.extra_guest_from, NEW.security_deposit_minor, NEW.instant_book, NEW.check_in_time,
      NEW.check_out_time, NEW.cancellation_policy, NEW.max_guests)
     IS DISTINCT FROM
     (OLD.base_price_minor, OLD.weekend_price_minor, OLD.cleaning_fee_minor, OLD.extra_guest_fee_minor,
      OLD.extra_guest_from, OLD.security_deposit_minor, OLD.instant_book, OLD.check_in_time,
      OLD.check_out_time, OLD.cancellation_policy, OLD.max_guests) THEN
    UPDATE app.channel_listings SET settings_synced_at = NULL
     WHERE property_id = NEW.id AND channel = 'airbnb' AND status IN ('linking', 'live');
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER properties_listing_settings_due AFTER UPDATE ON app.properties
  FOR EACH ROW EXECUTE FUNCTION app.listing_settings_due();
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.listing_settings_due() FROM PUBLIC;
