-- Card requests (Stripe) on bookings (1 Nov 2026): the operator's own rows, by home, audited.
SELECT app.enable_tenant_rls('app.card_requests', 'SELECT, INSERT, UPDATE');
--> statement-breakpoint
CREATE POLICY home_access ON app.card_requests AS RESTRICTIVE USING
  ((SELECT app.my_homes()) IS NULL OR EXISTS (SELECT 1 FROM app.reservations r WHERE r.id = reservation_id));
--> statement-breakpoint
CREATE TRIGGER card_requests_audit AFTER INSERT OR UPDATE OR DELETE ON app.card_requests
  FOR EACH ROW EXECUTE FUNCTION app.audit_row();
--> statement-breakpoint
CREATE TRIGGER card_requests_touch BEFORE UPDATE ON app.card_requests
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
