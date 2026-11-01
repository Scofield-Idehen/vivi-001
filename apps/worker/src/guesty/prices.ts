import { guestyReservations, reservations } from '@v01/db';
import type { GuestyReservation } from '@v01/integrations';
import { eq, sql } from 'drizzle-orm';
import type { WorkerDeps } from '../deps.ts';
import { minorOf, totalOf } from './mapping.ts';
import type { GuestyReader } from './snapshot.ts';

/**
 * Prices only (1 Nov 2026): reads every booking's money from Guesty again and puts the price and
 * payout on the bookings already imported. Made because the first import read `totalPrice`, which
 * most of Guesty's bookings don't have, and left them without a price.
 */

export interface PriceSummary {
  read: number;
  matched: number;
  updated: number;
  stillWithoutPrice: number;
}

class RolledBack extends Error {}

export async function refreshGuestyPrices(
  deps: Pick<WorkerDeps, 'db' | 'log'>,
  options: {
    orgId: string;
    guesty: Pick<GuestyReader, 'reservations'>;
    checkOutFrom: string;
    defaultCurrency: string;
    dryRun?: boolean;
  },
): Promise<PriceSummary> {
  const read: GuestyReservation[] = [];
  for await (const r of options.guesty.reservations(options.checkOutFrom)) read.push(r);
  const summary: PriceSummary = { read: read.length, matched: 0, updated: 0, stillWithoutPrice: 0 };
  try {
    await deps.db.withOrg({ orgId: options.orgId }, async (tx) => {
      const [lock] = (
        await tx.execute<{ ok: boolean }>(
          sql`select pg_try_advisory_xact_lock(hashtext(${`guesty-import:${options.orgId}`})) as ok`,
        )
      ).rows;
      if (!lock?.ok)
        throw new Error('A Guesty import for this workspace is running. Let it finish, then try again.');
      const map = new Map(
        (
          await tx
            .select({
              guestyId: guestyReservations.guestyReservationId,
              id: guestyReservations.reservationId,
            })
            .from(guestyReservations)
        ).map((r) => [r.guestyId, r.id]),
      );
      for (const r of read) {
        const id = map.get(r._id);
        if (!id) continue;
        summary.matched += 1;
        const currency = r.money?.currency?.toUpperCase() || options.defaultCurrency;
        const total = minorOf(totalOf(r.money), currency);
        const payout = minorOf(r.money?.hostPayout ?? r.money?.netIncome, currency);
        const cleaning = minorOf(r.money?.fareCleaning, currency);
        if (total === null) {
          summary.stillWithoutPrice += 1;
          continue;
        }
        const done = await tx
          .update(reservations)
          .set({ totalMinor: total, payoutMinor: payout, cleaningMinor: cleaning, currency })
          .where(
            sql`${eq(reservations.id, id)} and (${reservations.totalMinor} is distinct from ${total}
                or ${reservations.payoutMinor} is distinct from ${payout}
                or ${reservations.cleaningMinor} is distinct from ${cleaning})`,
          )
          .returning({ id: reservations.id });
        summary.updated += done.length;
      }
      if (options.dryRun) throw new RolledBack();
    });
  } catch (error) {
    if (!(error instanceof RolledBack)) throw error;
  }
  deps.log.info({ orgId: options.orgId, ...summary }, 'Guesty prices refreshed');
  return summary;
}
