import { z } from 'zod';
import { isIsoDate } from './dates.ts';
import { MANAGED_BY, MEMBER_ROLES, PRICE_OWNERS } from './enums.ts';

/** API request and response shapes, shared by the API (validation) and the web app (types). */

export const IsoDate = z.string().refine(isIsoDate, 'Expected a date as YYYY-MM-DD');
export const ClockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected a time as HH:MM');
export const Uuid = z.uuid();
export const MemberRoleSchema = z.enum(MEMBER_ROLES);

export const ApiErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const MeSchema = z.object({
  user: z.object({ id: Uuid, email: z.string(), fullName: z.string().nullable() }),
  memberships: z.array(
    z.object({ organisationId: Uuid, organisationName: z.string(), role: MemberRoleSchema }),
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
  role: MemberRoleSchema,
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
  bedrooms: z.number().int().nullable(),
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
    bedrooms: z.number().int().min(0).max(50).optional(),
    maxGuests: z.number().int().min(1).max(50),
    checkInTime: ClockTime.optional(),
    checkOutTime: ClockTime.optional(),
    minPriceMinor: z.number().int().positive().optional(),
    maxPriceMinor: z.number().int().positive().optional(),
  })
  .refine(
    (p) =>
      p.minPriceMinor === undefined || p.maxPriceMinor === undefined || p.minPriceMinor <= p.maxPriceMinor,
    { message: 'Minimum price must not be above maximum price', path: ['minPriceMinor'] },
  );
export type PropertyCreate = z.input<typeof PropertyCreateSchema>;
