import { z } from 'zod';
import { CHECK_IN_METHODS } from './listing.ts';

/**
 * The guest's page for their stay (design roadmap, "Guests: get check-in details"). Opened from a
 * private link, no sign-in: the home, the dates and times, how to get in, the Wi-Fi, the rules and
 * who to call. Lock codes and the Wi-Fi password appear only from the day of arrival until the
 * guest leaves, so a link passed around never hands out codes for months.
 */

export const GuestFieldSchema = z.object({
  name: z.string(),
  kind: z.enum(['text', 'long_text', 'link', 'secret']),
  /** Null for a secret outside the stay's window; `available` says when it appears. */
  value: z.string().nullable(),
});
export type GuestField = z.infer<typeof GuestFieldSchema>;

export const GuestStaySchema = z.object({
  guestName: z.string().nullable(),
  checkIn: z.string(),
  checkOut: z.string(),
  checkInTime: z.string(),
  checkOutTime: z.string(),
  nights: z.number().int(),
  guests: z.number().int(),
  timeZone: z.string(),
  /** Where the stay stands today, where the operator is: before, during or after. */
  phase: z.enum(['before', 'during', 'after']),
  /** When codes appear: the arrival day, as an ISO date; null once they are showing or the stay is over. */
  codesFrom: z.string().nullable(),
  property: z.object({
    name: z.string(),
    title: z.string().nullable(),
    summary: z.string().nullable(),
    addressLine1: z.string().nullable(),
    addressLine2: z.string().nullable(),
    city: z.string().nullable(),
    postcode: z.string().nullable(),
    countryCode: z.string(),
    gettingAround: z.string().nullable(),
    guestAccess: z.string().nullable(),
    checkInMethod: z.enum(CHECK_IN_METHODS).nullable(),
    houseRules: z.string().nullable(),
    petsAllowed: z.boolean(),
    smokingAllowed: z.boolean(),
    eventsAllowed: z.boolean(),
    childrenAllowed: z.boolean(),
    quietHoursStart: z.string().nullable(),
    quietHoursEnd: z.string().nullable(),
    maxGuests: z.number().int(),
    photoUrl: z.string().nullable(),
  }),
  brand: z.object({
    displayName: z.string(),
    logoLightUrl: z.string().nullable(),
    accentHex: z.string().nullable(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
  }),
  fields: z.array(GuestFieldSchema),
});
export type GuestStay = z.infer<typeof GuestStaySchema>;

/** What the booking page shows the team: the link, and what the guest sees right now. */
export const GuestLinkSchema = z.object({
  key: z.string(),
  /** The path in the app the key opens: /stay/{key}. The app prefixes its own address. */
  path: z.string(),
});
export type GuestLink = z.infer<typeof GuestLinkSchema>;
