import { z } from 'zod';
import { addDays, isIsoDate, nightsBetween } from './dates.ts';
import { CHANNELS, CLEANING_STATUSES, MANAGED_BY, PRICE_OWNERS } from './enums.ts';
import { IsoDate, Uuid } from './schemas.ts';

/**
 * The calendar: every property by night. A night's price and stay rules are the property's usual
 * ones unless that night has its own (`calendar_days`); bookings and blocks hold nights.
 */

/** How far ahead nights can be changed. The channels take two years at most. */
export const CALENDAR_DAYS_AHEAD = 730;
/** The most nights one read of the calendar covers. */
export const CALENDAR_MAX_WINDOW = 62;
/** The most nights one change covers. */
export const CALENDAR_MAX_CHANGE = 366;
/** The most properties one change covers. */
export const CALENDAR_MAX_PROPERTIES = 100;

/** Monday is 1 and Sunday is 7, as in ISO 8601. */
export function isoWeekday(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

/** Friday and Saturday nights take the weekend price, as on Airbnb. */
export function isWeekendNight(night: string): boolean {
  const day = isoWeekday(night);
  return day === 5 || day === 6;
}

/** The nights from `first` to `last`, both included, on the chosen days of the week (all when none). */
export function selectedNights(first: string, last: string, daysOfWeek?: readonly number[]): string[] {
  const nights: string[] = [];
  for (let night = first; night <= last; night = addDays(night, 1)) {
    if (!daysOfWeek?.length || daysOfWeek.includes(isoWeekday(night))) nights.push(night);
  }
  return nights;
}

/** A property's usual price and stay rules: what every night uses unless it has its own. */
export interface UsualRules {
  basePriceMinor: number | null;
  weekendPriceMinor: number | null;
  minPriceMinor: number | null;
  maxPriceMinor: number | null;
  minNights: number;
  maxNights: number | null;
}

/** What one night has of its own, as stored. */
export interface NightOwnRules {
  priceMinor: number | null;
  minNights: number | null;
  closedToArrival: boolean;
  closedToDeparture: boolean;
}

/** What a night actually is: the price the channels get and the rules guests meet. */
export interface NightRules {
  /** Within the property's price limits. Null until the property has a price. */
  priceMinor: number | null;
  /** Where the price comes from. */
  priceFrom: 'night' | 'weekend' | 'usual' | null;
  /** The price was outside the limits, so the limit is used instead. */
  heldAt: 'lowest' | 'highest' | null;
  minNights: number;
  minNightsFrom: 'night' | 'usual';
  closedToArrival: boolean;
  closedToDeparture: boolean;
}

export function nightRules(usual: UsualRules, night: string, own?: NightOwnRules | null): NightRules {
  let priceMinor: number | null = null;
  let priceFrom: NightRules['priceFrom'] = null;
  if (own?.priceMinor) {
    priceMinor = own.priceMinor;
    priceFrom = 'night';
  } else if (usual.weekendPriceMinor && isWeekendNight(night)) {
    priceMinor = usual.weekendPriceMinor;
    priceFrom = 'weekend';
  } else if (usual.basePriceMinor) {
    priceMinor = usual.basePriceMinor;
    priceFrom = 'usual';
  }
  let heldAt: NightRules['heldAt'] = null;
  if (priceMinor !== null && usual.minPriceMinor && priceMinor < usual.minPriceMinor) {
    priceMinor = usual.minPriceMinor;
    heldAt = 'lowest';
  } else if (priceMinor !== null && usual.maxPriceMinor && priceMinor > usual.maxPriceMinor) {
    priceMinor = usual.maxPriceMinor;
    heldAt = 'highest';
  }
  return {
    priceMinor,
    priceFrom,
    heldAt,
    minNights: own?.minNights ?? usual.minNights,
    minNightsFrom: own?.minNights ? 'night' : 'usual',
    closedToArrival: own?.closedToArrival ?? false,
    closedToDeparture: own?.closedToDeparture ?? false,
  };
}

// API shapes ------------------------------------------------------------------------------------

export const CalendarQuerySchema = z
  .object({
    from: IsoDate,
    to: IsoDate,
    /** Only properties free for a stay arriving `freeFrom` and leaving `freeTo`, for `guests`. */
    freeFrom: IsoDate.optional(),
    freeTo: IsoDate.optional(),
    guests: z.coerce.number().int().min(1).max(50).optional(),
  })
  .refine((q) => !isIsoDate(q.from) || !isIsoDate(q.to) || q.to >= q.from, {
    message: 'The end is before the start',
    path: ['to'],
  })
  .refine(
    (q) => !isIsoDate(q.from) || !isIsoDate(q.to) || nightsBetween(q.from, q.to) < CALENDAR_MAX_WINDOW,
    { message: `Ask for up to ${CALENDAR_MAX_WINDOW} nights at a time`, path: ['to'] },
  )
  .refine((q) => (q.freeFrom === undefined) === (q.freeTo === undefined), {
    message: 'Give both the arrival and the departure date',
    path: ['freeTo'],
  })
  .refine((q) => !q.freeFrom || !q.freeTo || q.freeTo > q.freeFrom, {
    message: 'The departure is not after the arrival',
    path: ['freeTo'],
  });
export type CalendarQuery = z.infer<typeof CalendarQuerySchema>;

/** A property's cleaning state, as the calendar shows it under the name. */
export const CleaningStateSchema = z.object({
  status: z.enum(CLEANING_STATUSES),
  /** When it last changed: someone marking it, or a guest's check-out. */
  changedAt: z.string().nullable(),
  /** Who marked it, by name or email; null when a check-out made it dirty. */
  changedBy: z.string().nullable(),
});
export type CleaningState = z.infer<typeof CleaningStateSchema>;

export const CleaningUpdateSchema = z.object({ status: z.enum(CLEANING_STATUSES) });
export type CleaningUpdate = z.infer<typeof CleaningUpdateSchema>;

export const CalendarPropertySchema = z.object({
  id: Uuid,
  name: z.string(),
  internalCode: z.string().nullable(),
  coverPhotoUrl: z.string().nullable(),
  area: z.string().nullable(),
  city: z.string().nullable(),
  bedrooms: z.number().int().nullable(),
  maxGuests: z.number().int(),
  tags: z.array(z.string()),
  cleaning: CleaningStateSchema,
  managedBy: z.enum(MANAGED_BY),
  priceOwner: z.enum(PRICE_OWNERS),
  basePriceMinor: z.number().int().nullable(),
  weekendPriceMinor: z.number().int().nullable(),
  minPriceMinor: z.number().int().nullable(),
  maxPriceMinor: z.number().int().nullable(),
  minNights: z.number().int(),
  maxNights: z.number().int().nullable(),
});
export type CalendarProperty = z.infer<typeof CalendarPropertySchema>;

/** A night with rules of its own. Nights without one use the property's usual rules. */
export const CalendarNightSchema = z.object({
  propertyId: Uuid,
  night: z.string(),
  priceMinor: z.number().int().nullable(),
  minNights: z.number().int().nullable(),
  closedToArrival: z.boolean(),
  closedToDeparture: z.boolean(),
});
export type CalendarNight = z.infer<typeof CalendarNightSchema>;

/** A booking on the calendar. `conflict` overlapped another booking and holds no nights until a person sorts it. */
export const CalendarStaySchema = z.object({
  id: Uuid,
  propertyId: Uuid,
  checkIn: z.string(),
  checkOut: z.string(),
  status: z.enum(['confirmed', 'conflict']),
  channel: z.enum(CHANNELS),
  channelReference: z.string().nullable(),
  guestName: z.string().nullable(),
  /** Adults and children; infants don't count towards the limit. */
  guests: z.number().int(),
});
export type CalendarStay = z.infer<typeof CalendarStaySchema>;

/** Blocked nights: `endsOn` is the first night that is free again, like a check-out date. */
export const CalendarBlockSchema = z.object({
  id: Uuid,
  propertyId: Uuid,
  startsOn: z.string(),
  endsOn: z.string(),
  reason: z.string().nullable(),
});
export type CalendarBlock = z.infer<typeof CalendarBlockSchema>;

export const CalendarSchema = z.object({
  from: z.string(),
  to: z.string(),
  /** Today where the operator is. Earlier nights can't be changed. */
  today: z.string(),
  properties: z.array(CalendarPropertySchema),
  /** Every property in the workspace, free or not, so a screen can say "3 of 12". */
  propertyCount: z.number().int(),
  nights: z.array(CalendarNightSchema),
  stays: z.array(CalendarStaySchema),
  blocks: z.array(CalendarBlockSchema),
});
export type Calendar = z.infer<typeof CalendarSchema>;

/**
 * A change to some nights of one or more properties. Only what is sent changes: a price of null
 * goes back to the usual price, and a minimum stay of null to the usual minimum.
 */
export const CalendarChangeSchema = z
  .object({
    propertyIds: z.array(Uuid).min(1).max(CALENDAR_MAX_PROPERTIES),
    firstNight: IsoDate,
    lastNight: IsoDate,
    /** Only these days of the week, Monday 1 to Sunday 7. Every night when left out. */
    daysOfWeek: z.array(z.number().int().min(1).max(7)).min(1).max(7).optional(),
    priceMinor: z.number().int().positive().max(100_000_000).nullable().optional(),
    minNights: z.number().int().min(1).max(365).nullable().optional(),
    closedToArrival: z.boolean().optional(),
    closedToDeparture: z.boolean().optional(),
    /** True blocks the nights that are free; false reopens blocked ones. Bookings stay as they are. */
    blocked: z.boolean().optional(),
    blockReason: z.string().trim().max(200).optional(),
  })
  .refine((c) => !isIsoDate(c.firstNight) || !isIsoDate(c.lastNight) || c.lastNight >= c.firstNight, {
    message: 'The last night is before the first',
    path: ['lastNight'],
  })
  .refine(
    (c) =>
      !isIsoDate(c.firstNight) ||
      !isIsoDate(c.lastNight) ||
      nightsBetween(c.firstNight, c.lastNight) < CALENDAR_MAX_CHANGE,
    { message: `Change up to ${CALENDAR_MAX_CHANGE} nights at a time`, path: ['lastNight'] },
  )
  .refine(
    (c) =>
      [c.priceMinor, c.minNights, c.closedToArrival, c.closedToDeparture, c.blocked].some(
        (value) => value !== undefined,
      ),
    'Nothing to change',
  );
export type CalendarChange = z.input<typeof CalendarChangeSchema>;

export const CalendarChangeResultSchema = z.object({
  /** Nights whose price or stay rules changed. */
  changedNights: z.number().int(),
  /** Nights newly blocked. */
  blockedNights: z.number().int(),
  /** Nights left as they were because they were already booked or blocked. */
  takenNights: z.number().int(),
  /** Blocked nights opened again. */
  reopenedNights: z.number().int(),
});
export type CalendarChangeResult = z.infer<typeof CalendarChangeResultSchema>;
