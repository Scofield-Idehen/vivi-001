import { z } from 'zod';
import { isIsoDate } from './dates.ts';
import {
  MANAGED_BY,
  MEMBER_ROLES,
  PLATFORM_ROLES,
  PRICE_OWNERS,
  PROPERTY_TYPES,
  SPACE_TYPES,
  WORKSPACE_ROLES,
} from './enums.ts';

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
  createdAt: z.string(),
});
export type Property = z.infer<typeof PropertySchema>;

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
  })
  .refine(
    (p) =>
      p.minPriceMinor === undefined || p.maxPriceMinor === undefined || p.minPriceMinor <= p.maxPriceMinor,
    { message: 'Minimum price must not be above maximum price', path: ['minPriceMinor'] },
  );
export type PropertyCreate = z.input<typeof PropertyCreateSchema>;

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
