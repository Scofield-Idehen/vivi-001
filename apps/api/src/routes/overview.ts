import type { Tx } from '@v01/db';
import {
  addDays,
  type DailyOverview,
  DailyOverviewQuerySchema,
  DailyOverviewSchema,
  monthWeeks,
  previousMonth,
  type Revenue,
  RevenueQuerySchema,
  RevenueSchema,
  type Trends,
  TrendsQuerySchema,
  TrendsSchema,
  todayIn,
} from '@v01/shared';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { RequestScope } from '../context.ts';

/**
 * Today's overview (Alpha, 29 Oct 2026, after Guesty's dashboard): the day's moves, money by month,
 * and the trend of the coming days. Everything is counted from confirmed bookings on homes not
 * archived, in the workspace's own time zone.
 */

async function settings(tx: Tx): Promise<{ timeZone: string; currency: string }> {
  const [row] = (
    await tx.execute<{ time_zone: string; currency: string }>(
      sql`select time_zone, currency from app.organisation_settings limit 1`,
    )
  ).rows;
  return { timeZone: row?.time_zone ?? 'Europe/London', currency: row?.currency ?? 'GBP' };
}

const STAYS = sql`app.reservations r join app.properties p on p.id = r.property_id and p.archived_at is null`;

export function overviewRoutes(app: FastifyInstance, deps: { scope: RequestScope; now?: () => Date }) {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const now = () => deps.now?.() ?? new Date();

  typed.get(
    '/v1/overview',
    { schema: { querystring: DailyOverviewQuerySchema, response: { 200: DailyOverviewSchema } } },
    async (req) =>
      deps.scope.inOrg(req, 'calendar.read', async (tx): Promise<DailyOverview> => {
        const { timeZone } = await settings(tx);
        const today = todayIn(timeZone, now());
        // Local time now where the operator is, to tell who is past their check-in or check-out time.
        const localNow = new Intl.DateTimeFormat('en-GB', {
          timeZone,
          hour: '2-digit',
          minute: '2-digit',
          hourCycle: 'h23',
        }).format(now());
        const range = req.query.range;
        const from = range === 'tomorrow' ? addDays(today, 1) : today;
        const to = range === 'week' ? addDays(today, 6) : from;
        const isToday = range === 'today';
        const [row] = (
          await tx.execute<{
            check_ins: number;
            arrived: number;
            ready: number;
            check_outs: number;
            left: number;
            cleaned: number;
            turnovers: number;
            shortest_minutes: number | null;
            staying: number;
            need_cleaning: number;
          }>(sql`
            with ins as (
              select r.property_id, r.check_in as day, coalesce(r.check_in_time, p.check_in_time) as at,
                     p.cleaning_status
                from ${STAYS}
               where r.status = 'confirmed' and r.check_in between ${from}::date and ${to}::date
            ), outs as (
              select r.property_id, r.check_out as day, coalesce(r.check_out_time, p.check_out_time) as at,
                     p.cleaning_status, p.cleaning_changed_at
                from ${STAYS}
               where r.status = 'confirmed' and r.check_out between ${from}::date and ${to}::date
            ), turns as (
              select extract(epoch from (i.at - o.at)) / 60 as gap
                from ins i join outs o on o.property_id = i.property_id and o.day = i.day
            )
            select (select count(*) from ins)::int as check_ins,
                   (select count(*) from ins where day < ${today}::date or (day = ${today}::date and at <= ${localNow}::time))::int as arrived,
                   (select count(*) from outs where day < ${today}::date or (day = ${today}::date and at <= ${localNow}::time))::int as left,
                   (select count(*) from ins where cleaning_status <> 'dirty')::int as ready,
                   (select count(*) from outs)::int as check_outs,
                   (select count(*) from outs
                     where cleaning_status <> 'dirty' and cleaning_changed_at >= ${from}::date)::int as cleaned,
                   (select count(*) from turns)::int as turnovers,
                   (select min(gap) from turns)::int as shortest_minutes,
                   (select count(*) from ${STAYS}
                     where r.status = 'confirmed' and r.check_in < ${from}::date and r.check_out > ${from}::date)::int as staying,
                   (select count(*) from app.properties
                     where archived_at is null and cleaning_status = 'dirty')::int as need_cleaning`)
        ).rows;
        return {
          range,
          from,
          to,
          checkIns: {
            total: row?.check_ins ?? 0,
            done: isToday ? (row?.arrived ?? 0) : null,
            ready: isToday ? (row?.ready ?? 0) : null,
          },
          checkOuts: {
            total: row?.check_outs ?? 0,
            done: isToday ? (row?.left ?? 0) : null,
            cleaned: isToday ? (row?.cleaned ?? 0) : null,
          },
          turnovers: {
            total: row?.turnovers ?? 0,
            shortestHours:
              row?.shortest_minutes === null || row?.shortest_minutes === undefined
                ? null
                : Math.round((row.shortest_minutes / 60) * 10) / 10,
          },
          staying: row?.staying ?? 0,
          needCleaning: row?.need_cleaning ?? 0,
        };
      }),
  );

  typed.get(
    '/v1/overview/revenue',
    { schema: { querystring: RevenueQuerySchema, response: { 200: RevenueSchema } } },
    async (req) =>
      deps.scope.inOrg(req, 'reservations.read', async (tx): Promise<Revenue> => {
        const { timeZone, currency } = await settings(tx);
        const month = req.query.month ?? todayIn(timeZone, now()).slice(0, 7);
        const before = previousMonth(month);
        // Each confirmed booking's money spread evenly over its nights, night by night, for both months.
        const rows = (
          await tx.execute<{ night: string; minor: number; nights: number }>(sql`
            with spread as (
              select n::date as night, r.total_minor::numeric / greatest(r.check_out - r.check_in, 1) as minor
                from ${STAYS}
                cross join lateral generate_series(r.check_in, r.check_out - 1, interval '1 day') n
               where r.status = 'confirmed' and r.total_minor is not null
                 and r.check_out > ${`${before}-01`}::date
                 and r.check_in < (${`${month}-01`}::date + interval '1 month')
            )
            select night::text, round(sum(minor))::bigint::int as minor, count(*)::int as nights
              from spread
             where night >= ${`${before}-01`}::date and night < (${`${month}-01`}::date + interval '1 month')
             group by night order by night`)
        ).rows;
        const byNight = new Map(rows.map((r) => [r.night, r]));
        const day = (m: string, d: number) => `${m}-${String(d).padStart(2, '0')}`;
        const lastDay = (m: string) => {
          const [y, mm] = m.split('-').map(Number) as [number, number];
          return new Date(Date.UTC(y, mm, 0)).getUTCDate();
        };
        const sum = (m: string, from: number, to: number) => {
          let minor = 0;
          let nights = 0;
          for (let d = from; d <= Math.min(to, lastDay(m)); d++) {
            const r = byNight.get(day(m, d));
            if (r) {
              minor += Number(r.minor);
              nights += r.nights;
            }
          }
          return { minor, nights };
        };
        const all = (m: string) => sum(m, 1, 31);
        const rate = (s: { minor: number; nights: number }) =>
          s.nights ? Math.round(s.minor / s.nights) : null;
        const days = [];
        for (let d = 1; d <= lastDay(month); d++) {
          const cur = byNight.get(day(month, d));
          const prev = d <= lastDay(before) ? byNight.get(day(before, d)) : undefined;
          days.push({
            date: day(month, d),
            currentMinor: cur ? Math.round(Number(cur.minor) / cur.nights) : null,
            previousMinor: prev ? Math.round(Number(prev.minor) / prev.nights) : null,
          });
        }
        return {
          month,
          currency,
          adr: { currentMinor: rate(all(month)), previousMinor: rate(all(before)), days },
          total: {
            currentMinor: all(month).minor,
            previousMinor: all(before).minor,
            weeks: monthWeeks(month).map((w) => ({
              label: w.label,
              days: w.to - w.from + 1,
              currentMinor: sum(month, w.from, w.to).minor,
              previousMinor: sum(before, w.from, w.to).minor,
            })),
          },
        };
      }),
  );

  typed.get(
    '/v1/overview/trends',
    { schema: { querystring: TrendsQuerySchema, response: { 200: TrendsSchema } } },
    async (req) =>
      deps.scope.inOrg(req, 'calendar.read', async (tx): Promise<Trends> => {
        const { timeZone } = await settings(tx);
        const today = todayIn(timeZone, now());
        const last = addDays(today, req.query.days - 1);
        const rows = (
          await tx.execute<{
            date: string;
            check_ins: number;
            check_outs: number;
            turnovers: number;
            occupied: number;
            homes: number;
          }>(sql`
            with days as (
              select d::date as day from generate_series(${today}::date, ${last}::date, interval '1 day') d
            ), homes as (
              select count(*)::int as n from app.properties where archived_at is null
            ), conf as (
              select r.property_id, r.check_in, r.check_out from ${STAYS} where r.status = 'confirmed'
                and r.check_out >= ${today}::date and r.check_in <= ${last}::date
            )
            select days.day::text as date,
                   (select count(*) from conf where check_in = days.day)::int as check_ins,
                   (select count(*) from conf where check_out = days.day)::int as check_outs,
                   (select count(*) from conf a join conf b on a.property_id = b.property_id
                     where a.check_out = days.day and b.check_in = days.day)::int as turnovers,
                   (select count(distinct property_id) from conf
                     where check_in <= days.day and check_out > days.day)::int as occupied,
                   (select n from homes) as homes
              from days order by days.day`)
        ).rows;
        const pct = (o: number, h: number) => (h ? Math.round((o / h) * 1000) / 10 : 0);
        const out = rows.map((r) => ({
          date: r.date,
          checkIns: r.check_ins,
          checkOuts: r.check_outs,
          turnovers: r.turnovers,
          occupancy: pct(r.occupied, r.homes),
        }));
        const homes = rows[0]?.homes ?? 0;
        return {
          days: out,
          totals: {
            checkIns: out.reduce((s, d) => s + d.checkIns, 0),
            checkOuts: out.reduce((s, d) => s + d.checkOuts, 0),
            turnovers: out.reduce((s, d) => s + d.turnovers, 0),
            occupancy: pct(
              rows.reduce((s, r) => s + r.occupied, 0),
              homes * rows.length,
            ),
          },
        };
      }),
  );
}
