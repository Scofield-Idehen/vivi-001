import { ChannelError } from '@v01/channels';
import { channexMappings, properties, syncLog } from '@v01/db';
import { eq, sql } from 'drizzle-orm';
import { processWebhooks, sweepBookingFeed } from './bookings.ts';
import type { WorkerDeps } from './deps.ts';

/**
 * The safety net for V-01's own downtime (playbook, Section 8). Two halves:
 *
 * 1. Channex closes a booked night by itself on every connected property, so a night is never sold
 *    twice while V-01 is unreachable. The setting is sent when a property is created; this checks
 *    it is still on, daily and after every connection, and turns it back on if someone turned it off.
 * 2. When the worker starts after a gap, it saves every booking that arrived meanwhile before a
 *    single price or availability goes out. A stale push would reopen a night booked in the gap.
 */

/** A gap longer than this means at least two 5-minute sweeps were missed: recover before sending. */
export const RECOVERY_GAP_SECONDS = 10 * 60;

export interface AutoCloseStats {
  checked: number;
  fixed: number;
  failed: number;
}

/** Looks at one connected property and records what it found. */
export async function checkAutoClose(
  deps: WorkerDeps,
  orgId: string,
  mapping: { id: string; propertyId: string; channexPropertyId: string; propertyName: string },
): Promise<'on' | 'fixed' | 'failed'> {
  const now = deps.now?.() ?? new Date();
  try {
    const { wasOn } = await deps.provider.ensureAutoClose(mapping.channexPropertyId);
    await deps.db.withOrg({ orgId }, async (tx) => {
      await tx
        .update(channexMappings)
        .set({ autoClose: true, autoCloseCheckedAt: now.toISOString() })
        .where(eq(channexMappings.id, mapping.id));
      if (!wasOn) {
        await tx.insert(syncLog).values({
          organisationId: orgId,
          propertyId: mapping.propertyId,
          direction: 'out',
          kind: 'safety',
          status: 'fixed',
          detail: { channexPropertyId: mapping.channexPropertyId, setting: 'auto_close' },
        });
      }
    });
    if (!wasOn) {
      await deps.alerts.send({
        severity: 'warning',
        title: `Channex had stopped closing booked nights for ${mapping.propertyName}`,
        detail: 'The setting was off in Channex and has been turned back on. Check who changed it.',
      });
      return 'fixed';
    }
    return 'on';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await deps.db.withOrg({ orgId }, async (tx) => {
      await tx
        .update(channexMappings)
        .set({ autoClose: null, autoCloseCheckedAt: now.toISOString() })
        .where(eq(channexMappings.id, mapping.id));
      await tx.insert(syncLog).values({
        organisationId: orgId,
        propertyId: mapping.propertyId,
        direction: 'out',
        kind: 'safety',
        status: 'error',
        detail: { channexPropertyId: mapping.channexPropertyId, error: message },
      });
    });
    deps.log.warn({ orgId, propertyId: mapping.propertyId, error: message }, "Couldn't check auto-close");
    if (!(error instanceof ChannelError)) throw error;
    return 'failed';
  }
}

/** Every connected property, every operator: the daily job. */
export async function checkAllAutoClose(deps: WorkerDeps): Promise<AutoCloseStats> {
  const stats: AutoCloseStats = { checked: 0, fixed: 0, failed: 0 };
  for (const org of await deps.db.listOrganisations()) {
    const mappings = await deps.db.withOrg({ orgId: org.id }, (tx) =>
      tx
        .select({
          id: channexMappings.id,
          propertyId: channexMappings.propertyId,
          channexPropertyId: channexMappings.channexPropertyId,
          propertyName: properties.name,
        })
        .from(channexMappings)
        .innerJoin(properties, eq(properties.id, channexMappings.propertyId))
        .where(sql`${properties.archivedAt} is null`),
    );
    for (const mapping of mappings) {
      const outcome = await checkAutoClose(deps, org.id, mapping);
      stats.checked += 1;
      if (outcome === 'fixed') stats.fixed += 1;
      if (outcome === 'failed') stats.failed += 1;
    }
  }
  return stats;
}

export interface RunStart {
  runId: number;
  gapSeconds: number | null;
  /** True when the gap was long enough that nothing may be sent until the feed is drained. */
  recovering: boolean;
}

/** Records the start and decides whether a recovery is needed first. */
export async function beginRun(
  deps: WorkerDeps,
  gapThresholdSeconds = RECOVERY_GAP_SECONDS,
): Promise<RunStart> {
  const { runId, gapSeconds } = await deps.db.beginRun(deps.now?.() ?? new Date());
  const recovering = gapSeconds !== null && gapSeconds >= gapThresholdSeconds;
  if (recovering) await deps.db.setRecovery(runId, 'draining', 0, deps.now?.() ?? new Date());
  return { runId, gapSeconds, recovering };
}

export interface RecoveryStats {
  gapSeconds: number;
  drained: number;
  passes: number;
}

/**
 * Drain before push: the webhooks that arrived while the worker was away, then the booking feed,
 * again and again until a pass finds nothing new. Only then may the outbox send. The console shows
 * the outcome, and the alert channel hears about it.
 */
export async function recover(deps: WorkerDeps, run: RunStart, maxPasses = 10): Promise<RecoveryStats> {
  const gapSeconds = run.gapSeconds ?? 0;
  let drained = 0;
  let passes = 0;
  await processWebhooks(deps);
  for (; passes < maxPasses; passes++) {
    const stored = await sweepBookingFeed(deps);
    drained += stored;
    if (stored === 0) break;
  }
  await deps.db.setRecovery(run.runId, 'done', drained, deps.now?.() ?? new Date());
  const minutes = Math.round(gapSeconds / 60);
  await deps.alerts.send({
    severity: 'info',
    title: `V-01 is back after ${minutes} minute${minutes === 1 ? '' : 's'} away`,
    detail: `${drained} booking change${drained === 1 ? '' : 's'} saved before anything was sent to the channels.`,
  });
  deps.log.info({ gapSeconds, drained, passes }, 'Recovered: drained before pushing');
  return { gapSeconds, drained, passes };
}
