-- The standard custom fields are added when any of them is missing by name, not only when the
-- workspace has no fields at all (a workspace with one test field got none, 19 Oct 2026).
CREATE OR REPLACE FUNCTION app.standard_custom_fields(p_org uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp
AS $$
DECLARE
  n integer;
BEGIN
  INSERT INTO app.custom_fields (organisation_id, name, kind, position)
  SELECT p_org, s.name, s.kind::app.field_kind,
         (SELECT coalesce(max(f.position), -1) FROM app.custom_fields f WHERE f.organisation_id = p_org) + s.ord
    FROM (VALUES
      ('Top lock code', 'secret', 1),
      ('Bottom lock code', 'secret', 2),
      ('Wi-Fi name', 'text', 3),
      ('Wi-Fi password', 'secret', 4),
      ('Check-in instructions', 'link', 5)
    ) AS s(name, kind, ord)
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
--> statement-breakpoint
SELECT app.standard_custom_fields(o.id) FROM app.organisations o;
