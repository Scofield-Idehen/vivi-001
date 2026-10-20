import { z } from 'zod';
import { CHANNELS, RESERVATION_STATUSES, type ReservationStatus } from './enums.ts';
import { ClockTime } from './schemas.ts';

/** What a booking's status means, in words. */
export const RESERVATION_STATUS_LABELS: Record<ReservationStatus, string> = {
  inquiry: 'Enquiry',
  request: 'Waiting for approval',
  confirmed: 'Confirmed',
  cancelled: 'Cancelled',
  conflict: 'Overlaps another booking',
};

/** The Reservations list's views: still to come or staying now, finished, and cancelled. */
export const RESERVATION_VIEWS = ['upcoming', 'past', 'cancelled'] as const;
export type ReservationView = (typeof RESERVATION_VIEWS)[number];

/** Most bookings a list sends at once. A search narrows the rest. */
export const RESERVATION_LIST_LIMIT = 200;

export const GUEST_NAME_MAX = 120;
export const NOTES_MAX = 4000;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Digits and the usual separators, with six digits at least: "+44 7700 900123", "(020) 7946 0018". */
const PHONE = /^\+?[0-9 ().-]{6,40}$/;

export function isEmail(value: string): boolean {
  return EMAIL.test(value);
}

export function isPhone(value: string): boolean {
  return PHONE.test(value) && value.replace(/\D/g, '').length >= 6;
}

export const ReservationListQuerySchema = z.object({
  view: z.enum(RESERVATION_VIEWS).default('upcoming'),
  /** A guest's name, a channel's code or a property's name, in part. */
  q: z.string().trim().max(100).optional(),
});
export type ReservationListQuery = z.infer<typeof ReservationListQuerySchema>;

export const ReservationSummarySchema = z.object({
  id: z.string(),
  propertyId: z.string(),
  propertyName: z.string(),
  status: z.enum(RESERVATION_STATUSES),
  channel: z.enum(CHANNELS),
  /** The channel's own code, such as an Airbnb confirmation code. */
  channelReference: z.string().nullable(),
  checkIn: z.string(),
  checkOut: z.string(),
  guestName: z.string().nullable(),
  adults: z.number().int(),
  children: z.number().int(),
  infants: z.number().int(),
  currency: z.string().nullable(),
  totalMinor: z.number().int().nullable(),
  createdAt: z.string(),
});
export type ReservationSummary = z.infer<typeof ReservationSummarySchema>;

export const ReservationListSchema = z.object({
  /** Today where the operator is. */
  today: z.string(),
  reservations: z.array(ReservationSummarySchema),
  /** More bookings match than were sent. */
  more: z.boolean(),
});
export type ReservationList = z.infer<typeof ReservationListSchema>;

/** One booking, with everything the reservation page shows. */
export const ReservationSchema = ReservationSummarySchema.extend({
  propertyCode: z.string().nullable(),
  /** The property's usual times, for a stay with none of its own. */
  propertyCheckInTime: z.string(),
  propertyCheckOutTime: z.string(),
  /** Times agreed for this stay only, or null for the property's usual ones. */
  checkInTime: z.string().nullable(),
  checkOutTime: z.string().nullable(),
  guestEmail: z.string().nullable(),
  guestPhone: z.string().nullable(),
  payoutMinor: z.number().int().nullable(),
  notes: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  updatedAt: z.string(),
  today: z.string(),
});
export type Reservation = z.infer<typeof ReservationSchema>;

/**
 * What the team may change on a booking. Only what is sent changes; an empty value clears it. The
 * dates, party and price stay as the channel sent them: those change on the channel.
 */
export const ReservationUpdateSchema = z
  .object({
    guestName: z.string().trim().max(GUEST_NAME_MAX).nullable().optional(),
    guestEmail: z
      .string()
      .trim()
      .max(254)
      .refine((v) => v === '' || isEmail(v), 'Enter an email address, such as name@example.com')
      .nullable()
      .optional(),
    guestPhone: z
      .string()
      .trim()
      .refine((v) => v === '' || isPhone(v), 'Enter a phone number, such as +44 7700 900123')
      .nullable()
      .optional(),
    checkInTime: ClockTime.nullable().optional(),
    checkOutTime: ClockTime.nullable().optional(),
    notes: z.string().trim().max(NOTES_MAX).nullable().optional(),
  })
  .refine((u) => Object.values(u).some((v) => v !== undefined), 'Nothing to change');
export type ReservationUpdate = z.input<typeof ReservationUpdateSchema>;

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'A date like 2026-11-05');

/**
 * A booking made by the team: a direct or repeat guest, a friend of the owner, a stay that came by
 * phone. It holds the nights like any other booking (and sends them to the channels once the
 * property runs through V-01). The price is for the record; nothing is charged yet.
 */
export const ReservationCreateSchema = z
  .object({
    propertyId: z.uuid(),
    checkIn: Day,
    checkOut: Day,
    guestName: z.string().trim().min(1).max(GUEST_NAME_MAX),
    guestEmail: z
      .string()
      .trim()
      .max(254)
      .refine((v) => v === '' || isEmail(v), 'Enter an email address, such as name@example.com')
      .optional(),
    guestPhone: z
      .string()
      .trim()
      .refine((v) => v === '' || isPhone(v), 'Enter a phone number, such as +44 7700 900123')
      .optional(),
    adults: z.number().int().min(1).max(50).default(2),
    children: z.number().int().min(0).max(50).default(0),
    infants: z.number().int().min(0).max(20).default(0),
    /** In minor units of the workspace's currency; optional, for the record. */
    totalMinor: z.number().int().min(0).max(100_000_000).optional(),
    checkInTime: ClockTime.optional(),
    checkOutTime: ClockTime.optional(),
    notes: z.string().trim().max(NOTES_MAX).optional(),
  })
  .refine((b) => b.checkOut > b.checkIn, {
    message: 'Check-out has to be after check-in.',
    path: ['checkOut'],
  });
export type ReservationCreate = z.input<typeof ReservationCreateSchema>;
