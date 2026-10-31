import { organisationSettings, type Tx } from '@v01/db';
import {
  addDays,
  type Channel,
  type Insights,
  InsightsQuerySchema,
  type InsightsRow,
  InsightsSchema,
  previousMonth,
} from '@v01/shared';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { RequestScope } from '../context.ts';
import { HttpError } from '../errors.ts';

/**
 * Insights (built 31 Oct 2026): occupancy, nightly rate, revenue, expenses and claims, by home,
 * owner, area and channel, for any period up to a year, and the twelve months to its end. Money
 * is each confirmed booking spread over its nights; a blocked night isn't available.
 */

const MAX_DAYS = 366;

type Base = {
  id: string;
  name: string;
  area: string | null;
  ownerId: string | null;
  ownerName: string | null;
  blocked: number;
  bookedNights: number;
  revenueMinor: number;
  bookings: number;
  stayNights: number;
  expensesMinor: number;
  claimedMinor: number;
  claimReceivedMinor: number;
};

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;

function figures(rows: Base[], days: number): Omit<InsightsRow, 'id' | 'name' | 'sub'> {
  const sum = (k: keyof Base) => rows.reduce((t, r) => t + Number(r[k] ?? 0), 0);
  const available = Math.max(0, rows.length * days - sum('blocked'));
  const booked = sum('bookedNights');
  const revenue = sum('revenueMinor');
  const bookings = sum('bookings');
  return {
    availableNights: available,
    bookedNights: booked,
    occupancy: available ? Math.round((Math.min(booked, available) / available) * 1000) / 10 : 0,
    revenueMinor: revenue,
    adrMinor: booked ? Math.round(revenue / booked) : null,
    revparMinor: available ? Math.round(revenue / available) : null,
    bookings,
    averageStay: bookings ? Math.round((sum('stayNights') / bookings) * 10) / 10 : null,
    expensesMinor: sum('expensesMinor'),
    claimedMinor: sum('claimedMinor'),
    claimReceivedMinor: sum('claimReceivedMinor'),
  };
}

function groupBy(
  rows: Base[],
  days: number,
  key: (r: Base) => string,
  name: (r: Base) => string,
  sub: (rs: Base[]) => string | null,
): InsightsRow[] {
  const groups = new Map<string, Base[]>();
  for (const r of rows) groups.set(key(r), [...(groups.get(key(r)) ?? []), r]);
  return [...groups]
    .map(([id, rs]) => ({ id, name: name(rs[0] as Base), sub: sub(rs), ...figures(rs, days) }))
    .sort((a, b) => b.revenueMinor - a.revenueMinor);
}

async function base(tx: Tx, from: string, to: string): Promise<Base[]> {
  const end = addDays(to, 1);
  const rows = (
    await tx.execute<{
      id: string;
      name: string;
      area: string | null;
      owner_id: string | null;
      owner_name: string | null;
      blocked: number;
      booked_nights: number;
      revenue: number;
      bookings: number;
      stay_nights: number;
      expenses: number;
      claimed: number;
      received: number;
    }>(sql`
      with homes as (
        select p.id, p.name, p.area, p.owner_id, o.name as owner_name
          from app.properties p left join app.owners o on o.id = p.owner_id
         where p.archived_at is null
      ), blocked as (
        select b.property_id,
               sum(greatest(0, least(b.ends_on, ${end}::date) - greatest(b.starts_on, ${from}::date)))::int as n
          from app.blocks b
         where b.ends_on > ${from}::date and b.starts_on < ${end}::date
         group by b.property_id
      ), nights as (
        select r.property_id, count(*)::int as n,
               coalesce(round(sum(r.total_minor::numeric / greatest(r.check_out - r.check_in, 1))), 0)::bigint as minor
          from app.reservations r
          cross join lateral generate_series(r.check_in, r.check_out - 1, interval '1 day') d
         where r.status = 'confirmed' and d >= ${from}::date and d < ${end}::date
         group by r.property_id
      ), arrivals as (
        select r.property_id, count(*)::int as n, sum(r.check_out - r.check_in)::int as stay
          from app.reservations r
         where r.status = 'confirmed' and r.check_in >= ${from}::date and r.check_in < ${end}::date
         group by r.property_id
      ), spent as (
        select e.property_id, sum(e.amount_minor)::bigint as minor
          from app.expenses e
         where e.property_id is not null and e.spent_on >= ${from}::date and e.spent_on < ${end}::date
         group by e.property_id
      ), claimed as (
        select r.property_id,
               coalesce(sum((select sum(i.amount_minor) from app.claim_items i where i.claim_id = c.id)), 0)::bigint as claimed,
               coalesce(sum(c.received_minor), 0)::bigint as received
          from app.claims c join app.reservations r on r.id = c.reservation_id
         where r.check_out >= ${from}::date and r.check_out < ${end}::date
         group by r.property_id
      )
      select h.id, h.name, h.area, h.owner_id, h.owner_name,
             coalesce(b.n, 0) as blocked, coalesce(n.n, 0) as booked_nights, coalesce(n.minor, 0) as revenue,
             coalesce(a.n, 0) as bookings, coalesce(a.stay, 0) as stay_nights, coalesce(s.minor, 0) as expenses,
             coalesce(c.claimed, 0) as claimed, coalesce(c.received, 0) as received
        from homes h
        left join blocked b on b.property_id = h.id
        left join nights n on n.property_id = h.id
        left join arrivals a on a.property_id = h.id
        left join spent s on s.property_id = h.id
        left join claimed c on c.property_id = h.id
       order by h.name`)
  ).rows;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    area: r.area,
    ownerId: r.owner_id,
    ownerName: r.owner_name,
    blocked: Number(r.blocked),
    bookedNights: Number(r.booked_nights),
    revenueMinor: Number(r.revenue),
    bookings: Number(r.bookings),
    stayNights: Number(r.stay_nights),
    expensesMinor: Number(r.expenses),
    claimedMinor: Number(r.claimed),
    claimReceivedMinor: Number(r.received),
  }));
}

export function insightRoutes(app: FastifyInstance, deps: { scope: RequestScope }) {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/v1/insights',
    { schema: { querystring: InsightsQuerySchema, response: { 200: InsightsSchema } } },
    async (req) =>
      deps.scope.inOrg(req, 'insights.read', async (tx): Promise<Insights> => {
        const { from, to } = req.query;
        if (to < from) throw new HttpError(400, 'invalid_request', 'The period ends before it starts.');
        const days = daysBetween(from, to);
        if (days > MAX_DAYS)
          throw new HttpError(400, 'invalid_request', 'Choose a period of a year or less.');
        const [settings] = await tx
          .select({ currency: organisationSettings.currency })
          .from(organisationSettings);
        const rows = await base(tx, from, to);
        const end = addDays(to, 1);

        const channels = (
          await tx.execute<{
            channel: Channel;
            bookings: number;
            nights: number;
            revenue: number;
            lead: number | null;
          }>(sql`
            with spread as (
              select r.channel, count(*)::int as nights,
                     coalesce(round(sum(r.total_minor::numeric / greatest(r.check_out - r.check_in, 1))), 0)::bigint as revenue
                from app.reservations r
                join app.properties p on p.id = r.property_id and p.archived_at is null
                cross join lateral generate_series(r.check_in, r.check_out - 1, interval '1 day') d
               where r.status = 'confirmed' and d >= ${from}::date and d < ${end}::date
               group by r.channel
            ), arriving as (
              select r.channel, count(*)::int as bookings,
                     avg(r.check_in - (r.created_at at time zone 'UTC')::date)::float as lead
                from app.reservations r
                join app.properties p on p.id = r.property_id and p.archived_at is null
               where r.status = 'confirmed' and r.check_in >= ${from}::date and r.check_in < ${end}::date
               group by r.channel
            )
            select coalesce(s.channel, a.channel) as channel, coalesce(a.bookings, 0) as bookings,
                   coalesce(s.nights, 0) as nights, coalesce(s.revenue, 0) as revenue, a.lead
              from spread s full join arriving a on a.channel = s.channel`)
        ).rows
          .map((c) => ({
            channel: c.channel,
            bookings: Number(c.bookings),
            bookedNights: Number(c.nights),
            revenueMinor: Number(c.revenue),
            adrMinor: Number(c.nights) ? Math.round(Number(c.revenue) / Number(c.nights)) : null,
            leadDays: c.lead === null ? null : Math.round(Number(c.lead)),
          }))
          .sort((a, b) => b.revenueMinor - a.revenueMinor);

        // Twelve months to the period's end.
        const last = to.slice(0, 7);
        const months: string[] = [last];
        while (months.length < 12) months.unshift(previousMonth(months[0] as string));
        const first = `${months[0]}-01`;
        const series = (
          await tx.execute<{ month: string; nights: number; revenue: number; blocked: number }>(sql`
            with m as (
              select to_char(d, 'YYYY-MM') as month
                from generate_series(${first}::date, ${`${last}-01`}::date, interval '1 month') d
            ), booked as (
              select to_char(d, 'YYYY-MM') as month, count(*)::int as nights,
                     coalesce(round(sum(r.total_minor::numeric / greatest(r.check_out - r.check_in, 1))), 0)::bigint as revenue
                from app.reservations r
                join app.properties p on p.id = r.property_id and p.archived_at is null
                cross join lateral generate_series(r.check_in, r.check_out - 1, interval '1 day') d
               where r.status = 'confirmed' and d >= ${first}::date
                 and d < (${`${last}-01`}::date + interval '1 month')
               group by 1
            ), blocked as (
              select to_char(d, 'YYYY-MM') as month, count(*)::int as nights
                from app.blocks b
                join app.properties p on p.id = b.property_id and p.archived_at is null
                cross join lateral generate_series(b.starts_on, b.ends_on - 1, interval '1 day') d
               where d >= ${first}::date and d < (${`${last}-01`}::date + interval '1 month')
               group by 1
            )
            select m.month, coalesce(b.nights, 0) as nights, coalesce(b.revenue, 0) as revenue,
                   coalesce(k.nights, 0) as blocked
              from m left join booked b on b.month = m.month left join blocked k on k.month = m.month
             order by m.month`)
        ).rows.map((r) => {
          const [y, mo] = r.month.split('-').map(Number) as [number, number];
          const inMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
          const available = Math.max(0, rows.length * inMonth - Number(r.blocked));
          const nights = Number(r.nights);
          return {
            month: r.month,
            revenueMinor: Number(r.revenue),
            occupancy: available ? Math.round((Math.min(nights, available) / available) * 1000) / 10 : 0,
            adrMinor: nights ? Math.round(Number(r.revenue) / nights) : null,
          };
        });

        return {
          from,
          to,
          currency: settings?.currency ?? 'GBP',
          totals: figures(rows, days),
          homes: rows
            .map((r) => ({ id: r.id, name: r.name, sub: r.ownerName ?? r.area, ...figures([r], days) }))
            .sort((a, b) => b.revenueMinor - a.revenueMinor),
          owners: groupBy(
            rows,
            days,
            (r) => r.ownerId ?? 'none',
            (r) => r.ownerName ?? 'No owner recorded',
            (rs) => `${rs.length} ${rs.length === 1 ? 'home' : 'homes'}`,
          ),
          areas: groupBy(
            rows,
            days,
            (r) => r.area?.trim().toLowerCase() || 'none',
            (r) => r.area?.trim() || 'No area',
            (rs) => `${rs.length} ${rs.length === 1 ? 'home' : 'homes'}`,
          ),
          channels,
          months: series,
        };
      }),
  );
}
