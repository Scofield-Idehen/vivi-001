-- Nightly prices and stay rules belong to one operator, like the property they describe.
SELECT app.enable_tenant_rls('app.calendar_days');
--> statement-breakpoint
-- Every change is in the audit log: who set which night's price, and what it was before.
CREATE TRIGGER calendar_days_audit AFTER INSERT OR UPDATE OR DELETE ON app.calendar_days
  FOR EACH ROW EXECUTE FUNCTION app.audit_row();
--> statement-breakpoint
CREATE TRIGGER calendar_days_touch BEFORE UPDATE ON app.calendar_days
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
