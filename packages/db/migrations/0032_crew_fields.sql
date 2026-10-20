ALTER TABLE "app"."custom_fields" ADD COLUMN "crew_visible" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Cleaners and maintenance both need the bottom lock code to get in (Alpha, 20 Oct 2026).
UPDATE app.custom_fields SET crew_visible = true WHERE lower(name) = 'bottom lock code';
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.standard_custom_fields(p_org uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp
AS $$
DECLARE
  n integer;
BEGIN
  INSERT INTO app.custom_fields (organisation_id, name, kind, position, guest_visible, crew_visible)
  SELECT p_org, s.name, s.kind::app.field_kind,
         (SELECT coalesce(max(f.position), -1) FROM app.custom_fields f WHERE f.organisation_id = p_org) + s.ord,
         s.guest, s.crew
    FROM (VALUES
      ('Top lock code', 'secret', 1, true, false),
      ('Bottom lock code', 'secret', 2, false, true),
      ('Wi-Fi name', 'text', 3, true, false),
      ('Wi-Fi password', 'secret', 4, true, false),
      ('Check-in instructions', 'link', 5, true, false)
    ) AS s(name, kind, ord, guest, crew)
   WHERE NOT EXISTS (
     SELECT 1 FROM app.custom_fields f
      WHERE f.organisation_id = p_org AND lower(f.name) = lower(s.name)
   );
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.standard_custom_fields(uuid) FROM PUBLIC;
