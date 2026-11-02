-- A payment link asked for a damage claim points at that claim (2 Nov 2026); a deleted claim leaves the payment on the booking.
ALTER TABLE app.card_requests
  ADD CONSTRAINT card_requests_claim_fk FOREIGN KEY (claim_id) REFERENCES app.claims (id) ON DELETE SET NULL;
