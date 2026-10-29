import { z } from 'zod';
import { IsoDate } from './schemas.ts';

/**
 * The overview on Today, the way Guesty lays it out: a daily overview for today, tomorrow or the
 * next seven days; revenue for a month against the one before; and trends for the next 7 or 30 days.
 * Money is in minor units of the workspace's currency.
 */

export const OVERVIEW_RANGES = ['today', 'tomorrow', 'week'] as const;
export type OverviewRange = (typeof OVERVIEW_RANGES)[number];

export const DailyOverviewQuerySchema = z.object({ range: z.enum(OVERVIEW_RANGES).default('today') });

export const DailyOverviewSchema = z.object({
  range: z.enum(OVERVIEW_RANGES),
  from: IsoDate,
  to: IsoDate,
  /**
   * Arrivals in the range. Today only: how many are past their check-in time (the time agreed for
   * the stay, or the home's usual one), and how many of the homes are clean and ready.
   */
  checkIns: z.object({
    total: z.number().int(),
    done: z.number().int().nullable(),
    ready: z.number().int().nullable(),
  }),
  /** Departures in the range. Today only: how many are past their check-out time, and how many homes are cleaned again. */
  checkOuts: z.object({
    total: z.number().int(),
    done: z.number().int().nullable(),
    cleaned: z.number().int().nullable(),
  }),
  /** A home with a guest leaving and another arriving the same day; the tightest gap, in hours. */
  turnovers: z.object({ total: z.number().int(), shortestHours: z.number().nullable() }),
  /** Stays already under way on the first day of the range. */
  staying: z.number().int(),
  /** Homes marked dirty now. */
  needCleaning: z.number().int(),
});
export type DailyOverview = z.infer<typeof DailyOverviewSchema>;

export const RevenueQuerySchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected a month as YYYY-MM')
    .optional(),
});

export const RevenueSchema = z.object({
  month: z.string(),
  currency: z.string(),
  /** Average nightly rate: booked money per occupied night, for the month and the one before. */
  adr: z.object({
    currentMinor: z.number().int().nullable(),
    previousMinor: z.number().int().nullable(),
    /** Day by day; previous is the same day-of-month a month earlier. */
    days: z.array(
      z.object({
        date: IsoDate,
        currentMinor: z.number().int().nullable(),
        previousMinor: z.number().int().nullable(),
      }),
    ),
  }),
  /** Money earned on the nights of the month (each booking spread over its nights). */
  total: z.object({
    currentMinor: z.number().int(),
    previousMinor: z.number().int(),
    /** Calendar weeks: 1–7, 8–14, 15–21, 22–28, 29 to the end. */
    weeks: z.array(
      z.object({
        label: z.string(),
        days: z.number().int(),
        currentMinor: z.number().int(),
        previousMinor: z.number().int(),
      }),
    ),
  }),
});
export type Revenue = z.infer<typeof RevenueSchema>;

export const TrendsQuerySchema = z.object({
  days: z.coerce
    .number()
    .int()
    .pipe(z.union([z.literal(7), z.literal(30)]))
    .default(7),
});

export const TrendsSchema = z.object({
  days: z.array(
    z.object({
      date: IsoDate,
      checkIns: z.number().int(),
      checkOuts: z.number().int(),
      turnovers: z.number().int(),
      /** Share of homes with a guest that night, 0–100. */
      occupancy: z.number(),
    }),
  ),
  totals: z.object({
    checkIns: z.number().int(),
    checkOuts: z.number().int(),
    turnovers: z.number().int(),
    occupancy: z.number(),
  }),
});
export type Trends = z.infer<typeof TrendsSchema>;

/** The five calendar weeks of a month, as day ranges. */
export function monthWeeks(month: string): { label: string; from: number; to: number }[] {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const name = new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y, m - 1, 1)),
  );
  return [1, 8, 15, 22, 29]
    .filter((from) => from <= last)
    .map((from) => {
      const to = Math.min(from + 6, last);
      return { label: `${name} ${from}–${to}`, from, to };
    });
}

/** The month before, as YYYY-MM. */
export function previousMonth(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}
