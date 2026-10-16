import {
  appUsers,
  blocks,
  calendarDays,
  guests,
  organisationSettings,
  properties,
  propertyPhotos,
  reservations,
  type Tx,
} from '@v01/db';
import {
  addDays,
  CALENDAR_DAYS_AHEAD,
  type Calendar,
  type CalendarChangeResult,
  CalendarChangeResultSchema,
  CalendarChangeSchema,
  CalendarQuerySchema,
  CalendarSchema,
  eachNight,
  formatMoney,
  nightsBetween,
  selectedNights,
  todayIn,
} from '@v01/shared';
import { and, asc, eq, gt, gte, inArray, isNull, lte, type SQL, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { z } from 'zod';
import { pgErrorCode, type RequestScope, toIso } from '../context.ts';
import { HttpError } from '../errors.ts';

type Change = z.output<typeof CalendarChangeSchema>;

interface OperatorSettings {
  currency: string;
  locale: string;
  /** Today where the operator is. */
  today: string;
}

interface Target {
  id: string;
  organisationId: string;
  name: string;
  priceOwner: 'v01' | 'pricelabs';
  minPriceMinor: number | null;
  maxPriceMinor: number | null;
}

async function operatorSettings(tx: Tx): Promise<OperatorSettings> {
  // Row-level security limits this to the operator in scope, which has exactly one row.
  const [row] = await tx
    .select({
      timeZone: organisationSettings.timeZone,
      currency: organisationSettings.currency,
      locale: organisationSettings.locale,
    })
    .from(organisationSettings);
  return {
    currency: row?.currency ?? 'GBP',
    locale: row?.locale ?? 'en-GB',
    today: todayIn(row?.timeZone ?? 'Europe/London'),
  };
}

/** "Harbour View Lodge", "Harbour View Lodge and Mill Street Flat", or "…, … and 3 more". */
function names(targets: { name: string }[]): string {
  const all = targets.map((t) => t.name);
  if (all.length <= 2) return all.join(' and ');
  return `${all.slice(0, 2).join(', ')} and ${all.length - 2} more`;
}

/** Consecutive nights as blocks: [first night, first free night). Nights must be in order. */
function runs(nights: string[]): [string, string][] {
  const out: [string, string][] = [];
  for (const night of nights) {
    const last = out.at(-1);
    if (last && last[1] === night) last[1] = addDays(night, 1);
    else out.push([night, addDays(night, 1)]);
  }
  return out;
}

/** Prices are set where the property's prices are owned, and only within its limits. */
function checkPrice(priceMinor: number, targets: Target[], settings: OperatorSettings): void {
  const money = (minor: number) =>
    formatMoney({ amountMinor: minor, currency: settings.currency }, settings.locale);
  const elsewhere = targets.filter((t) => t.priceOwner !== 'v01');
  if (elsewhere.length) {
    throw new HttpError(
      409,
      'prices_set_in_pricelabs',
      `PriceLabs sets the prices for ${names(elsewhere)}, so they can't be changed here.`,
    );
  }
  for (const t of targets) {
    if (t.minPriceMinor && priceMinor < t.minPriceMinor) {
      throw new HttpError(
        400,
        'below_lowest_price',
        `${money(priceMinor)} is below the lowest price for ${t.name}, ${money(t.minPriceMinor)}.`,
      );
    }
    if (t.maxPriceMinor && priceMinor > t.maxPriceMinor) {
      throw new HttpError(
        400,
        'above_highest_price',
        `${money(priceMinor)} is above the highest price for ${t.name}, ${money(t.maxPriceMinor)}.`,
      );
    }
  }
}

/** The stay rules a change can set, with the value that means "the property's usual". */
const RULES = [
  { key: 'priceMinor', column: 'price_minor', type: 'integer', usual: null },
  { key: 'minNights', column: 'min_nights', type: 'integer', usual: null },
  { key: 'closedToArrival', column: 'closed_to_arrival', type: 'boolean', usual: false },
  { key: 'closedToDeparture', column: 'closed_to_departure', type: 'boolean', usual: false },
] as const;

/**
 * Sets prices and stay rules on the chosen nights in one statement, however many nights and
 * properties. Rows already holding the new values are left alone, so the audit log and the
 * channels see only real changes. Returns how many nights changed.
 */
async function changeRules(tx: Tx, ids: string[], change: Change): Promise<number> {
  const given = RULES.filter((rule) => change[rule.key] !== undefined).map((rule) => ({
    ...rule,
    value: change[rule.key] as number | boolean | null,
  }));
  if (given.length === 0) return 0;

  const list = (parts: SQL[]) => sql.join(parts, sql`, `);
  const columns = list(given.map((g) => sql.raw(g.column)));
  const values = list(given.map((g) => sql`${g.value}::${sql.raw(g.type)}`));
  const current = list(given.map((g) => sql`c.${sql.raw(g.column)}`));
  const weekdays = (night: SQL) =>
    change.daysOfWeek ? sql`and extract(isodow from ${night})::int in ${change.daysOfWeek}` : sql``;
  const changed = new Set<string>();
  const remember = (rows: Record<string, unknown>[]) => {
    for (const row of rows) changed.add(`${row.property_id}|${row.night}`);
  };

  if (given.some((g) => g.value !== g.usual)) {
    // Nights get rules of their own: add a row where there is none, and change the rest.
    const result = await tx.execute(sql`
      insert into app.calendar_days as c (organisation_id, property_id, night, ${columns})
      select p.organisation_id, p.id, n.night::date, ${values}
        from app.properties p
       cross join generate_series(${change.firstNight}::timestamp, ${change.lastNight}::timestamp, interval '1 day') as n(night)
       where p.id in ${ids} ${weekdays(sql`n.night`)}
      on conflict (property_id, night) do update
         set ${list(given.map((g) => sql`${sql.raw(g.column)} = excluded.${sql.raw(g.column)}`))}
       where (${current}) is distinct from (${list(given.map((g) => sql`excluded.${sql.raw(g.column)}`))})
      returning c.property_id, c.night::text as night`);
    remember(result.rows);
  } else {
    // Back to the usual rules: only nights with rows of their own can change.
    const result = await tx.execute(sql`
      update app.calendar_days c
         set ${list(given.map((g) => sql`${sql.raw(g.column)} = ${g.value}::${sql.raw(g.type)}`))}
       where c.property_id in ${ids}
         and c.night between ${change.firstNight}::date and ${change.lastNight}::date
         ${weekdays(sql`c.night`)}
         and (${current}) is distinct from (${values})
      returning c.property_id, c.night::text as night`);
    remember(result.rows);
  }

  // A night back on every usual rule needs no row of its own.
  await tx.execute(sql`
    delete from app.calendar_days c
     where c.property_id in ${ids}
       and c.night between ${change.firstNight}::date and ${change.lastNight}::date
       and c.price_minor is null and c.min_nights is null
       and not c.closed_to_arrival and not c.closed_to_departure`);
  return changed.size;
}

/** Blocks the chosen nights that are free; booked and blocked nights stay as they are. */
async function block(
  tx: Tx,
  userId: string,
  targets: Target[],
  nights: string[],
  reason: string | undefined,
): Promise<{ blockedNights: number; takenNights: number }> {
  const first = nights[0] ?? '';
  const last = nights.at(-1) ?? first;
  const held = await tx.execute(sql`
    select property_id, lower(nights)::text as start, upper(nights)::text as finish
      from app.occupancies
     where property_id in ${targets.map((t) => t.id)}
       and nights && daterange(${first}::date, ${last}::date, '[]')`);
  const holds = new Map<string, { start: string; finish: string }[]>();
  for (const row of held.rows as { property_id: string; start: string; finish: string }[]) {
    holds.set(row.property_id, [...(holds.get(row.property_id) ?? []), row]);
  }

  const rows: (typeof blocks.$inferInsert)[] = [];
  let blockedNights = 0;
  let takenNights = 0;
  for (const target of targets) {
    const taken = holds.get(target.id) ?? [];
    const free = nights.filter((night) => !taken.some((h) => h.start <= night && night < h.finish));
    takenNights += nights.length - free.length;
    for (const [startsOn, endsOn] of runs(free)) {
      blockedNights += nightsBetween(startsOn, endsOn);
      rows.push({
        organisationId: target.organisationId,
        propertyId: target.id,
        startsOn,
        endsOn,
        reason: reason || null,
        createdBy: userId,
      });
    }
  }
  if (rows.length) {
    await tx
      .insert(blocks)
      .values(rows)
      .catch((error: unknown) => {
        // Someone booked or blocked one of these nights a moment ago: the double-booking guard refused it.
        if (pgErrorCode(error) === '23P01') {
          throw new HttpError(
            409,
            'nights_taken',
            'Some of those nights were booked or blocked a moment ago. Look again and try once more.',
          );
        }
        throw error;
      });
  }
  return { blockedNights, takenNights };
}

/** Opens the chosen nights in any block that has them; the rest of each block stays blocked. */
async function reopen(tx: Tx, ids: string[], nights: string[]): Promise<number> {
  const first = nights[0] ?? '';
  const last = nights.at(-1) ?? first;
  const chosen = new Set(nights);
  const overlapping = await tx
    .select()
    .from(blocks)
    .where(and(inArray(blocks.propertyId, ids), lte(blocks.startsOn, last), gt(blocks.endsOn, first)));

  let reopened = 0;
  const removed: string[] = [];
  const rest: (typeof blocks.$inferInsert)[] = [];
  for (const b of overlapping) {
    const all = eachNight(b.startsOn, b.endsOn);
    const opening = all.filter((night) => chosen.has(night)).length;
    if (opening === 0) continue;
    reopened += opening;
    removed.push(b.id);
    for (const [startsOn, endsOn] of runs(all.filter((night) => !chosen.has(night)))) {
      rest.push({
        organisationId: b.organisationId,
        propertyId: b.propertyId,
        startsOn,
        endsOn,
        reason: b.reason,
        createdBy: b.createdBy,
      });
    }
  }
  // Two statements, so the old block's nights are released before what is left of it is held again.
  if (removed.length) await tx.delete(blocks).where(inArray(blocks.id, removed));
  if (rest.length) await tx.insert(blocks).values(rest);
  return reopened;
}

export function calendarRoutes(app: FastifyInstance, deps: { scope: RequestScope }) {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/v1/calendar',
    { schema: { querystring: CalendarQuerySchema, response: { 200: CalendarSchema } } },
    async (req) =>
      deps.scope.inOrg(req, 'calendar.read', async (tx): Promise<Calendar> => {
        const { from, to, freeFrom, freeTo, guests: party } = req.query;
        const { today } = await operatorSettings(tx);
        // Asked for properties free for a stay: no booking or block on any of its nights, room enough.
        const free =
          freeFrom && freeTo
            ? sql`not exists (
                select 1 from app.occupancies o
                 where o.property_id = ${properties.id}
                   and o.nights && daterange(${freeFrom}::date, ${freeTo}::date, '[)'))`
            : undefined;
        // Row-level security limits every query here to the operator in scope.
        const rows = await tx
          .select({
            id: properties.id,
            name: properties.name,
            internalCode: properties.internalCode,
            area: properties.area,
            city: properties.city,
            bedrooms: properties.bedrooms,
            maxGuests: properties.maxGuests,
            tags: properties.tags,
            cleaningStatus: properties.cleaningStatus,
            cleaningChangedAt: properties.cleaningChangedAt,
            cleaningChangedBy: sql<string | null>`coalesce(${appUsers.fullName}, ${appUsers.email})`,
            managedBy: properties.managedBy,
            priceOwner: properties.priceOwner,
            basePriceMinor: properties.basePriceMinor,
            weekendPriceMinor: properties.weekendPriceMinor,
            minPriceMinor: properties.minPriceMinor,
            maxPriceMinor: properties.maxPriceMinor,
            minNights: properties.minNights,
            maxNights: properties.maxNights,
          })
          .from(properties)
          // Whoever last marked it clean or dirty, by name: one of the team, so row-level security shows them.
          .leftJoin(appUsers, eq(appUsers.id, properties.cleaningChangedBy))
          .where(
            and(isNull(properties.archivedAt), free, party ? gte(properties.maxGuests, party) : undefined),
          )
          .orderBy(asc(properties.name));
        // How many there are in all, so the screen can say "3 of 12" when only some are free.
        let propertyCount = rows.length;
        if (free || party) {
          const [all] = await tx
            .select({ count: sql<number>`count(*)::int` })
            .from(properties)
            .where(isNull(properties.archivedAt));
          propertyCount = all?.count ?? 0;
        }
        const ids = rows.map((r) => r.id);
        if (ids.length === 0) {
          return { from, to, today, properties: [], propertyCount, nights: [], stays: [], blocks: [] };
        }

        const covers = await tx
          .select({
            propertyId: propertyPhotos.propertyId,
            url: sql<string>`(array_agg(${propertyPhotos.url} order by ${propertyPhotos.position}, ${propertyPhotos.createdAt}))[1]`,
          })
          .from(propertyPhotos)
          .where(inArray(propertyPhotos.propertyId, ids))
          .groupBy(propertyPhotos.propertyId);
        const coverOf = new Map(covers.map((c) => [c.propertyId, c.url]));

        const nights = await tx
          .select({
            propertyId: calendarDays.propertyId,
            night: calendarDays.night,
            priceMinor: calendarDays.priceMinor,
            minNights: calendarDays.minNights,
            closedToArrival: calendarDays.closedToArrival,
            closedToDeparture: calendarDays.closedToDeparture,
          })
          .from(calendarDays)
          .where(
            and(
              inArray(calendarDays.propertyId, ids),
              gte(calendarDays.night, from),
              lte(calendarDays.night, to),
            ),
          )
          .orderBy(asc(calendarDays.night));

        // Stays leaving on the first day are included: the calendar shows that day's turnover.
        const stays = await tx
          .select({
            id: reservations.id,
            propertyId: reservations.propertyId,
            checkIn: reservations.checkIn,
            checkOut: reservations.checkOut,
            status: reservations.status,
            channel: reservations.channel,
            channelReference: reservations.channelReference,
            guestName: guests.fullName,
            adults: reservations.adults,
            children: reservations.children,
          })
          .from(reservations)
          .leftJoin(guests, eq(guests.id, reservations.guestId))
          .where(
            and(
              inArray(reservations.propertyId, ids),
              inArray(reservations.status, ['confirmed', 'conflict']),
              lte(reservations.checkIn, to),
              gte(reservations.checkOut, from),
            ),
          )
          .orderBy(asc(reservations.checkIn));

        const held = await tx
          .select({
            id: blocks.id,
            propertyId: blocks.propertyId,
            startsOn: blocks.startsOn,
            endsOn: blocks.endsOn,
            reason: blocks.reason,
          })
          .from(blocks)
          .where(and(inArray(blocks.propertyId, ids), lte(blocks.startsOn, to), gt(blocks.endsOn, from)))
          .orderBy(asc(blocks.startsOn));

        return {
          from,
          to,
          today,
          properties: rows.map(({ cleaningStatus, cleaningChangedAt, cleaningChangedBy, ...r }) => ({
            ...r,
            coverPhotoUrl: coverOf.get(r.id) ?? null,
            cleaning: {
              status: cleaningStatus,
              changedAt: cleaningChangedAt ? toIso(cleaningChangedAt) : null,
              changedBy: cleaningChangedBy,
            },
          })),
          propertyCount,
          nights,
          stays: stays.map(({ adults, children, status, ...stay }) => ({
            ...stay,
            status: status === 'conflict' ? 'conflict' : 'confirmed',
            guests: adults + children,
          })),
          blocks: held,
        };
      }),
  );

  typed.patch(
    '/v1/calendar',
    { schema: { body: CalendarChangeSchema, response: { 200: CalendarChangeResultSchema } } },
    async (req) =>
      deps.scope.inOrg(req, 'calendar.write', async (tx, ctx): Promise<CalendarChangeResult> => {
        const change = req.body;
        const settings = await operatorSettings(tx);
        if (change.firstNight < settings.today) {
          throw new HttpError(400, 'nights_passed', 'Those nights have passed. Start from tonight or later.');
        }
        if (change.lastNight > addDays(settings.today, CALENDAR_DAYS_AHEAD)) {
          throw new HttpError(400, 'too_far_ahead', 'Nights can be changed up to two years ahead.');
        }
        const ids = [...new Set(change.propertyIds)];
        const targets = await tx
          .select({
            id: properties.id,
            organisationId: properties.organisationId,
            name: properties.name,
            priceOwner: properties.priceOwner,
            minPriceMinor: properties.minPriceMinor,
            maxPriceMinor: properties.maxPriceMinor,
          })
          .from(properties)
          .where(and(inArray(properties.id, ids), isNull(properties.archivedAt)))
          .orderBy(asc(properties.name));
        if (targets.length !== ids.length) {
          throw new HttpError(404, 'property_not_found', "One of those properties isn't in this workspace.");
        }
        if (typeof change.priceMinor === 'number') checkPrice(change.priceMinor, targets, settings);
        const nights = selectedNights(change.firstNight, change.lastNight, change.daysOfWeek);
        if (nights.length === 0) {
          throw new HttpError(400, 'no_nights', 'None of those nights fall on the chosen days of the week.');
        }

        const result: CalendarChangeResult = {
          changedNights: await changeRules(tx, ids, change),
          blockedNights: 0,
          takenNights: 0,
          reopenedNights: 0,
        };
        if (change.blocked === true) {
          Object.assign(result, await block(tx, ctx.userId, targets, nights, change.blockReason));
        } else if (change.blocked === false) {
          result.reopenedNights = await reopen(tx, ids, nights);
        }
        return result;
      }),
  );
}
