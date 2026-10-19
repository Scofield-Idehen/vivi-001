import { z } from 'zod';
import { PropertyLinkSchema } from './channels.ts';
import { CHANNEX_STATES, ChannexStateSchema } from './channex.ts';
import { isIsoDate } from './dates.ts';
import {
  CHANNELS,
  CLEANING_STATUSES,
  MANAGED_BY,
  MEMBER_ROLES,
  PLATFORM_ROLES,
  PRICE_OWNERS,
  PROPERTY_TYPES,
  SPACE_TYPES,
  WORKSPACE_ROLES,
} from './enums.ts';
import { PropertyFieldSchema } from './fields.ts';
import {
  AmenityCodesSchema,
  CANCELLATION_POLICIES,
  CHECK_IN_METHODS,
  PhotoSchema,
  RoomSchema,
  SECTION_MAX,
  SUMMARY_MAX,
  TITLE_MAX,
} from './listing.ts';

/** API request and response shapes, shared by the API (validation) and the web app (types). */

export const IsoDate = z.string().refine(isIsoDate, 'Expected a date as YYYY-MM-DD');
export const ClockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected a time as HH:MM');
export const Uuid = z.uuid();
export const MemberRoleSchema = z.enum(MEMBER_ROLES);

export const ApiErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const WorkspaceRoleSchema = z.enum(WORKSPACE_ROLES);
export const PlatformRoleSchema = z.enum(PLATFORM_ROLES);

export const MeSchema = z.object({
  user: z.object({ id: Uuid, email: z.string(), fullName: z.string().nullable() }),
  memberships: z.array(
    z.object({ organisationId: Uuid, organisationName: z.string(), role: MemberRoleSchema }),
  ),
  /** The person's role at V-01 itself, if they are V-01 staff. Opens the console. */
  platformRole: PlatformRoleSchema.nullable(),
  /** Operator workspaces this V-01 staff member has open on a support grant right now. */
  supportAccess: z.array(
    z.object({ grantId: Uuid, organisationId: Uuid, organisationName: z.string(), expiresAt: z.string() }),
  ),
});
export type Me = z.infer<typeof MeSchema>;

export const WorkspaceSchema = z.object({
  organisation: z.object({
    id: Uuid,
    name: z.string(),
    legalName: z.string().nullable(),
    slug: z.string(),
  }),
  settings: z.object({
    currency: z.string(),
    timeZone: z.string(),
    locale: z.string(),
    countryCode: z.string(),
  }),
  brand: z.object({
    displayName: z.string(),
    logoLightUrl: z.string().nullable(),
    logoDarkUrl: z.string().nullable(),
    accentHex: z.string().nullable(),
    senderName: z.string().nullable(),
    emailDomain: z.string().nullable(),
  }),
  role: WorkspaceRoleSchema,
});
export type Workspace = z.infer<typeof WorkspaceSchema>;

export const PropertySchema = z.object({
  id: Uuid,
  name: z.string(),
  internalCode: z.string().nullable(),
  addressLine1: z.string().nullable(),
  city: z.string().nullable(),
  postcode: z.string().nullable(),
  countryCode: z.string(),
  area: z.string().nullable(),
  propertyType: z.enum(PROPERTY_TYPES).nullable(),
  spaceType: z.enum(SPACE_TYPES),
  bedrooms: z.number().int().nullable(),
  beds: z.number().int().nullable(),
  bathrooms: z.number().nullable(),
  maxGuests: z.number().int(),
  checkInTime: z.string(),
  checkOutTime: z.string(),
  managedBy: z.enum(MANAGED_BY),
  priceOwner: z.enum(PRICE_OWNERS),
  minPriceMinor: z.number().int().nullable(),
  maxPriceMinor: z.number().int().nullable(),
  /** The first photo, shown on the property list. */
  coverPhotoUrl: z.string().nullable(),
  photoCount: z.number().int(),
  /** Where the property stands with Channex, for the list; the detail carries the whole state. */
  channexStatus: z.enum(CHANNEX_STATES),
  /** The team's own labels, for finding and grouping properties. Guests never see them. */
  tags: z.array(z.string()),
  createdAt: z.string(),
});
export type Property = z.infer<typeof PropertySchema>;

export const TAG_MAX = 40;
export const TAGS_MAX = 30;

/** Tags as typed: trimmed, without repeats (whatever the capitals), in the order given. */
export const TagsSchema = z
  .array(z.string().trim().min(1).max(TAG_MAX))
  .max(TAGS_MAX)
  .transform((tags) => {
    const seen = new Set<string>();
    return tags.filter((tag) => {
      const key = tag.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });

/** Clean or dirty, and who last changed it. Shown on the Calendar and the property's page. */
export const CleaningStateSchema = z.object({
  status: z.enum(CLEANING_STATUSES),
  /** When it last changed: someone marking it, or a guest's check-out. */
  changedAt: z.string().nullable(),
  /** Who marked it, by name or email; null when a check-out made it dirty. */
  changedBy: z.string().nullable(),
});
export type CleaningState = z.infer<typeof CleaningStateSchema>;

/** One of a property's listings on a channel, as linked in Channex. */
export const PropertyListingSchema = z.object({
  channel: z.enum(CHANNELS),
  /** The channel account it sits on: "Airbnb A". */
  account: z.string(),
  externalListingId: z.string(),
});
export type PropertyListing = z.infer<typeof PropertyListingSchema>;

/** Everything about one property: the basics above plus the whole listing. */
export const PropertyDetailSchema = PropertySchema.extend({
  addressLine2: z.string().nullable(),
  // What guests read.
  title: z.string().nullable(),
  summary: z.string().nullable(),
  theSpace: z.string().nullable(),
  guestAccess: z.string().nullable(),
  neighbourhood: z.string().nullable(),
  gettingAround: z.string().nullable(),
  otherNotes: z.string().nullable(),
  // Arriving.
  checkInMethod: z.enum(CHECK_IN_METHODS).nullable(),
  // House rules.
  petsAllowed: z.boolean(),
  smokingAllowed: z.boolean(),
  eventsAllowed: z.boolean(),
  childrenAllowed: z.boolean(),
  quietHoursStart: z.string().nullable(),
  quietHoursEnd: z.string().nullable(),
  houseRules: z.string().nullable(),
  // Booking rules.
  minNights: z.number().int(),
  maxNights: z.number().int().nullable(),
  instantBook: z.boolean(),
  advanceNoticeHours: z.number().int(),
  bookingWindowDays: z.number().int().nullable(),
  preparationDays: z.number().int(),
  cancellationPolicy: z.enum(CANCELLATION_POLICIES),
  // Prices and fees, in minor units of the operator's currency.
  basePriceMinor: z.number().int().nullable(),
  weekendPriceMinor: z.number().int().nullable(),
  cleaningFeeMinor: z.number().int().nullable(),
  extraGuestFeeMinor: z.number().int().nullable(),
  extraGuestFrom: z.number().int().nullable(),
  securityDepositMinor: z.number().int().nullable(),
  // Legal.
  licenceNumber: z.string().nullable(),
  cleaner: z.object({ id: Uuid, name: z.string() }).nullable(),
  rooms: z.array(RoomSchema),
  amenities: z.array(z.string()),
  photos: z.array(PhotoSchema),
  channex: ChannexStateSchema,
  /** Clean or dirty, and who last changed it. */
  cleaning: CleaningStateSchema,
  /** The channel listings linked to this property and taking bookings now. Empty until step 7. */
  listings: z.array(PropertyListingSchema),
  /** The workspace's custom fields with this property's values, in order. */
  fields: z.array(PropertyFieldSchema),
  /** Its listing links on each channel: linking, live or closing. */
  links: z.array(PropertyLinkSchema),
  updatedAt: z.string(),
});
export type PropertyDetail = z.infer<typeof PropertyDetailSchema>;

export const PropertyListSchema = z.object({ properties: z.array(PropertySchema) });
export type PropertyList = z.infer<typeof PropertyListSchema>;

export const PropertyCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    internalCode: z.string().trim().min(1).max(40).optional(),
    addressLine1: z.string().trim().max(200).optional(),
    city: z.string().trim().max(100).optional(),
    postcode: z.string().trim().max(20).optional(),
    countryCode: z
      .string()
      .length(2)
      .transform((v) => v.toUpperCase()),
    area: z.string().trim().max(100).optional(),
    propertyType: z.enum(PROPERTY_TYPES).optional(),
    spaceType: z.enum(SPACE_TYPES).optional(),
    bedrooms: z.number().int().min(0).max(50).optional(),
    beds: z.number().int().min(0).max(100).optional(),
    bathrooms: z
      .number()
      .min(0)
      .max(50)
      .refine((n) => Number.isInteger(n * 2), 'Bathrooms go in halves, like 1 or 1.5')
      .optional(),
    maxGuests: z.number().int().min(1).max(50),
    checkInTime: ClockTime.optional(),
    checkOutTime: ClockTime.optional(),
    priceOwner: z.enum(PRICE_OWNERS).optional(),
    minPriceMinor: z.number().int().positive().optional(),
    maxPriceMinor: z.number().int().positive().optional(),
    basePriceMinor: z.number().int().positive().max(100_000_000).optional(),
    cleaningFeeMinor: z.number().int().positive().max(100_000_000).optional(),
    title: z.string().trim().min(1).max(TITLE_MAX).optional(),
    summary: z.string().trim().min(1).max(SUMMARY_MAX).optional(),
    amenities: AmenityCodesSchema.optional(),
  })
  .refine(
    (p) =>
      p.minPriceMinor === undefined || p.maxPriceMinor === undefined || p.minPriceMinor <= p.maxPriceMinor,
    { message: 'Minimum price must not be above maximum price', path: ['minPriceMinor'] },
  );
export type PropertyCreate = z.input<typeof PropertyCreateSchema>;

const Text = (max: number) => z.string().trim().max(max).nullable().optional();
const Minor = z.number().int().positive().max(100_000_000).nullable().optional();
const Halves = z
  .number()
  .min(0)
  .max(50)
  .refine((n) => Number.isInteger(n * 2), 'Bathrooms go in halves, like 1 or 1.5');

/**
 * A change to any part of a property. Only the fields sent change; null clears a field.
 * Who runs the property's channels is not here: only the move-over step changes that.
 */
export const PropertyUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    internalCode: Text(40),
    addressLine1: Text(200),
    addressLine2: Text(200),
    city: Text(100),
    postcode: Text(20),
    countryCode: z
      .string()
      .length(2)
      .transform((v) => v.toUpperCase())
      .optional(),
    area: Text(100),
    propertyType: z.enum(PROPERTY_TYPES).nullable().optional(),
    spaceType: z.enum(SPACE_TYPES).optional(),
    maxGuests: z.number().int().min(1).max(50).optional(),
    bedrooms: z.number().int().min(0).max(50).nullable().optional(),
    beds: z.number().int().min(0).max(100).nullable().optional(),
    bathrooms: Halves.nullable().optional(),
    checkInTime: ClockTime.optional(),
    checkOutTime: ClockTime.optional(),
    priceOwner: z.enum(PRICE_OWNERS).optional(),
    minPriceMinor: Minor,
    maxPriceMinor: Minor,
    title: Text(TITLE_MAX),
    summary: Text(SUMMARY_MAX),
    theSpace: Text(SECTION_MAX),
    guestAccess: Text(SECTION_MAX),
    neighbourhood: Text(SECTION_MAX),
    gettingAround: Text(SECTION_MAX),
    otherNotes: Text(SECTION_MAX),
    checkInMethod: z.enum(CHECK_IN_METHODS).nullable().optional(),
    petsAllowed: z.boolean().optional(),
    smokingAllowed: z.boolean().optional(),
    eventsAllowed: z.boolean().optional(),
    childrenAllowed: z.boolean().optional(),
    quietHoursStart: ClockTime.nullable().optional(),
    quietHoursEnd: ClockTime.nullable().optional(),
    houseRules: Text(SECTION_MAX),
    minNights: z.number().int().min(1).max(365).optional(),
    maxNights: z.number().int().min(1).max(1125).nullable().optional(),
    instantBook: z.boolean().optional(),
    advanceNoticeHours: z.number().int().min(0).max(168).optional(),
    bookingWindowDays: z.number().int().min(1).max(730).nullable().optional(),
    preparationDays: z.number().int().min(0).max(7).optional(),
    cancellationPolicy: z.enum(CANCELLATION_POLICIES).optional(),
    basePriceMinor: Minor,
    weekendPriceMinor: Minor,
    cleaningFeeMinor: Minor,
    extraGuestFeeMinor: Minor,
    extraGuestFrom: z.number().int().min(1).max(50).nullable().optional(),
    securityDepositMinor: Minor,
    licenceNumber: Text(80),
    tags: TagsSchema.optional(),
    /** Who usually cleans it; the check-out clean is assigned to them. Null: nobody yet. */
    cleanerUserId: z.uuid().nullable().optional(),
  })
  .refine((p) => Object.keys(p).length > 0, 'Nothing to change')
  .refine((p) => !p.minPriceMinor || !p.maxPriceMinor || p.minPriceMinor <= p.maxPriceMinor, {
    message: 'The lowest price is above the highest',
    path: ['minPriceMinor'],
  })
  .refine((p) => !p.minNights || !p.maxNights || p.minNights <= p.maxNights, {
    message: 'The shortest stay is longer than the longest',
    path: ['minNights'],
  })
  .refine(
    (p) =>
      p.quietHoursStart === undefined ||
      p.quietHoursEnd === undefined ||
      (p.quietHoursStart === null) === (p.quietHoursEnd === null),
    { message: 'Give quiet hours a start and an end', path: ['quietHoursStart'] },
  );
export type PropertyUpdate = z.input<typeof PropertyUpdateSchema>;

const LEADING_WORDS = new Set(['the', 'a', 'an']);

/**
 * A short reference for a property from its name: "Harbour View Lodge" becomes "HVL",
 * "The Granary" becomes "GRA". Adds a number when the code is already taken.
 */
export function suggestPropertyCode(name: string, taken: Iterable<string> = []): string {
  const words = name
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const first = words[0]?.toLowerCase() ?? '';
  const meaningful = words.length > 1 && LEADING_WORDS.has(first) ? words.slice(1) : words;
  if (meaningful.length === 0) return '';
  const base = (
    meaningful.length === 1
      ? (meaningful[0] ?? '').slice(0, 3)
      : meaningful
          .slice(0, 4)
          .map((w) => (/^\d+$/.test(w) ? w : w[0]))
          .join('')
  ).toUpperCase();
  const used = new Set([...taken].map((c) => c.toUpperCase()));
  if (!used.has(base)) return base;
  for (let n = 2; n < 100; n++) {
    if (!used.has(`${base}${n}`)) return `${base}${n}`;
  }
  return base;
}
