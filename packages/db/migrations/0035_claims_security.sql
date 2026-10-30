-- Claims belong to one operator, like the bookings they are about.
SELECT app.enable_tenant_rls('app.claims');
--> statement-breakpoint
SELECT app.enable_tenant_rls('app.claim_items');
--> statement-breakpoint
SELECT app.enable_tenant_rls('app.claim_files', 'SELECT, INSERT, DELETE');
--> statement-breakpoint
-- Every change to a claim is in the audit log: a claim is a record someone may be asked to stand behind.
CREATE TRIGGER claims_audit AFTER INSERT OR UPDATE OR DELETE ON app.claims
  FOR EACH ROW EXECUTE FUNCTION app.audit_row();
--> statement-breakpoint
CREATE TRIGGER claim_items_audit AFTER INSERT OR UPDATE OR DELETE ON app.claim_items
  FOR EACH ROW EXECUTE FUNCTION app.audit_row();
--> statement-breakpoint
CREATE TRIGGER claim_files_audit AFTER INSERT OR UPDATE OR DELETE ON app.claim_files
  FOR EACH ROW EXECUTE FUNCTION app.audit_row();
--> statement-breakpoint
CREATE TRIGGER claims_touch BEFORE UPDATE ON app.claims
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
