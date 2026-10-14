-- Only a deliberate move-over step may hand a property's channel listings to V-01.
--
-- While a property is on Guesty, Guesty runs its Airbnb, Booking.com and Vrbo listings. If V-01 ran
-- them too, the same home could be listed or booked twice. So V-01 sends nothing for a property until
-- managed_by is 'v01', and this trigger stops the API and worker roles from ever setting that, either
-- on a new property or by switching one. The Phase 1 move-over step will be a function owned by the
-- database owner, which first checks the property's listings are off Guesty.
CREATE FUNCTION app.guard_move_to_v01()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = app, pg_temp
AS $$
BEGIN
  IF NEW.managed_by = 'v01'
     AND (TG_OP = 'INSERT' OR OLD.managed_by IS DISTINCT FROM NEW.managed_by)
     AND current_user IN ('app_base', 'app_api', 'app_worker', 'app_jobs') THEN
    RAISE EXCEPTION 'Only the move-over step can hand a property''s channels to V-01'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.guard_move_to_v01() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER properties_guard_move_to_v01
  BEFORE INSERT OR UPDATE OF managed_by ON app.properties
  FOR EACH ROW EXECUTE FUNCTION app.guard_move_to_v01();
