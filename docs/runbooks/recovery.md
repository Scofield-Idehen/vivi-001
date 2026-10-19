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

## The worker does steps 2 and 4 itself (from 19 October 2026)

Every worker start is recorded in `app.worker_runs`, with a heartbeat every 30 seconds. A start that
finds the previous heartbeat more than 10 minutes old (`RECOVERY_GAP_SECONDS` in
`apps/worker/src/safety.ts`) holds the outbox, the property connections and the nightly full sync,
processes the webhooks that arrived meanwhile, then sweeps the booking feed until a pass finds
nothing new. Only then does it let anything out. The console's Sync health page shows the worker's
last heartbeat, whether it is recovering, and the last recovery (how long the gap was and how many
booking changes were saved first); the alert channel gets one line too.

Step 3, the cross-check, runs every night at 03:30 London (`nightly-cross-check`,
`apps/worker/src/cross-check.ts`): the next 90 nights of every calendar V-01 runs against what
Channex holds. Differing nights are queued again through the outbox, logged (`cross_check` in the
sync log) and raised as a warning alert; the Today page lists them under Needs attention and the
property page says when it was last checked. After a long outage, don't wait for the night: once
the recovery has drained and the outbox is empty, run it by hand from `apps/worker` with
`pnpm cross-check` (add `--days 500` to cover the whole horizon). A property whose outbox still has
changes pending is skipped as "waiting", so run it again once they have gone.

## Channex closes booked nights itself

Every property is created in Channex with its availability auto-update settings on, so a booking
closes its nights in Channex the moment it arrives, before V-01 has heard of it. The worker reads
that back after every connection and every morning at 04:15 (`daily-safety-check`), turns it back on
if someone turned it off in Channex, and raises a warning alert with the property's name. The
property page's Channels section shows when it was last checked.

## Pausing the worker safely

The worker stops cleanly on SIGTERM: loops finish their current batch, pg-boss stops, connections close.
Queued changes stay in `app.ari_outbox` and are sent when it starts again.
