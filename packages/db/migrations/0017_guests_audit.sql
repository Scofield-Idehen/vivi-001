-- A guest's name, email and phone can be changed by the team (PATCH /v1/reservations/:id), so
-- those changes belong in the audit trail like every other edit to a booking.
CREATE TRIGGER guests_audit AFTER INSERT OR UPDATE OR DELETE ON app.guests
  FOR EACH ROW EXECUTE FUNCTION app.audit_row();
