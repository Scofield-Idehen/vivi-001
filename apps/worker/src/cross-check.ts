import { ChannelError, type ChannelNight, type ExternalPropertyRef } from '@v01/channels';
import { ariOutbox, calendarDays, channexMappings, organisationSettings, properties, syncLog } from '@v01/db';
import { addDays, parseMajorToMinor, todayIn } from '@v01/shared';
import { and, asc, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import { availabilityRanges, type Hold } from './availability.ts';
import type { WorkerDeps } from './deps.ts';
import { restrictionRanges } from './restrictions.ts';

/**
 * The nightly cross-check (playbook, Section 8; integration step 6). Every night, for every property
 * V-01 runs, the worker reads back what Channex holds for the nights ahead and compares it with
 * V-01's own calendar: availability, prices (when V-01 sets them) and stay rules. A night that
 * differs is queued to be sent again, the difference is logged, and the team hears about it. Channex
 * is the measure of what the channels see; V-01's calendar is the truth it must match.
 */

/** How far ahead the check looks. Most bookings fall inside it, and Channex answers it in one call. */
export const CROSS_CHECK_DAYS = 90;

/** The nights kept in the log for one check, so a difference can be looked at without a query. */
const LOGGED_DIFFERENCES = 60;

export type DifferenceField =
  | 'available'
  | 'rate'
  | 'minStayArrival'
  | 'maxStay'
  | 'closedToArrival'
  | 'closedToDeparture';

export interface Difference {
  date: string;
  field: DifferenceField;
  /** What V-01 has, and what Channex read back. */
  ours: number | boolean | null;
  theirs: number | boolean | null;
}

export interface CrossCheckStats {
  checked: number;
  matching: number;
  differing: number;
  /** Skipped because changes were still on their way to Channex. */
  waiting: number;
  failed: number;
  nightsResent: number;
}

/** One night as V-01 holds it, for comparing: the same fields the outbox sends. */
export interface OurNight {
  date: string;
  available: number;
  rateMinor: number | null;
  minStayArrival: number;
  maxStay: number | null;
  closedToArrival: boolean;
  closedToDeparture: boolean;
}

/**
 * Compares V-01's nights with the channel manager's. A part the channel manager has never been
 * given (null) is a difference too, since the channels have nothing to go on; a price V-01 doesn't
 * set (PriceLabs does) is not compared.
 */
export function compareNights(ours: OurNight[], theirs: ChannelNight[], currency: string): Difference[] {
  const held = new Map(theirs.map((n) => [n.date, n]));
  const differences: Difference[] = [];
  for (const night of ours) {
    const other = held.get(night.date);
    const check = (field: DifferenceField, mine: number | boolean | null, read: number | boolean | null) => {
      if (mine !== read) differences.push({ date: night.date, field, ours: mine, theirs: read });
    };
    check('available', night.available, other?.available ?? null);
    if (night.rateMinor !== null) check('rate', night.rateMinor, rateMinorOf(other?.rate ?? null, currency));
    check('minStayArrival', night.minStayArrival, other?.minStayArrival ?? null);
    check('maxStay', night.maxStay, other?.maxStay ?? null);
    check('closedToArrival', night.closedToArrival, other?.closedToArrival ?? null);
    check('closedToDeparture', night.closedToDeparture, other?.closedToDeparture ?? null);
  }
  return differences;
}

function rateMinorOf(rate: string | null, currency: string): number | null {
  if (rate === null) return null;
  try {
    return parseMajorToMinor(rate, currency);
  } catch {
    // Channex sometimes reads back more decimals than the currency has ("150.0000"): round them.
    const amount = Number(rate);
    return Number.isFinite(amount) ? Math.round(amount * 100) : null;
  }
}

/** Dates merged into inclusive ranges, so a week of differences is one outbox row. */
export function datesToRanges(dates: string[]): { dateFrom: string; dateTo: string }[] {
  const ranges: { dateFrom: string; dateTo: string }[] = [];
  for (const date of [...new Set(dates)].sort()) {
    const current = ranges.at(-1);
    if (current && addDays(current.dateTo, 1) === date) current.dateTo = date;
    else ranges.push({ dateFrom: date, dateTo: date });
  }
  return ranges;
}

const FIELD_WORDS: Record<DifferenceField, string> = {
  available: 'availability',
  rate: 'price',
  minStayArrival: 'shortest stay',
  maxStay: 'longest stay',
  closedToArrival: 'closed to arrival',
  closedToDeparture: 'closed to departure',
};

/** "3 nights differed (availability on 2, price on 1)". */
export function describeDifferences(differences: Difference[]): string {
  const nights = new Set(differences.map((d) => d.date)).size;
  const byField = new Map<DifferenceField, number>();
  for (const d of differences) byField.set(d.field, (byField.get(d.field) ?? 0) + 1);
  const parts = [...byField.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([field, n]) => `${FIELD_WORDS[field]} on ${n}`);
  return `${nights} ${nights === 1 ? 'night' : 'nights'} differed (${parts.join(', ')})`;
}

interface CheckedMapping {
  id: string;
  propertyId: string;
  channexPropertyId: string;
  channexRoomTypeId: string | null;
  channexRatePlanId: string | null;
}

/** V-01's own nights for one property across [dateFrom, dateTo], as the outbox would send them. */
async function ourNights(
  deps: WorkerDeps,
  orgId: string,
  property: typeof properties.$inferSelect,
  dateFrom: string,
  dateTo: string,
): Promise<OurNight[]> {
  return deps.db.withOrg({ orgId }, async (tx) => {
    const held = await tx.execute(
      sql`select lower(nights)::text as start, upper(nights)::text as "end"
            from app.occupancies
           where property_id = ${property.id}
             and nights && daterange(${dateFrom}::date, ${dateTo}::date, '[]')`,
    );
    const own = await tx
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
          eq(calendarDays.propertyId, property.id),
          gte(calendarDays.night, dateFrom),
          lte(calendarDays.night, dateTo),
        ),
      )
      .orderBy(asc(calendarDays.night));
    const open = availabilityRanges(dateFrom, dateTo, held.rows as unknown as Hold[]);
    const rules = restrictionRanges(dateFrom, dateTo, property, own, {
      sendRates: property.priceOwner === 'v01',
    });
    const nights: OurNight[] = [];
    for (let date = dateFrom; date <= dateTo; date = addDays(date, 1)) {
      const availability = open.find((r) => r.dateFrom <= date && date <= r.dateTo);
      const rule = rules.ranges.find((r) => r.dateFrom <= date && date <= r.dateTo);
      if (!availability || !rule) continue;
      nights.push({
        date,
        available: availability.available,
        rateMinor: rule.rateMinor ?? null,
        minStayArrival: rule.minStayArrival,
        maxStay: rule.maxStay,
        closedToArrival: rule.closedToArrival,
        closedToDeparture: rule.closedToDeparture,
      });
    }
    return nights;
  });
}

/** Checks one property and records the outcome. */
export type CrossCheckOutcome =
  | { outcome: 'matching' | 'waiting' | 'failed' | 'skipped' }
  | { outcome: 'differing'; nights: number };

export async function crossCheckProperty(
  deps: WorkerDeps,
  orgId: string,
  mapping: CheckedMapping,
  options: { days?: number } = {},
): Promise<CrossCheckOutcome> {
  const now = deps.now?.() ?? new Date();
  const context = await deps.db.withOrg({ orgId }, async (tx) => {
    const [property] = await tx.select().from(properties).where(eq(properties.id, mapping.propertyId));
    const [settings] = await tx
      .select({ timeZone: organisationSettings.timeZone, currency: organisationSettings.currency })
      .from(organisationSettings);
    const [pending] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(ariOutbox)
      .where(and(eq(ariOutbox.propertyId, mapping.propertyId), eq(ariOutbox.status, 'pending')));
    return {
      property,
      timeZone: settings?.timeZone ?? 'Europe/London',
      currency: settings?.currency ?? 'GBP',
      pending: pending?.n ?? 0,
    };
  });
  const { property } = context;
  if (!property) return { outcome: 'skipped' };
  if (property.managedBy !== 'v01' || property.archivedAt) return { outcome: 'skipped' };
  if (!mapping.channexRoomTypeId || !mapping.channexRatePlanId) return { outcome: 'skipped' };
  if (context.pending > 0) {
    // Changes are still on their way: comparing now would only find them. Tomorrow's check will.
    deps.log.info(
      { orgId, propertyId: property.id, pending: context.pending },
      'Cross-check waits for the outbox',
    );
    return { outcome: 'waiting' };
  }

  const today = todayIn(context.timeZone, now);
  const dateFrom = today;
  const dateTo = addDays(today, (options.days ?? CROSS_CHECK_DAYS) - 1);
  const ref: ExternalPropertyRef = {
    externalPropertyId: mapping.channexPropertyId,
    externalRoomTypeId: mapping.channexRoomTypeId,
    externalRatePlanId: mapping.channexRatePlanId,
  };

  try {
    const [ours, theirs] = await Promise.all([
      ourNights(deps, orgId, property, dateFrom, dateTo),
      deps.provider.fetchInventory(ref, dateFrom, dateTo),
    ]);
    const differences = compareNights(ours, theirs, context.currency);
    const nights = new Set(differences.map((d) => d.date)).size;
    const availabilityDates = differences.filter((d) => d.field === 'available').map((d) => d.date);
    const restrictionDates = differences.filter((d) => d.field !== 'available').map((d) => d.date);

    await deps.db.withOrg({ orgId }, async (tx) => {
      await tx
        .update(channexMappings)
        .set({ crossCheckedAt: now.toISOString(), crossCheckDifferences: nights, crossCheckError: null })
        .where(eq(channexMappings.id, mapping.id));
      // Send the differing nights again, from V-01's calendar, through the usual sender.
      const resend = [
        ...datesToRanges(availabilityDates).map((r) => ({ kind: 'availability' as const, ...r })),
        ...datesToRanges(restrictionDates).map((r) => ({ kind: 'restrictions' as const, ...r })),
      ];
      if (resend.length > 0) {
        await tx
          .insert(ariOutbox)
          .values(resend.map((r) => ({ organisationId: orgId, propertyId: property.id, ...r })));
      }
      await tx.insert(syncLog).values({
        organisationId: orgId,
        propertyId: property.id,
        direction: 'in',
        kind: 'cross_check',
        status: nights === 0 ? 'ok' : 'differences',
        detail: {
          dateFrom,
          dateTo,
          nightsChecked: ours.length,
          nightsDiffering: nights,
          resent: resend,
          differences: differences.slice(0, LOGGED_DIFFERENCES),
        },
      });
    });

    if (nights > 0) {
      await deps.alerts.send({
        severity: 'warning',
        title: `Channex didn't match V-01 for ${property.name}`,
        detail: `${describeDifferences(differences)} between ${dateFrom} and ${dateTo}. The nights have been sent again from V-01's calendar; check Channex and the channel if it happens again tomorrow.`,
        path: `/properties/${property.id}`,
      });
      deps.log.warn(
        { orgId, propertyId: property.id, nights, dateFrom, dateTo },
        'Cross-check found differences',
      );
      return { outcome: 'differing', nights };
    }
    deps.log.info({ orgId, propertyId: property.id, nights: ours.length }, 'Cross-check matched');
    return { outcome: 'matching' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await deps.db.withOrg({ orgId }, async (tx) => {
      await tx
        .update(channexMappings)
        .set({ crossCheckedAt: now.toISOString(), crossCheckDifferences: null, crossCheckError: message })
        .where(eq(channexMappings.id, mapping.id));
      await tx.insert(syncLog).values({
        organisationId: orgId,
        propertyId: property.id,
        direction: 'in',
        kind: 'cross_check',
        status: 'error',
        detail: { dateFrom, dateTo, error: message },
      });
    });
    deps.log.warn({ orgId, propertyId: property.id, error: message }, "Couldn't cross-check with Channex");
    if (!(error instanceof ChannelError)) throw error;
    return { outcome: 'failed' };
  }
}

/** Every property V-01 runs, every operator: the nightly job. */
export async function crossCheckAll(
  deps: WorkerDeps,
  options: { days?: number } = {},
): Promise<CrossCheckStats> {
  const stats: CrossCheckStats = {
    checked: 0,
    matching: 0,
    differing: 0,
    waiting: 0,
    failed: 0,
    nightsResent: 0,
  };
  for (const org of await deps.db.listOrganisations()) {
    const mappings = await deps.db.withOrg({ orgId: org.id }, (tx) =>
      tx
        .select({
          id: channexMappings.id,
          propertyId: channexMappings.propertyId,
          channexPropertyId: channexMappings.channexPropertyId,
          channexRoomTypeId: channexMappings.channexRoomTypeId,
          channexRatePlanId: channexMappings.channexRatePlanId,
        })
        .from(channexMappings)
        .innerJoin(properties, eq(properties.id, channexMappings.propertyId))
        .where(and(eq(properties.managedBy, 'v01'), isNull(properties.archivedAt))),
    );
    for (const mapping of mappings) {
      const result = await crossCheckProperty(deps, org.id, mapping, options);
      if (result.outcome === 'skipped') continue;
      stats.checked += 1;
      stats[result.outcome] += 1;
      if (result.outcome === 'differing') stats.nightsResent += result.nights;
    }
  }
  deps.log.info(stats, 'Cross-check done');
  return stats;
}
