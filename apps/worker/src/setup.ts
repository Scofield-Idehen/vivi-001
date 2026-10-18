import { ChannelError } from '@v01/channels';
import {
  ariOutbox,
  channexGroups,
  channexMappings,
  channexSetups,
  organisationSettings,
  organisations,
  properties,
  syncLog,
  type Tx,
} from '@v01/db';
import { addDays, todayIn } from '@v01/shared';
import { and, asc, eq, lt, or, sql } from 'drizzle-orm';
import type { WorkerDeps } from './deps.ts';
import { FULL_SYNC_DAYS } from './full-sync.ts';
import { backoffMs } from './outbox.ts';

const MAX_ATTEMPTS = 10;
/** A request the worker took but never finished (it crashed) is taken again after this long. */
const LOCK_MINUTES = 10;

export interface SetupStats {
  claimed: number;
  done: number;
  deferred: number;
  failed: number;
}

interface Claimed {
  id: string;
  propertyId: string;
  attempts: number;
}

/**
 * Connects properties to the channel manager (integration step 3). For each request the API
 * queued, this makes the property in Channex (one property, one unit, one rate plan) inside the
 * operator's own group, which it makes first if the operator has none, and stores the Channex ids
 * in the mapping table. Nothing is sent to any channel by this: that needs the property moved over
 * and its listings linked (step 7).
 *
 * A property V-01 already runs gets a full sync queued the moment it is connected, so Channex
 * holds its prices and availability before any listing is linked to it.
 */
export async function connectProperties(deps: WorkerDeps, batchSize = 5): Promise<SetupStats> {
  const stats: SetupStats = { claimed: 0, done: 0, deferred: 0, failed: 0 };
  const now = deps.now?.() ?? new Date();
  for (const org of await deps.db.listOrganisations()) {
    const claimed = await deps.db.withOrg({ orgId: org.id }, (tx) => claim(tx, batchSize));
    stats.claimed += claimed.length;
    for (const request of claimed) {
      stats[await connectOne(deps, org, request, now)] += 1;
    }
  }
  return stats;
}

/**
 * Takes the requests that are due: new ones, retries whose wait is over, and ones a crash left
 * locked. Due is judged by the database's clock, which set the waits.
 */
async function claim(tx: Tx, limit: number): Promise<Claimed[]> {
  const due = await tx
    .select({ id: channexSetups.id, propertyId: channexSetups.propertyId, attempts: channexSetups.attempts })
    .from(channexSetups)
    .where(
      or(
        and(eq(channexSetups.status, 'queued'), sql`${channexSetups.nextAttemptAt} <= now()`),
        and(
          eq(channexSetups.status, 'working'),
          lt(channexSetups.lockedAt, sql`now() - make_interval(mins => ${LOCK_MINUTES})`),
        ),
      ),
    )
    .orderBy(asc(channexSetups.nextAttemptAt), asc(channexSetups.createdAt))
    .limit(limit)
    .for('update', { skipLocked: true });
  if (due.length === 0) return [];
  for (const row of due) {
    await tx
      .update(channexSetups)
      .set({ status: 'working', lockedAt: sql`now()`, attempts: row.attempts + 1 })
      .where(eq(channexSetups.id, row.id));
  }
  return due.map((row) => ({ ...row, attempts: row.attempts + 1 }));
}

async function connectOne(
  deps: WorkerDeps,
  org: { id: string; name: string },
  request: Claimed,
  now: Date,
): Promise<'done' | 'deferred' | 'failed'> {
  const orgId = org.id;
  const { propertyId, attempts } = request;

  // What Channex needs, and the operator's group if it has one already.
  const context = await deps.db.withOrg({ orgId }, async (tx) => {
    const [property] = await tx.select().from(properties).where(eq(properties.id, propertyId));
    const [settings] = await tx
      .select({ currency: organisationSettings.currency, timeZone: organisationSettings.timeZone })
      .from(organisationSettings);
    const [group] = await tx.select().from(channexGroups);
    const [mapping] = await tx
      .select({ id: channexMappings.id })
      .from(channexMappings)
      .where(eq(channexMappings.propertyId, propertyId));
    const [operator] = await tx.select({ name: organisations.name }).from(organisations);
    return { property, settings, group, mapping, operatorName: operator?.name ?? org.name };
  });

  const settle = async (
    outcome:
      | { status: 'done' }
      | { status: 'queued'; delayMs: number; error: string }
      | { status: 'failed'; error: string },
  ) => {
    await deps.db.withOrg({ orgId }, (tx) =>
      tx
        .update(channexSetups)
        .set(
          outcome.status === 'done'
            ? { status: 'done', lockedAt: null, lastError: null, finishedAt: sql`now()` }
            : outcome.status === 'queued'
              ? {
                  status: 'queued',
                  lockedAt: null,
                  lastError: outcome.error,
                  nextAttemptAt: sql`now() + make_interval(secs => ${outcome.delayMs / 1000})`,
                }
              : { status: 'failed', lockedAt: null, lastError: outcome.error, finishedAt: sql`now()` },
        )
        .where(eq(channexSetups.id, request.id)),
    );
  };

  if (!context.property || context.property.archivedAt) {
    await settle({ status: 'failed', error: 'The property no longer exists.' });
    return 'failed';
  }
  if (context.mapping) {
    // Already connected (a request queued twice, or a retry after the mapping was saved).
    await settle({ status: 'done' });
    return 'done';
  }
  const property = context.property;
  const currency = context.settings?.currency ?? 'GBP';
  const timeZone = context.settings?.timeZone ?? 'Europe/London';

  try {
    // The operator's group first, once. Its id is saved before the property is made, so a crash
    // between the two never leaves a second group to be made next time.
    let groupId = context.group?.channexGroupId ?? null;
    if (!groupId) {
      groupId = await deps.provider.createGroup(context.operatorName);
      await deps.db.withOrg({ orgId }, (tx) =>
        tx.insert(channexGroups).values({ organisationId: orgId, channexGroupId: groupId as string }),
      );
    }

    const ref = await deps.provider.createListing({
      title: property.name,
      currency,
      countryCode: property.countryCode,
      timeZone,
      maxGuests: property.maxGuests,
      city: property.city,
      address: [property.addressLine1, property.addressLine2].filter(Boolean).join(', ') || null,
      postcode: property.postcode,
      groupId,
    });

    await deps.db.withOrg({ orgId }, async (tx) => {
      await tx.insert(channexMappings).values({
        organisationId: orgId,
        propertyId,
        channexPropertyId: ref.externalPropertyId,
        channexRoomTypeId: ref.externalRoomTypeId,
        channexRatePlanId: ref.externalRatePlanId,
      });
      await tx.insert(syncLog).values({
        organisationId: orgId,
        propertyId,
        direction: 'out',
        kind: 'setup',
        status: 'ok',
        detail: { ...ref, groupId },
      });
      // A property V-01 runs gets its whole calendar to Channex straight away.
      if (property.managedBy === 'v01') {
        const today = todayIn(timeZone, now);
        await tx.insert(ariOutbox).values(
          (['availability', 'restrictions'] as const).map((kind) => ({
            organisationId: orgId,
            propertyId,
            kind,
            dateFrom: today,
            dateTo: addDays(today, FULL_SYNC_DAYS - 1),
          })),
        );
      }
    });
    await settle({ status: 'done' });
    deps.log.info({ orgId, propertyId, ...ref }, 'Property connected to the channel manager');
    return 'done';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await deps.db.withOrg({ orgId }, (tx) =>
      tx.insert(syncLog).values({
        organisationId: orgId,
        propertyId,
        direction: 'out',
        kind: 'setup',
        status: 'error',
        detail: { attempts, error: message },
      }),
    );
    if (error instanceof ChannelError && error.retryable && attempts < MAX_ATTEMPTS) {
      await settle({ status: 'queued', delayMs: backoffMs(attempts, error.retryAfterMs), error: message });
      deps.log.warn({ orgId, propertyId, attempts, error: message }, 'Connecting will be retried');
      return 'deferred';
    }
    await settle({ status: 'failed', error: message });
    await deps.alerts.send({
      severity: 'urgent',
      title: `Couldn't connect ${property.name} to the channel manager`,
      detail: `${message} Fix the cause, then ask again from the property's page.`,
    });
    return 'failed';
  }
}
