import { ChannelError, type ExternalPropertyRef, type PushResult } from '@v01/channels';
import {
  ariOutbox,
  type ClaimedOutboxRow,
  calendarDays,
  channexMappings,
  organisationSettings,
  properties,
  syncLog,
  type Tx,
} from '@v01/db';
import { addDays, todayIn } from '@v01/shared';
import { and, asc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { availabilityRanges, type Hold } from './availability.ts';
import type { WorkerDeps } from './deps.ts';
import { FULL_SYNC_DAYS } from './full-sync.ts';
import { restrictionRanges } from './restrictions.ts';

const MAX_ATTEMPTS = 10;

export interface OutboxStats {
  claimed: number;
  sent: number;
  deferred: number;
  failed: number;
}

/** Retry delay: 30 s, 1 min, 2 min … capped at 30 minutes, or what the provider asked for. */
export function backoffMs(attempts: number, retryAfterMs?: number): number {
  const exponential = Math.min(30_000 * 2 ** Math.max(0, attempts - 1), 30 * 60_000);
  return Math.max(exponential, retryAfterMs ?? 0);
}

/**
 * Sends queued changes, batched per property and kind: everything waiting for one property's
 * availability goes out as one call, and likewise its prices and stay rules. The database queues
 * them (migration 0012); only the worker sends to the channel manager.
 */
export async function processOutbox(deps: WorkerDeps, batchSize = 200): Promise<OutboxStats> {
  const claimed = await deps.db.claimOutbox(batchSize);
  const stats: OutboxStats = { claimed: claimed.length, sent: 0, deferred: 0, failed: 0 };
  const groups = new Map<string, ClaimedOutboxRow[]>();
  for (const row of claimed) {
    const key = `${row.organisationId}|${row.propertyId}|${row.kind}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  for (const rows of groups.values()) {
    const outcome = await processGroup(deps, rows);
    stats[outcome] += rows.length;
  }
  return stats;
}

const WHAT: Record<ClaimedOutboxRow['kind'], string> = {
  availability: 'availability',
  restrictions: 'prices and stay rules',
};

async function processGroup(
  deps: WorkerDeps,
  rows: ClaimedOutboxRow[],
): Promise<'sent' | 'deferred' | 'failed'> {
  const first = rows[0];
  if (!first) return 'sent';
  const { organisationId: orgId, propertyId, kind } = first;
  const ids = rows.map((r) => r.id);
  const attempts = Math.max(...rows.map((r) => r.attempts));
  const queuedFrom = rows.map((r) => r.dateFrom).sort()[0] ?? first.dateFrom;
  const queuedTo =
    rows
      .map((r) => r.dateTo)
      .sort()
      .at(-1) ?? first.dateTo;
  const limiterKey = `${kind}:${propertyId}`;

  const context = await deps.db.withOrg({ orgId }, async (tx) => {
    const [property] = await tx.select().from(properties).where(eq(properties.id, propertyId));
    const [mapping] = await tx
      .select()
      .from(channexMappings)
      .where(eq(channexMappings.propertyId, propertyId));
    const [settings] = await tx
      .select({ timeZone: organisationSettings.timeZone })
      .from(organisationSettings);
    return { property, mapping, timeZone: settings?.timeZone ?? 'Europe/London' };
  });

  const fail = async (message: string, alert: boolean) => {
    await finish(deps, orgId, ids, { status: 'failed', error: message });
    if (alert) {
      await deps.alerts.send({
        severity: 'urgent',
        title: `Not sent to channels: ${context.property?.name ?? propertyId}`,
        detail: message,
        path: '/channels',
      });
    }
    return 'failed' as const;
  };

  const { property, mapping } = context;
  if (!property) return fail('Property not found.', true);
  // During migration only properties switched to V-01 send anything (playbook, Section 13).
  if (property.managedBy !== 'v01') {
    return fail(
      property.managedBy === 'guesty'
        ? 'Skipped: this property is still managed by Guesty.'
        : "Skipped: this property's listings are not connected to V-01 yet.",
      false,
    );
  }
  if (!mapping?.channexRoomTypeId || !mapping.channexRatePlanId) {
    return fail('This property is not mapped to the channel manager yet.', true);
  }

  // Only nights from today, where the operator is, up to the channels' horizon. Past nights can't
  // be booked, and the channels refuse changes to them.
  const today = todayIn(context.timeZone, deps.now?.() ?? new Date());
  const dateFrom = queuedFrom > today ? queuedFrom : today;
  const horizon = addDays(today, FULL_SYNC_DAYS - 1);
  const dateTo = queuedTo < horizon ? queuedTo : horizon;
  if (dateFrom > dateTo) {
    await markSent(deps, orgId, ids, null);
    return 'sent';
  }

  const slot = deps.limiter.tryTake(limiterKey);
  if (!slot.ok) {
    await finish(deps, orgId, ids, { status: 'pending', delayMs: slot.retryInMs, refundAttempt: true });
    return 'deferred';
  }

  const ref: ExternalPropertyRef = {
    externalPropertyId: mapping.channexPropertyId,
    externalRoomTypeId: mapping.channexRoomTypeId,
    externalRatePlanId: mapping.channexRatePlanId,
  };

  try {
    let result: PushResult;
    let detail: Record<string, unknown>;
    if (kind === 'availability') {
      const held = await deps.db.withOrg({ orgId }, (tx) =>
        tx.execute(
          sql`select lower(nights)::text as start, upper(nights)::text as "end"
                from app.occupancies
               where property_id = ${propertyId}
                 and nights && daterange(${dateFrom}::date, ${dateTo}::date, '[]')`,
        ),
      );
      const updates = availabilityRanges(dateFrom, dateTo, held.rows as unknown as Hold[]).map((r) => ({
        ref,
        ...r,
      }));
      result = await deps.provider.pushAvailability(updates);
      detail = { dateFrom, dateTo, ranges: updates.length };
    } else {
      const nights = await deps.db.withOrg({ orgId }, (tx) =>
        tx
          .select({
            night: calendarDays.night,
            priceMinor: calendarDays.priceMinor,
            minNights: calendarDays.minNights,
            closedToArrival: calendarDays.closedToArrival,
            closedToDeparture: calendarDays.closedToDeparture,
          })
          .from(calendarDays)
          .where(
            and(
              eq(calendarDays.propertyId, propertyId),
              gte(calendarDays.night, dateFrom),
              lte(calendarDays.night, dateTo),
            ),
          )
          .orderBy(asc(calendarDays.night)),
      );
      const plan = restrictionRanges(dateFrom, dateTo, property, nights, {
        sendRates: property.priceOwner === 'v01',
      });
      result = await deps.provider.pushRestrictions(plan.ranges.map((r) => ({ ref, ...r })));
      detail = {
        dateFrom,
        dateTo,
        ranges: plan.ranges.length,
        rates: property.priceOwner === 'v01',
        heldAtLimit: plan.heldAtLimit,
      };
    }

    await deps.db.withOrg({ orgId }, async (tx) => {
      await markSent(deps, orgId, ids, result.taskId, tx);
      await tx.insert(syncLog).values({
        organisationId: orgId,
        propertyId,
        direction: 'out',
        kind,
        providerTaskId: result.taskId,
        status: result.warnings.length ? 'warning' : 'ok',
        detail: { ...detail, warnings: result.warnings },
      });
    });
    if (result.warnings.length) {
      await deps.alerts.send({
        severity: 'warning',
        title: `Channel manager accepted ${WHAT[kind]} with warnings: ${property.name}`,
        detail: result.warnings.join('; '),
        path: '/channels',
      });
    }
    deps.log.info({ orgId, propertyId, kind, taskId: result.taskId, ...detail }, 'Sent to channels');
    return 'sent';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await deps.db.withOrg({ orgId }, (tx) =>
      tx.insert(syncLog).values({
        organisationId: orgId,
        propertyId,
        direction: 'out',
        kind,
        status: 'error',
        detail: { dateFrom, dateTo, error: message },
      }),
    );
    if (error instanceof ChannelError && error.retryable && attempts < MAX_ATTEMPTS) {
      // Pause this property for at least a minute, then retry with backoff.
      deps.limiter.pause(limiterKey, Math.max(60_000, error.retryAfterMs ?? 0));
      await finish(deps, orgId, ids, {
        status: 'pending',
        delayMs: backoffMs(attempts, error.retryAfterMs),
        error: message,
      });
      deps.log.warn(
        { orgId, propertyId, kind, attempts, error: message },
        'Send to channels will be retried',
      );
      return 'deferred';
    }
    return fail(message, true);
  }
}

async function markSent(
  deps: WorkerDeps,
  orgId: string,
  ids: number[],
  taskId: string | null,
  tx?: Tx,
): Promise<void> {
  const update = (t: Tx) =>
    t
      .update(ariOutbox)
      .set({ status: 'sent', sentAt: sql`now()`, providerTaskId: taskId, lastError: null, lockedAt: null })
      .where(inArray(ariOutbox.id, ids));
  if (tx) await update(tx);
  else await deps.db.withOrg({ orgId }, update);
}

async function finish(
  deps: WorkerDeps,
  orgId: string,
  ids: number[],
  outcome: { status: 'pending' | 'failed'; delayMs?: number; error?: string; refundAttempt?: boolean },
): Promise<void> {
  await deps.db.withOrg({ orgId }, (tx) =>
    tx
      .update(ariOutbox)
      .set({
        status: outcome.status,
        lockedAt: null,
        lastError: outcome.error ?? null,
        nextAttemptAt: sql`now() + make_interval(secs => ${(outcome.delayMs ?? 0) / 1000})`,
        ...(outcome.refundAttempt ? { attempts: sql`greatest(${ariOutbox.attempts} - 1, 0)` } : {}),
      })
      .where(inArray(ariOutbox.id, ids)),
  );
}
