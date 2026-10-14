import { type BookingRevision, CHANNEX_BOOKING_EVENTS } from '@v01/channels';
import { reservationRevisions } from '@v01/db';
import type { WorkerDeps } from './deps.ts';

const SYNC_PROBLEM_EVENTS = new Set(['sync_error', 'sync_warning', 'rate_error']);

/**
 * Stores booking revisions exactly as received, before anything else happens, so any
 * booking can be replayed. Idempotent: a revision already stored is skipped.
 *
 * NEXT (integration step 5, Phase 1): turn each stored revision into a reservation inside
 * the same operator scope, park overlaps as status 'conflict' with an urgent alert, and only
 * then acknowledge the revision to Channex. Until that importer exists nothing is
 * acknowledged, so Channex keeps every booking in its feed: nothing can be lost.
 */
export async function storeRevisions(
  deps: Pick<WorkerDeps, 'db'>,
  orgId: string,
  revisions: BookingRevision[],
): Promise<number> {
  if (revisions.length === 0) return 0;
  return deps.db.withOrg({ orgId }, async (tx) => {
    const inserted = await tx
      .insert(reservationRevisions)
      .values(
        revisions.map((r) => ({
          organisationId: orgId,
          provider: 'channex',
          externalRevisionId: r.id,
          revisionStatus: r.status,
          payload: r.raw,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: reservationRevisions.id });
    return inserted.length;
  });
}

/**
 * Handles stored webhooks. Booking webhooks are treated as a signal: the worker pulls
 * the latest revisions from the feed rather than trusting the webhook's own payload,
 * because webhooks can arrive late or out of order.
 */
export async function processWebhooks(deps: WorkerDeps, batchSize = 25): Promise<number> {
  const events = await deps.db.claimWebhookEvents(batchSize);
  for (const event of events) {
    try {
      const target = event.externalPropertyId
        ? await deps.db.resolveChannexProperty(event.externalPropertyId)
        : null;

      if (event.provider === 'channex' && CHANNEX_BOOKING_EVENTS.has(event.event)) {
        if (!target || !event.externalPropertyId) {
          await deps.db.finishWebhookEvent(event.id, {
            organisationId: null,
            error: 'This Channex property is not mapped to any property yet.',
          });
          // Retried every five minutes; alert once, not on every retry.
          if (event.attempts === 1) {
            await deps.alerts.send({
              severity: 'urgent',
              title: 'Booking received for an unmapped property',
              detail: `Channex property ${event.externalPropertyId ?? 'unknown'} (${event.event}). Map it in Channels & Sync.`,
            });
          }
          continue;
        }
        const revisions = await deps.provider.fetchBookingRevisionFeed({
          externalPropertyId: event.externalPropertyId,
        });
        const stored = await storeRevisions(deps, target.organisationId, revisions);
        deps.log.info(
          { orgId: target.organisationId, event: event.event, stored },
          'Booking revisions stored',
        );
      } else if (SYNC_PROBLEM_EVENTS.has(event.event)) {
        await deps.alerts.send({
          severity: event.event === 'sync_warning' ? 'warning' : 'urgent',
          title: `Channel manager reported ${event.event.replace('_', ' ')}`,
          detail: `Channex property ${event.externalPropertyId ?? 'unknown'}`,
        });
      }
      await deps.db.finishWebhookEvent(event.id, { organisationId: target?.organisationId ?? null });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      deps.log.error({ webhookId: event.id, error: message }, 'Webhook processing failed; will retry');
      await deps.db.finishWebhookEvent(event.id, { organisationId: null, error: message });
    }
  }
  return events.length;
}

/**
 * The safety net behind webhooks (every 5 minutes): read the whole unacknowledged feed
 * and store anything not seen yet, grouped by operator.
 */
export async function sweepBookingFeed(deps: WorkerDeps, maxPages = 20): Promise<number> {
  let stored = 0;
  for (let page = 1; page <= maxPages; page++) {
    const revisions = await deps.provider.fetchBookingRevisionFeed({ page });
    if (revisions.length === 0) break;
    const byProperty = new Map<string, BookingRevision[]>();
    for (const r of revisions)
      byProperty.set(r.externalPropertyId, [...(byProperty.get(r.externalPropertyId) ?? []), r]);
    for (const [externalPropertyId, group] of byProperty) {
      const target = await deps.db.resolveChannexProperty(externalPropertyId);
      if (!target) {
        await deps.alerts.send({
          severity: 'urgent',
          title: 'Unacknowledged bookings for an unmapped property',
          detail: `Channex property ${externalPropertyId}: ${group.length} revision(s) waiting.`,
        });
        continue;
      }
      stored += await storeRevisions(deps, target.organisationId, group);
    }
    if (revisions.length < 100) break;
  }
  return stored;
}
