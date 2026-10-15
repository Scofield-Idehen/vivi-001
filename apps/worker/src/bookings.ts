import { type BookingRevision, CHANNEX_BOOKING_EVENTS } from '@v01/channels';
import {
  channexBookings,
  channexMappings,
  guests,
  properties,
  reservationRevisions,
  reservations,
  type Tx,
} from '@v01/db';
import { CHANNEL_LABELS, isIsoDate, parseMajorToMinor } from '@v01/shared';
import { and, asc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import type { WorkerDeps } from './deps.ts';

const SYNC_PROBLEM_EVENTS = new Set(['sync_error', 'sync_warning', 'rate_error']);
/** Revisions saved per run, per operator. The rest wait for the next run, five minutes at most. */
const IMPORT_BATCH = 200;

/**
 * Stores booking revisions exactly as received, before anything else happens, so any
 * booking can be replayed. Idempotent: a revision already stored is skipped.
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

/** The Postgres error code, whether or not Drizzle wrapped the driver's error. */
function pgCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let i = 0; i < 5 && current; i++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

const EXCLUSION_VIOLATION = '23P01';

export interface Saved {
  reservationId: string;
  status: 'confirmed' | 'conflict' | 'cancelled';
  propertyName: string;
}

/** The booking's total in minor units, or nothing when Channex sent none or one that doesn't parse. */
function totalOf(revision: BookingRevision): number | null {
  if (!revision.amount || !revision.currency) return null;
  try {
    return parseMajorToMinor(revision.amount, revision.currency);
  } catch {
    return null;
  }
}

/**
 * Saves one revision as a reservation, in one transaction with marking it saved. A new or changed
 * stay is confirmed if its nights are free; if the double-booking guard refuses it, it is still
 * saved, as a conflict that holds no nights, so the guest is never lost. A cancellation releases
 * the nights.
 */
export async function saveRevision(
  tx: Tx,
  orgId: string,
  stored: { id: string },
  revision: BookingRevision,
): Promise<Saved> {
  const { arrivalDate: checkIn, departureDate: checkOut } = revision;
  if (!isIsoDate(checkIn) || !isIsoDate(checkOut) || checkOut <= checkIn) {
    throw new Error(`The stay's dates don't make sense: ${checkIn || 'none'} to ${checkOut || 'none'}.`);
  }
  if (!revision.bookingId) throw new Error('The revision names no booking.');

  const [mapping] = await tx
    .select({ propertyId: channexMappings.propertyId, name: properties.name })
    .from(channexMappings)
    .innerJoin(properties, eq(properties.id, channexMappings.propertyId))
    .where(eq(channexMappings.channexPropertyId, revision.externalPropertyId));
  if (!mapping) {
    throw new Error(`Channex property ${revision.externalPropertyId} isn't mapped to a property.`);
  }

  const [link] = await tx
    .select()
    .from(channexBookings)
    .where(eq(channexBookings.channexBookingId, revision.bookingId));
  let [existing] = link
    ? await tx.select().from(reservations).where(eq(reservations.id, link.reservationId))
    : [];
  // A booking V-01 already has under the channel's own code (brought across from Guesty, say) is the
  // same booking: link it rather than save it twice.
  if (!existing && revision.otaReservationCode) {
    [existing] = await tx
      .select()
      .from(reservations)
      .where(
        and(
          eq(reservations.channel, revision.channel),
          eq(reservations.channelReference, revision.otaReservationCode),
        ),
      );
    if (existing) {
      const [other] = await tx
        .select({ channexBookingId: channexBookings.channexBookingId })
        .from(channexBookings)
        .where(eq(channexBookings.reservationId, existing.id));
      if (other) {
        throw new Error(
          `Booking ${revision.otaReservationCode} is already linked to Channex booking ${other.channexBookingId}, not ${revision.bookingId}.`,
        );
      }
    }
  }

  // The guest, as the channel last described them.
  let guestId = existing?.guestId ?? null;
  const guest = { fullName: revision.guestName, email: revision.guestEmail, phone: revision.guestPhone };
  if (guest.fullName || guest.email || guest.phone) {
    if (guestId) {
      await tx.update(guests).set(guest).where(eq(guests.id, guestId));
    } else {
      const [row] = await tx
        .insert(guests)
        .values({ organisationId: orgId, ...guest })
        .returning({ id: guests.id });
      guestId = row?.id ?? null;
    }
  }

  const stay = {
    propertyId: mapping.propertyId,
    channel: revision.channel,
    channelReference: revision.otaReservationCode,
    checkIn,
    checkOut,
    adults: revision.adults,
    children: revision.children,
    infants: revision.infants,
    currency: revision.currency,
    totalMinor: totalOf(revision),
    guestId,
  };
  const save = async (t: Tx, status: Saved['status']): Promise<string> => {
    const cancelledAt = status === 'cancelled' ? (existing?.cancelledAt ?? sql`now()`) : null;
    if (existing) {
      await t
        .update(reservations)
        .set({ ...stay, status, cancelledAt })
        .where(eq(reservations.id, existing.id));
      return existing.id;
    }
    const [row] = await t
      .insert(reservations)
      .values({ organisationId: orgId, ...stay, status, cancelledAt })
      .returning({ id: reservations.id });
    if (!row) throw new Error('Saving the reservation returned nothing.');
    return row.id;
  };

  let status: Saved['status'];
  let reservationId: string;
  if (revision.status === 'cancelled') {
    status = 'cancelled';
    reservationId = await save(tx, status);
  } else {
    try {
      // A savepoint, so a refused overlap leaves the rest of the transaction intact.
      reservationId = await tx.transaction((sp) => save(sp, 'confirmed'));
      status = 'confirmed';
    } catch (error) {
      if (pgCode(error) !== EXCLUSION_VIOLATION) throw error;
      reservationId = await save(tx, 'conflict');
      status = 'conflict';
    }
  }

  if (link) {
    await tx
      .update(channexBookings)
      .set({ lastRevisionId: revision.id })
      .where(eq(channexBookings.id, link.id));
  } else {
    await tx.insert(channexBookings).values({
      organisationId: orgId,
      reservationId,
      channexBookingId: revision.bookingId,
      lastRevisionId: revision.id,
    });
  }
  await tx
    .update(reservationRevisions)
    .set({ processedAt: sql`now()`, reservationId, importError: null })
    .where(eq(reservationRevisions.id, stored.id));
  return { reservationId, status, propertyName: mapping.name };
}

export interface ImportStats {
  saved: number;
  conflicts: number;
  failed: number;
  acknowledged: number;
}

/**
 * Turns an operator's stored revisions into reservations, oldest first, then acknowledges to the
 * channel manager each one that is saved, and only those (playbook rule 3). A revision that can't be
 * saved stays unacknowledged, so the channel manager keeps it in its feed and it is tried again on the
 * next run; its first failure raises an urgent alert.
 */
export async function importBookings(deps: WorkerDeps, orgId: string): Promise<ImportStats> {
  const stats: ImportStats = { saved: 0, conflicts: 0, failed: 0, acknowledged: 0 };
  const waiting = await deps.db.withOrg({ orgId }, (tx) =>
    tx
      .select({
        id: reservationRevisions.id,
        externalRevisionId: reservationRevisions.externalRevisionId,
        payload: reservationRevisions.payload,
        receivedAt: reservationRevisions.receivedAt,
        importAttempts: reservationRevisions.importAttempts,
      })
      .from(reservationRevisions)
      .where(isNull(reservationRevisions.processedAt))
      .orderBy(asc(reservationRevisions.receivedAt))
      .limit(IMPORT_BATCH),
  );

  // Revisions stored together keep the order the channel manager made them in.
  const parsed = waiting.map((row) => {
    try {
      return { row, revision: deps.provider.parseRevision(row.payload), error: null };
    } catch (error) {
      return { row, revision: null, error: error instanceof Error ? error.message : String(error) };
    }
  });
  parsed.sort(
    (a, b) =>
      a.row.receivedAt.localeCompare(b.row.receivedAt) ||
      (a.revision?.insertedAt ?? '').localeCompare(b.revision?.insertedAt ?? ''),
  );

  for (const { row, revision, error: unreadable } of parsed) {
    try {
      if (!revision) throw new Error(unreadable ?? 'The revision could not be read.');
      const saved = await deps.db.withOrg({ orgId }, (tx) => saveRevision(tx, orgId, row, revision));
      stats.saved += 1;
      deps.log.info(
        { orgId, revision: row.externalRevisionId, reservationId: saved.reservationId, status: saved.status },
        'Booking saved',
      );
      if (saved.status === 'conflict') {
        stats.conflicts += 1;
        const who = revision.guestName ?? 'A guest';
        const where = [CHANNEL_LABELS[revision.channel], revision.otaReservationCode]
          .filter(Boolean)
          .join(' ');
        await deps.alerts.send({
          severity: 'urgent',
          title: `Double booking: ${saved.propertyName}`,
          detail: `${who} (${where}), ${revision.arrivalDate} to ${revision.departureDate}, overlaps a booking or block already on the calendar. It is saved as a conflict and holds no nights until someone sorts it out.`,
        });
      }
    } catch (error) {
      stats.failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      await deps.db.withOrg({ orgId }, (tx) =>
        tx
          .update(reservationRevisions)
          .set({ importAttempts: sql`${reservationRevisions.importAttempts} + 1`, importError: message })
          .where(eq(reservationRevisions.id, row.id)),
      );
      deps.log.error({ orgId, revision: row.externalRevisionId, error: message }, 'Booking not saved');
      // Tried again every run; alert on the first failure, not on every retry.
      if (row.importAttempts === 0) {
        await deps.alerts.send({
          severity: 'urgent',
          title: "A booking from the channel manager couldn't be saved",
          detail: `Revision ${row.externalRevisionId}: ${message} It stays in the channel manager's feed and is tried again every five minutes.`,
        });
      }
    }
  }

  // Acknowledge only what is saved, after the transaction that saved it has committed.
  const toAcknowledge = await deps.db.withOrg({ orgId }, (tx) =>
    tx
      .select({ id: reservationRevisions.id, externalRevisionId: reservationRevisions.externalRevisionId })
      .from(reservationRevisions)
      .where(and(isNotNull(reservationRevisions.processedAt), isNull(reservationRevisions.ackedAt)))
      .orderBy(asc(reservationRevisions.processedAt))
      .limit(IMPORT_BATCH),
  );
  for (const row of toAcknowledge) {
    try {
      await deps.provider.acknowledgeBookingRevision(row.externalRevisionId);
    } catch (error) {
      // Saved but not acknowledged: the feed sends it again, and saving it again changes nothing.
      deps.log.warn(
        {
          orgId,
          revision: row.externalRevisionId,
          error: error instanceof Error ? error.message : String(error),
        },
        'Acknowledgement will be retried',
      );
      continue;
    }
    await deps.db.withOrg({ orgId }, (tx) =>
      tx.update(reservationRevisions).set({ ackedAt: sql`now()` }).where(eq(reservationRevisions.id, row.id)),
    );
    stats.acknowledged += 1;
  }
  return stats;
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
        const imported = await importBookings(deps, target.organisationId);
        deps.log.info(
          { orgId: target.organisationId, event: event.event, stored, ...imported },
          'Booking revisions stored and saved',
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
 * The safety net behind webhooks (every 5 minutes): read the whole unacknowledged feed,
 * store anything not seen yet, grouped by operator, and save it as bookings. Revisions that
 * failed to save before are tried again here.
 */
export async function sweepBookingFeed(deps: WorkerDeps, maxPages = 20): Promise<number> {
  let stored = 0;
  const operators = new Set<string>();
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
      operators.add(target.organisationId);
    }
    if (revisions.length < 100) break;
  }
  for (const orgId of operators) await importBookings(deps, orgId);
  return stored;
}
