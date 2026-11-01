-- Owners' contracts, each home's terms, and who is paid for a home (1 Nov 2026).
ALTER TABLE app.expenses
  ADD CONSTRAINT expenses_task_fk FOREIGN KEY (task_id) REFERENCES app.tasks (id) ON DELETE SET NULL;
--> statement-breakpoint
-- One cost per job: a clean or repair logs its expense once.
CREATE UNIQUE INDEX expenses_task_once ON app.expenses (task_id) WHERE task_id IS NOT NULL;
--> statement-breakpoint
SELECT app.enable_tenant_rls('app.owner_contracts');
--> statement-breakpoint
SELECT app.enable_tenant_rls('app.home_terms');
--> statement-breakpoint
SELECT app.enable_tenant_rls('app.home_payees');
--> statement-breakpoint
-- Access by home: terms and payees follow the home; contracts follow the owner.
CREATE POLICY home_access ON app.home_terms AS RESTRICTIVE USING
  ((SELECT app.my_homes()) IS NULL OR property_id = ANY ((SELECT app.my_homes())::uuid[]));
--> statement-breakpoint
CREATE POLICY home_access ON app.home_payees AS RESTRICTIVE USING
  ((SELECT app.my_homes()) IS NULL OR property_id = ANY ((SELECT app.my_homes())::uuid[]));
--> statement-breakpoint
CREATE POLICY home_access ON app.owner_contracts AS RESTRICTIVE USING
  ((SELECT app.my_homes()) IS NULL OR EXISTS (SELECT 1 FROM app.owners o WHERE o.id = owner_id));
--> statement-breakpoint
CREATE TRIGGER owner_contracts_audit AFTER INSERT OR UPDATE OR DELETE ON app.owner_contracts
  FOR EACH ROW EXECUTE FUNCTION app.audit_row();
--> statement-breakpoint
CREATE TRIGGER home_terms_audit AFTER INSERT OR UPDATE OR DELETE ON app.home_terms
  FOR EACH ROW EXECUTE FUNCTION app.audit_row();
--> statement-breakpoint
CREATE TRIGGER home_payees_audit AFTER INSERT OR UPDATE OR DELETE ON app.home_payees
  FOR EACH ROW EXECUTE FUNCTION app.audit_row();
--> statement-breakpoint
CREATE TRIGGER owner_contracts_touch BEFORE UPDATE ON app.owner_contracts
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER home_payees_touch BEFORE UPDATE ON app.home_payees
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
