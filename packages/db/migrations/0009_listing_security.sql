-- Rooms, amenities and photos belong to one operator, like the property they describe.
SELECT app.enable_tenant_rls('app.property_rooms');
--> statement-breakpoint
SELECT app.enable_tenant_rls('app.property_amenities', 'SELECT, INSERT, DELETE');
--> statement-breakpoint
SELECT app.enable_tenant_rls('app.property_photos');
--> statement-breakpoint
-- Every change is in the audit log, and rooms and photos keep their updated_at current.
CREATE TRIGGER property_rooms_audit AFTER INSERT OR UPDATE OR DELETE ON app.property_rooms
  FOR EACH ROW EXECUTE FUNCTION app.audit_row();
--> statement-breakpoint
CREATE TRIGGER property_amenities_audit AFTER INSERT OR UPDATE OR DELETE ON app.property_amenities
  FOR EACH ROW EXECUTE FUNCTION app.audit_row();
--> statement-breakpoint
CREATE TRIGGER property_photos_audit AFTER INSERT OR UPDATE OR DELETE ON app.property_photos
  FOR EACH ROW EXECUTE FUNCTION app.audit_row();
--> statement-breakpoint
CREATE TRIGGER property_rooms_touch BEFORE UPDATE ON app.property_rooms
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER property_photos_touch BEFORE UPDATE ON app.property_photos
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
