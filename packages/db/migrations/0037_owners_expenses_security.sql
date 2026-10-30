-- Owners and expenses belong to one operator.
SELECT app.enable_tenant_rls('app.owners');
--> statement-breakpoint
SELECT app.enable_tenant_rls('app.expenses');
--> statement-breakpoint
-- A home's owner; removing an owner leaves the home with nobody recorded. The API checks the owner
-- is in the same workspace before setting it.
ALTER TABLE app.properties ADD CONSTRAINT properties_owner_fk
  FOREIGN KEY (owner_id) REFERENCES app.owners(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX properties_owner_idx ON app.properties (owner_id);
--> statement-breakpoint
CREATE TRIGGER owners_audit AFTER INSERT OR UPDATE OR DELETE ON app.owners
  FOR EACH ROW EXECUTE FUNCTION app.audit_row();
--> statement-breakpoint
CREATE TRIGGER expenses_audit AFTER INSERT OR UPDATE OR DELETE ON app.expenses
  FOR EACH ROW EXECUTE FUNCTION app.audit_row();
--> statement-breakpoint
CREATE TRIGGER owners_touch BEFORE UPDATE ON app.owners
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER expenses_touch BEFORE UPDATE ON app.expenses
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
