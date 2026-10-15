import { ariOutbox, channexMappings, organisationSettings, properties } from '@v01/db';
import { addDays, todayIn } from '@v01/shared';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import type { WorkerDeps } from './deps.ts';

/** Channex accepts a full sync of 500 days, at most once every 24 hours, off-peak. */
export const FULL_SYNC_DAYS = 500;

/**
 * Queues a full sync for every property that V-01 manages and has mapped: availability, and prices
 * and stay rules. The outbox sender then sends each as one batched call per property.
 *
 * Never run this straight after an outage: drain the booking feed first (playbook,
 * Section 8, "drain before push"), or it could reopen dates Channex has already closed.
 */
export async function enqueueFullSync(
  deps: Pick<WorkerDeps, 'db' | 'log'>,
  now: Date = new Date(),
): Promise<number> {
  let queued = 0;
  for (const org of await deps.db.listOrganisations()) {
    queued += await deps.db.withOrg({ orgId: org.id }, async (tx) => {
      const [settings] = await tx
        .select({ timeZone: organisationSettings.timeZone })
        .from(organisationSettings);
      const today = todayIn(settings?.timeZone ?? 'Europe/London', now);
      const ready = await tx
        .select({ id: properties.id })
        .from(properties)
        .innerJoin(channexMappings, eq(channexMappings.propertyId, properties.id))
        .where(
          and(
            eq(properties.managedBy, 'v01'),
            isNull(properties.archivedAt),
            isNotNull(channexMappings.channexRoomTypeId),
          ),
        );
      if (ready.length === 0) return 0;
      await tx.insert(ariOutbox).values(
        ready.flatMap((p) =>
          (['availability', 'restrictions'] as const).map((kind) => ({
            organisationId: org.id,
            propertyId: p.id,
            kind,
            dateFrom: today,
            dateTo: addDays(today, FULL_SYNC_DAYS - 1),
          })),
        ),
      );
      return ready.length;
    });
  }
  deps.log.info({ queued }, 'Full sync queued');
  return queued;
}
