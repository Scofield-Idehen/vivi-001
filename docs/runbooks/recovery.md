# Recovering from an outage: drain before push

From the playbook, Section 8. While V-01 is down, Channex keeps closing dates on the other channels
for new bookings, and holds every booking revision unacknowledged in its feed. What matters is the
order in which we come back.

1. **Restore** the service or database. If data was lost, use point-in-time recovery to just before
   the incident.
2. **Drain.** Pull and save every unacknowledged booking revision. Process modifications and
   cancellations first. Do not send anything to Channex yet.
3. **Cross-check** the next 90 days of every calendar against Channex.
4. **Restart outgoing pushes** (the outbox sender).
5. **Full sync last**, and only after steps 2 to 4.

A full sync from out-of-date data would reopen dates that Channex has already closed for new
bookings. Draining first turns an outage into an inconvenience instead of a double booking.

## Pausing the worker safely

The worker stops cleanly on SIGTERM: loops finish their current batch, pg-boss stops, connections close.
Queued changes stay in `app.ari_outbox` and are sent when it starts again.
