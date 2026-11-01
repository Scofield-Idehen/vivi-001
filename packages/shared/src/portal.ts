import { z } from 'zod';
import { CHANNELS } from './enums.ts';
import { STATEMENT_STATUSES } from './owners.ts';
import { IsoDate, Uuid } from './schemas.ts';

/**
 * The owner log-in (1 Nov 2026). An owner signs in and sees their own homes only: when they are
 * booked (no guest names or contact details), and their finalised monthly statements with receipts.
 * Nothing can be changed. Row-level security keeps every other home out of reach.
 */

export const OwnerLoginInviteSchema = z.object({
  email: z.email('An email address like name@example.com').max(254),
});
export type OwnerLoginInvite = z.infer<typeof OwnerLoginInviteSchema>;

/** Invite several owners at once, each at the email on their record. */
export const OwnerLoginBulkSchema = z.object({ ownerIds: z.array(Uuid).min(1).max(500) });
export type OwnerLoginBulk = z.infer<typeof OwnerLoginBulkSchema>;

export const OwnerLoginBulkResultSchema = z.object({
  invited: z.number().int(),
  /** Who wasn't invited, and why: no email, already can log in, already invited, on the team. */
  skipped: z.array(z.object({ name: z.string(), reason: z.string() })),
});
export type OwnerLoginBulkResult = z.infer<typeof OwnerLoginBulkResultSchema>;

export const PortalSchema = z.object({
  owner: z.object({ name: z.string(), company: z.string().nullable() }),
  organisationName: z.string(),
  currency: z.string(),
  today: IsoDate,
  homes: z.array(z.object({ id: Uuid, name: z.string(), area: z.string().nullable() })),
  /** This month so far: nights booked and what they earn, before the fee and expenses. */
  thisMonth: z.object({ month: z.string(), bookedNights: z.number().int(), earnedMinor: z.number().int() }),
  /** Finalised statements, newest first. Drafts stay with the office until they are finalised. */
  statements: z.array(
    z.object({
      month: z.string(),
      status: z.enum(STATEMENT_STATUSES),
      earnedMinor: z.number().int(),
      feeMinor: z.number().int(),
      expensesMinor: z.number().int(),
      netMinor: z.number().int(),
      paidOn: IsoDate.nullable(),
    }),
  ),
});
export type Portal = z.infer<typeof PortalSchema>;

export const PortalCalendarQuerySchema = z.object({ from: IsoDate, to: IsoDate });

export const PortalCalendarSchema = z.object({
  from: IsoDate,
  to: IsoDate,
  stays: z.array(
    z.object({ id: Uuid, propertyId: Uuid, checkIn: IsoDate, checkOut: IsoDate, channel: z.enum(CHANNELS) }),
  ),
  blocks: z.array(z.object({ id: Uuid, propertyId: Uuid, startsOn: IsoDate, endsOn: IsoDate })),
});
export type PortalCalendar = z.infer<typeof PortalCalendarSchema>;
