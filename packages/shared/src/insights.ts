import { z } from 'zod';
import { CHANNELS } from './enums.ts';
import { IsoDate } from './schemas.ts';

/**
 * Insights (built 31 Oct 2026): how the homes are doing over a period. Money is each confirmed
 * booking spread evenly over its nights, so a period counts the nights that fall in it. A night is
 * available unless it's blocked; occupancy is booked nights out of available ones.
 */

export const InsightsQuerySchema = z.object({
  from: IsoDate,
  /** The last day counted (inclusive). */
  to: IsoDate,
});

const Figures = {
  /** Nights in the period, less blocked ones. */
  availableNights: z.number().int(),
  bookedNights: z.number().int(),
  /** 0–100. */
  occupancy: z.number(),
  revenueMinor: z.number().int(),
  /** Average nightly rate: revenue per booked night. */
  adrMinor: z.number().int().nullable(),
  /** Revenue per available night. */
  revparMinor: z.number().int().nullable(),
  /** Stays arriving in the period. */
  bookings: z.number().int(),
  /** Average nights per stay arriving in the period. */
  averageStay: z.number().nullable(),
  /** Money spent on the home in the period. */
  expensesMinor: z.number().int(),
  /** Damage claimed, and received, for stays that ended in the period. */
  claimedMinor: z.number().int(),
  claimReceivedMinor: z.number().int(),
};

export const InsightsRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  sub: z.string().nullable(),
  ...Figures,
});
export type InsightsRow = z.infer<typeof InsightsRowSchema>;

export const InsightsSchema = z.object({
  from: IsoDate,
  to: IsoDate,
  currency: z.string(),
  totals: z.object(Figures),
  homes: z.array(InsightsRowSchema),
  owners: z.array(InsightsRowSchema),
  areas: z.array(InsightsRowSchema),
  channels: z.array(
    z.object({
      channel: z.enum(CHANNELS),
      bookings: z.number().int(),
      bookedNights: z.number().int(),
      revenueMinor: z.number().int(),
      adrMinor: z.number().int().nullable(),
      /** Days between booking and arrival, on average, for stays arriving in the period. */
      leadDays: z.number().nullable(),
    }),
  ),
  /** The twelve months up to the period's end: revenue, occupancy and nightly rate. */
  months: z.array(
    z.object({
      month: z.string(),
      revenueMinor: z.number().int(),
      occupancy: z.number(),
      adrMinor: z.number().int().nullable(),
    }),
  ),
});
export type Insights = z.infer<typeof InsightsSchema>;
