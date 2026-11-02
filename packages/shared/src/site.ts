import { z } from 'zod';
import { type NightOwnRules, nightRules, type UsualRules } from './calendar.ts';
import { addDays, eachNight, isIsoDate, nightsBetween } from './dates.ts';
import { CANCELLATION_POLICIES, type CancellationPolicy } from './listing.ts';
import { GUEST_NAME_MAX, isEmail, isPhone } from './reservations.ts';

/**
 * The operator's booking website (2 Nov 2026), in place of Guesty's booking engine
 * (vivistays.guestybookings.com). Guests find a home, see the price for their dates, give their
 * details and pay on Stripe's page. The card is only authorised there; V-01 saves the booking and
 * then takes the money, so nobody pays for nights that went to another booking meanwhile.
 *
 * Only homes whose channels V-01 runs, or that have none, can be on the site: a booking made here
 * closes the nights on every channel at once.
 */

/** How far ahead the nights calendar on a home's page may be read in one go. */
export const SITE_NIGHTS_WINDOW = 62;
/** How many days ahead the "from" price on the list looks. */
export const SITE_FROM_PRICE_DAYS = 60;
/** How long the payment page stays open; Stripe's shortest. */
export const SITE_CHECKOUT_MINUTES = 30;

const Day = z.string().refine(isIsoDate, 'A date like 2026-11-05');

// The stay and its price ----------------------------------------------------------------------

export interface SiteHomeRules {
  usual: UsualRules;
  maxGuests: number;
  maxNights: number | null;
  advanceNoticeHours: number;
  /** The check-in hour (15 for 15:00), for the advance notice. */
  checkInHour: number;
  bookingWindowDays: number | null;
  preparationDays: number;
  cleaningFeeMinor: number | null;
  extraGuestFeeMinor: number | null;
  extraGuestFrom: number | null;
  petsAllowed: boolean;
  childrenAllowed: boolean;
}

export interface SiteParty {
  adults: number;
  children: number;
  infants: number;
  pets: number;
}

export const SITE_REFUSALS = [
  'dates',
  'too_soon',
  'too_far',
  'min_nights',
  'max_nights',
  'closed_arrival',
  'closed_departure',
  'too_many_guests',
  'no_pets',
  'no_children',
  'no_price',
  'taken',
] as const;
export type SiteRefusal = (typeof SITE_REFUSALS)[number];

export interface SiteQuoteLine {
  label: string;
  amountMinor: number;
}

export type SiteQuote =
  | {
      ok: true;
      nights: number;
      /** Each night's price, in order. */
      nightly: { night: string; priceMinor: number }[];
      nightsMinor: number;
      cleaningMinor: number;
      extraGuestsMinor: number;
      serviceMinor: number;
      totalMinor: number;
    }
  | { ok: false; reason: SiteRefusal; message: string; minNights?: number };

const refuse = (reason: SiteRefusal, message: string, minNights?: number): SiteQuote => ({
  ok: false,
  reason,
  message,
  ...(minNights ? { minNights } : {}),
});

/**
 * Whether a stay can be booked and what it costs: each night at its own price (or the usual or
 * weekend one), the cleaning fee, extra guests per night, and the site's service fee on the rest.
 * `taken` are the nights other bookings and blocks hold, as [from, to) ranges.
 */
export function quoteStay(input: {
  rules: SiteHomeRules;
  own: ReadonlyMap<string, NightOwnRules>;
  taken: readonly { from: string; to: string }[];
  checkIn: string;
  checkOut: string;
  party: SiteParty;
  /** Today where the operator is, and the hour now there (0–23). */
  today: string;
  hourNow: number;
  serviceFeeBp: number | null;
}): SiteQuote {
  const { rules, checkIn, checkOut, party } = input;
  const nights = nightsBetween(checkIn, checkOut);
  if (!isIsoDate(checkIn) || !isIsoDate(checkOut) || nights < 1)
    return refuse('dates', 'Choose a check-out after the check-in.');
  // Advance notice: hours from now to the check-in time on the arrival day.
  const hoursAhead = nightsBetween(input.today, checkIn) * 24 + rules.checkInHour - input.hourNow;
  if (checkIn < input.today || hoursAhead < rules.advanceNoticeHours)
    return refuse('too_soon', 'That arrival is too soon to book online. Contact us and we’ll try to help.');
  if (rules.bookingWindowDays && checkIn > addDays(input.today, rules.bookingWindowDays))
    return refuse('too_far', 'Those dates aren’t open for booking yet.');
  const guests = party.adults + party.children;
  if (guests > rules.maxGuests)
    return refuse('too_many_guests', `This home sleeps up to ${rules.maxGuests} guests.`);
  if (party.pets > 0 && !rules.petsAllowed) return refuse('no_pets', 'Pets aren’t allowed at this home.');
  if (party.children + party.infants > 0 && !rules.childrenAllowed)
    return refuse('no_children', 'This home isn’t suitable for children.');

  const arrival = nightRules(rules.usual, checkIn, input.own.get(checkIn));
  if (arrival.closedToArrival) return refuse('closed_arrival', 'Arrivals aren’t possible on that day.');
  const departure = input.own.get(checkOut);
  if (departure?.closedToDeparture)
    return refuse('closed_departure', 'Departures aren’t possible on that day.');
  if (nights < arrival.minNights)
    return refuse(
      'min_nights',
      `Stays arriving that day are at least ${arrival.minNights} nights.`,
      arrival.minNights,
    );
  if (rules.maxNights && nights > rules.maxNights)
    return refuse('max_nights', `Stays here are at most ${rules.maxNights} nights.`);

  // Preparation days keep that many days free either side of other stays.
  const from = addDays(checkIn, -rules.preparationDays);
  const to = addDays(checkOut, rules.preparationDays);
  if (input.taken.some((t) => t.from < to && from < t.to))
    return refuse('taken', 'Those dates aren’t free. Try other dates.');

  const nightly: { night: string; priceMinor: number }[] = [];
  for (const night of eachNight(checkIn, checkOut)) {
    const price = nightRules(rules.usual, night, input.own.get(night)).priceMinor;
    if (!price) return refuse('no_price', 'This home can’t be booked online for those dates. Contact us.');
    nightly.push({ night, priceMinor: price });
  }
  const nightsMinor = nightly.reduce((sum, n) => sum + n.priceMinor, 0);
  const cleaningMinor = rules.cleaningFeeMinor ?? 0;
  const extra =
    rules.extraGuestFeeMinor && rules.extraGuestFrom ? Math.max(0, guests - rules.extraGuestFrom + 1) : 0;
  const extraGuestsMinor = extra * (rules.extraGuestFeeMinor ?? 0) * nights;
  const before = nightsMinor + cleaningMinor + extraGuestsMinor;
  const serviceMinor = input.serviceFeeBp ? Math.round((before * input.serviceFeeBp) / 10_000) : 0;
  return {
    ok: true,
    nights,
    nightly,
    nightsMinor,
    cleaningMinor,
    extraGuestsMinor,
    serviceMinor,
    totalMinor: before + serviceMinor,
  };
}

// API shapes ------------------------------------------------------------------------------------

export const SiteSlugParams = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    .max(60),
});

const PartySchema = z.object({
  adults: z.coerce.number().int().min(1).max(50).default(1),
  children: z.coerce.number().int().min(0).max(50).default(0),
  infants: z.coerce.number().int().min(0).max(20).default(0),
  pets: z.coerce.number().int().min(0).max(10).default(0),
});

/** The search on the list: dates and party are optional; with dates each home says if it's free and the total. */
export const SiteSearchSchema = PartySchema.extend({
  checkIn: Day.optional(),
  checkOut: Day.optional(),
});
export type SiteSearch = z.input<typeof SiteSearchSchema>;

export const SiteBrandSchema = z.object({
  name: z.string(),
  logoUrl: z.string().nullable(),
  accentHex: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
});

export const SiteHomeCardSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  place: z.string().nullable(),
  propertyType: z.string().nullable(),
  maxGuests: z.number().int(),
  bedrooms: z.number().int().nullable(),
  beds: z.number().int().nullable(),
  bathrooms: z.number().nullable(),
  petsAllowed: z.boolean(),
  summary: z.string().nullable(),
  coverUrl: z.string().nullable(),
  /** The lowest night's price in the coming weeks; null when no price is set. */
  fromMinor: z.number().int().nullable(),
  /** With dates: the stay's total when free, or why not. */
  stay: z.object({ totalMinor: z.number().int().nullable(), message: z.string().nullable() }).nullable(),
});
export type SiteHomeCard = z.infer<typeof SiteHomeCardSchema>;

export const SiteSchema = z.object({
  slug: z.string(),
  brand: SiteBrandSchema,
  currency: z.string(),
  terms: z.string().nullable(),
  /** Test mode: Stripe's test key, no real money. */
  testMode: z.boolean(),
  /** False until Stripe is set up, and in a preview; homes show but can't be paid for. */
  canPay: z.boolean(),
  /** The team's preview: every home shows, nothing can be booked. */
  preview: z.boolean(),
  homes: z.array(SiteHomeCardSchema),
});
export type Site = z.infer<typeof SiteSchema>;

export const SiteHomeSchema = SiteHomeCardSchema.omit({ stay: true }).extend({
  slug: z.string(),
  brand: SiteBrandSchema,
  currency: z.string(),
  terms: z.string().nullable(),
  testMode: z.boolean(),
  canPay: z.boolean(),
  preview: z.boolean(),
  photos: z.array(z.object({ url: z.string(), caption: z.string().nullable() })),
  sections: z.array(z.object({ title: z.string(), text: z.string() })),
  amenities: z.array(z.string()),
  rules: z.array(z.string()),
  checkInTime: z.string(),
  checkOutTime: z.string(),
  minNights: z.number().int(),
  cancellation: z.object({ label: z.string(), description: z.string() }),
  cleaningFeeMinor: z.number().int().nullable(),
  childrenAllowed: z.boolean(),
});
export type SiteHome = z.infer<typeof SiteHomeSchema>;

export const SiteNightsQuerySchema = z.object({ from: Day, to: Day });
export const SiteNightSchema = z.object({
  night: z.string(),
  free: z.boolean(),
  priceMinor: z.number().int().nullable(),
  minNights: z.number().int(),
  closedToArrival: z.boolean(),
  closedToDeparture: z.boolean(),
});
export const SiteNightsSchema = z.object({ today: z.string(), nights: z.array(SiteNightSchema) });
export type SiteNights = z.infer<typeof SiteNightsSchema>;

export const SiteQuoteRequestSchema = PartySchema.extend({
  homeId: z.uuid(),
  checkIn: Day,
  checkOut: Day,
});
export type SiteQuoteRequest = z.infer<typeof SiteQuoteRequestSchema>;

export const SiteQuoteSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    nights: z.number().int(),
    nightly: z.array(z.object({ night: z.string(), priceMinor: z.number().int() })),
    nightsMinor: z.number().int(),
    cleaningMinor: z.number().int(),
    extraGuestsMinor: z.number().int(),
    serviceMinor: z.number().int(),
    totalMinor: z.number().int(),
  }),
  z.object({
    ok: z.literal(false),
    reason: z.enum(SITE_REFUSALS),
    message: z.string(),
    minNights: z.number().int().optional(),
  }),
]);

export const SiteBookRequestSchema = SiteQuoteRequestSchema.extend({
  firstName: z.string().trim().min(1, 'Enter your first name').max(60),
  lastName: z.string().trim().min(1, 'Enter your last name').max(60),
  email: z.string().trim().max(254).refine(isEmail, 'Enter an email address, such as name@example.com'),
  phone: z
    .string()
    .trim()
    .refine((v) => v === '' || isPhone(v), 'Enter a phone number, such as +44 7700 900123')
    .default(''),
  request: z.string().trim().max(1000).default(''),
  acceptTerms: z.literal(true, 'Accept the terms to book'),
});
export type SiteBookRequest = z.infer<typeof SiteBookRequestSchema>;
export const SITE_GUEST_NAME_MAX = GUEST_NAME_MAX;

export const SiteBookLinkSchema = z.object({ bookingId: z.uuid(), url: z.string() });
export type SiteBookLink = z.infer<typeof SiteBookLinkSchema>;

export const SITE_BOOKING_STATUSES = ['open', 'booked', 'refused', 'expired'] as const;
export const SiteBookingSchema = z.object({
  status: z.enum(SITE_BOOKING_STATUSES),
  home: z.string(),
  checkIn: z.string(),
  checkOut: z.string(),
  totalMinor: z.number().int(),
  currency: z.string(),
  email: z.string(),
  /** The guest's own stay page, once booked. */
  stayPath: z.string().nullable(),
  /** While open: back to Stripe's page. */
  url: z.string().nullable(),
});
export type SiteBooking = z.infer<typeof SiteBookingSchema>;

// The team's settings ---------------------------------------------------------------------------

export const BookingSiteSettingsSchema = z.object({
  on: z.boolean(),
  /** Where the site is: `{app}/book/{slug}`. */
  slug: z.string(),
  serviceFeeBp: z.number().int().min(1).max(2000).nullable(),
  terms: z.string().nullable(),
  /** Homes on the site / that could be. */
  homesOn: z.number().int(),
  canPay: z.boolean(),
});
export type BookingSiteSettings = z.infer<typeof BookingSiteSettingsSchema>;

export const BookingSiteUpdateSchema = z.object({
  on: z.boolean().optional(),
  serviceFeeBp: z.number().int().min(1).max(2000).nullable().optional(),
  terms: z.string().trim().max(8000).nullable().optional(),
});
export type BookingSiteUpdate = z.infer<typeof BookingSiteUpdateSchema>;

export const isCancellationPolicy = (v: string): v is CancellationPolicy =>
  (CANCELLATION_POLICIES as readonly string[]).includes(v);
