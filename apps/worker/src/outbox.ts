import { ChannelError } from '@v01/channels';
import { ariOutbox, type ClaimedOutboxRow, channexMappings, properties, syncLog } from '@v01/db';
import { eq, inArray, sql } from 'drizzle-orm';
import { availabilityRanges, type Hold } from './availability.ts';
import type { WorkerDeps } from './deps.ts';

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
 * Sends queued availability changes, batched per property: everything waiting for one
 * property goes out as a single call. Only the worker sends to the channel manager.
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

async function processGroup(
  deps: WorkerDeps,
  rows: ClaimedOutboxRow[],
): Promise<'sent' | 'deferred' | 'failed'> {
  const first = rows[0];
  if (!first) return 'sent';
  const { organisationId: orgId, propertyId, kind } = first;
  const ids = rows.map((r) => r.id);
  const attempts = Math.max(...rows.map((r) => r.attempts));
  const dateFrom = rows.map((r) => r.dateFrom).sort()[0] ?? first.dateFrom;
  const dateTo =
    rows
      .map((r) => r.dateTo)
      .sort()
      .at(-1) ?? first.dateTo;
  const limiterKey = `${kind}:${propertyId}`;

  const context = await deps.db.withOrg({ orgId }, async (tx) => {
    const [property] = await tx
      .select({ name: properties.name, managedBy: properties.managedBy })
      .from(properties)
      .where(eq(properties.id, propertyId));
    const [mapping] = await tx
      .select()
      .from(channexMappings)
      .where(eq(channexMappings.propertyId, propertyId));
    const held = await tx.execute(
      sql`select lower(nights)::text as start, upper(nights)::text as "end"
            from app.occupancies
           where property_id = ${propertyId}
             and nights && daterange(${dateFrom}::date, ${dateTo}::date, '[]')`,
    );
    return { property, mapping, holds: held.rows as unknown as Hold[] };
  });

  const fail = async (message: string, alert: boolean) => {
    await finish(deps, orgId, ids, { status: 'failed', error: message });
    if (alert) {
      await deps.alerts.send({
        severity: 'urgent',
        title: `Not sent to channels: ${context.property?.name ?? propertyId}`,
        detail: message,
      });
    }
    return 'failed' as const;
  };

  if (!context.property) return fail('Property not found.', true);
  // During migration only properties switched to V-01 send anything (playbook, Section 13).
  if (context.property.managedBy !== 'v01') {
    return fail(
      context.property.managedBy === 'guesty'
        ? 'Skipped: this property is still managed by Guesty.'
        : "Skipped: this property's listings are not connected to V-01 yet.",
      false,
    );
  }
  if (!context.mapping?.channexRoomTypeId || !context.mapping.channexRatePlanId) {
    return fail('This property is not mapped to the channel manager yet.', true);
  }
  if (kind !== 'availability') {
    // Prices and restrictions follow in Phase 1, once nightly prices are stored (calendar_days).
    return fail('Price and restriction updates are not built yet (Phase 1).', false);
  }

  const slot = deps.limiter.tryTake(limiterKey);
  if (!slot.ok) {
    await finish(deps, orgId, ids, { status: 'pending', delayMs: slot.retryInMs, refundAttempt: true });
    return 'deferred';
  }

  const ref = {
    externalPropertyId: context.mapping.channexPropertyId,
    externalRoomTypeId: context.mapping.channexRoomTypeId,
    externalRatePlanId: context.mapping.channexRatePlanId,
  };
  const updates = availabilityRanges(dateFrom, dateTo, context.holds).map((r) => ({ ref, ...r }));

  try {
    const result = await deps.provider.pushAvailability(updates);
    await deps.db.withOrg({ orgId }, async (tx) => {
      await tx
        .update(ariOutbox)
        .set({
          status: 'sent',
          sentAt: sql`now()`,
          providerTaskId: result.taskId,
          lastError: null,
          lockedAt: null,
        })
        .where(inArray(ariOutbox.id, ids));
      await tx.insert(syncLog).values({
        organisationId: orgId,
        propertyId,
        direction: 'out',
        kind,
        providerTaskId: result.taskId,
        status: result.warnings.length ? 'warning' : 'ok',
        detail: { dateFrom, dateTo, ranges: updates.length, warnings: result.warnings },
      });
    });
    if (result.warnings.length) {
      await deps.alerts.send({
        severity: 'warning',
        title: `Channel manager accepted availability with warnings: ${context.property.name}`,
        detail: result.warnings.join('; '),
      });
    }
    deps.log.info({ orgId, propertyId, taskId: result.taskId, ranges: updates.length }, 'Availability sent');
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
      deps.log.warn({ orgId, propertyId, attempts, error: message }, 'Availability send will be retried');
      return 'deferred';
    }
    return fail(message, true);
  }
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
