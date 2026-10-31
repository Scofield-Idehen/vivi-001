-- Statements belong to one operator.
SELECT app.enable_tenant_rls('app.owner_statements');
--> statement-breakpoint
CREATE TRIGGER owner_statements_audit AFTER INSERT OR UPDATE OR DELETE ON app.owner_statements
  FOR EACH ROW EXECUTE FUNCTION app.audit_row();
--> statement-breakpoint
CREATE TRIGGER owner_statements_touch BEFORE UPDATE ON app.owner_statements
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
