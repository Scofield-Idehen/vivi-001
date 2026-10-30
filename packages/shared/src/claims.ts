import { z } from 'zod';
import { addDays } from './dates.ts';
import { CHANNELS, type Channel } from './enums.ts';
import { IsoDate, Uuid } from './schemas.ts';

/**
 * Claims (design roadmap Phase 2, built 30 Oct 2026): one per booking, for damage a guest left.
 * V-01 keeps the case together (what was damaged and what it costs, the photos from the team's
 * jobs before and after the stay, receipts and invoices kept as uploaded) and counts down to the
 * deadline. It is filed by a person, on the channel or with the guest; nothing is sent from here.
 *
 * Deadlines: Airbnb wants a request within 14 days, and before the next guest checks in, whichever
 * comes first; Booking.com within 14 days of check-out. Others default to 14 days too. The team
 * can move the date when their own terms differ.
 */

export const CLAIM_STATUSES = ['open', 'filed', 'paid', 'closed'] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const CLAIM_STATUS_LABELS: Record<ClaimStatus, string> = {
  open: 'Getting ready',
  filed: 'Filed',
  paid: 'Paid',
  closed: 'Closed',
};

/** Where the claim goes: the channel's own process, the guest directly, or an insurer. */
export const CLAIM_PLACES = ['airbnb', 'booking_com', 'vrbo', 'expedia', 'guest', 'insurer'] as const;
export type ClaimPlace = (typeof CLAIM_PLACES)[number];

export const CLAIM_PLACE_LABELS: Record<ClaimPlace, string> = {
  airbnb: 'Airbnb',
  booking_com: 'Booking.com',
  vrbo: 'Vrbo',
  expedia: 'Expedia',
  guest: 'The guest directly',
  insurer: 'An insurer',
};

export const CLAIM_DAYS = 14;

/** Where a claim for a booking from this channel is filed, unless the team says otherwise. */
export function claimPlaceFor(channel: Channel): ClaimPlace {
  return channel === 'direct' ? 'guest' : channel;
}

/**
 * The last day to file: 14 days after check-out; for Airbnb, the day before the next guest
 * checks in at the same home when that comes first.
 */
export function claimDeadline(channel: Channel, checkOut: string, nextCheckIn: string | null): string {
  const base = addDays(checkOut, CLAIM_DAYS);
  if (channel === 'airbnb' && nextCheckIn && nextCheckIn > checkOut) {
    const before = addDays(nextCheckIn, -1);
    if (before < base) return before < checkOut ? checkOut : before;
  }
  return base;
}

export const CLAIM_FILE_KINDS = ['photo', 'receipt', 'other'] as const;
export type ClaimFileKind = (typeof CLAIM_FILE_KINDS)[number];

export const CLAIM_FILE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf',
  'video/mp4',
  'video/quicktime',
] as const;
/** Originals are kept as uploaded, so the limit is generous: a phone video of the damage fits. */
export const CLAIM_FILE_MAX_BYTES = 100 * 1024 * 1024;
export const CLAIM_FILE_MAX = 40;

export const ClaimItemSchema = z.object({
  id: Uuid,
  description: z.string(),
  amountMinor: z.number().int(),
});
export type ClaimItem = z.infer<typeof ClaimItemSchema>;

export const ClaimItemInputSchema = z.object({
  description: z.string().trim().min(1).max(300),
  amountMinor: z.number().int().min(0).max(100_000_000),
});
export type ClaimItemInput = z.infer<typeof ClaimItemInputSchema>;

export const ClaimFileSchema = z.object({
  id: Uuid,
  kind: z.enum(CLAIM_FILE_KINDS),
  fileName: z.string(),
  contentType: z.string(),
  bytes: z.number().int(),
  /** A signed address that works for a while. */
  url: z.string(),
  uploadedBy: z.string().nullable(),
  createdAt: z.string(),
});
export type ClaimFile = z.infer<typeof ClaimFileSchema>;

/** A photo from one of the team's jobs at the home, around the stay. */
export const ClaimEvidencePhotoSchema = z.object({
  id: Uuid,
  url: z.string(),
  stage: z.enum(['before', 'after', 'found']),
  stamp: z.string().nullable(),
  takenAt: z.string(),
  takenBy: z.string().nullable(),
  taskId: Uuid,
  taskTitle: z.string(),
  taskDay: IsoDate,
});
export type ClaimEvidencePhoto = z.infer<typeof ClaimEvidencePhotoSchema>;

/** A damage report from the team, with what they wrote. */
export const ClaimReportSchema = z.object({
  taskId: Uuid,
  day: IsoDate,
  what: z.string().nullable(),
  by: z.string().nullable(),
});

export const ClaimSummarySchema = z.object({
  id: Uuid,
  reservationId: Uuid,
  propertyId: Uuid,
  propertyName: z.string(),
  guestName: z.string().nullable(),
  channel: z.enum(CHANNELS),
  channelReference: z.string().nullable(),
  checkIn: IsoDate,
  checkOut: IsoDate,
  status: z.enum(CLAIM_STATUSES),
  place: z.enum(CLAIM_PLACES),
  deadline: IsoDate,
  currency: z.string(),
  claimedMinor: z.number().int(),
  receivedMinor: z.number().int().nullable(),
  createdAt: z.string(),
});
export type ClaimSummary = z.infer<typeof ClaimSummarySchema>;

export const ClaimSchema = ClaimSummarySchema.extend({
  summary: z.string().nullable(),
  filedOn: IsoDate.nullable(),
  filedReference: z.string().nullable(),
  outcome: z.string().nullable(),
  items: z.array(ClaimItemSchema),
  files: z.array(ClaimFileSchema),
  /** The last clean before the guest arrived: the home as it was. */
  before: z.array(ClaimEvidencePhotoSchema),
  /** The clean after they left and anything found since: the home as they left it. */
  after: z.array(ClaimEvidencePhotoSchema),
  reports: z.array(ClaimReportSchema),
  /** The next guest's check-in at the home, which closes Airbnb's window. */
  nextCheckIn: IsoDate.nullable(),
  createdBy: z.string().nullable(),
});
export type Claim = z.infer<typeof ClaimSchema>;

export const CLAIM_VIEWS = ['active', 'done'] as const;
export type ClaimView = (typeof CLAIM_VIEWS)[number];

export const ClaimListQuerySchema = z.object({ view: z.enum(CLAIM_VIEWS).default('active') });

/** A booking where the team reported damage and there is no claim yet. */
export const ClaimSuggestionSchema = z.object({
  reservationId: Uuid,
  propertyName: z.string(),
  guestName: z.string().nullable(),
  channel: z.enum(CHANNELS),
  checkOut: IsoDate,
  deadline: IsoDate,
  reports: z.number().int(),
});
export type ClaimSuggestion = z.infer<typeof ClaimSuggestionSchema>;

export const ClaimListSchema = z.object({
  today: IsoDate,
  claims: z.array(ClaimSummarySchema),
  suggestions: z.array(ClaimSuggestionSchema),
  counts: z.object({ active: z.number().int(), done: z.number().int() }),
});
export type ClaimList = z.infer<typeof ClaimListSchema>;

export const ClaimCreateSchema = z.object({ reservationId: Uuid });

export const ClaimUpdateSchema = z
  .object({
    status: z.enum(CLAIM_STATUSES),
    place: z.enum(CLAIM_PLACES),
    deadline: IsoDate,
    summary: z.string().trim().max(4000).nullable(),
    filedOn: IsoDate.nullable(),
    filedReference: z.string().trim().max(120).nullable(),
    receivedMinor: z.number().int().min(0).max(100_000_000).nullable(),
    outcome: z.string().trim().max(2000).nullable(),
  })
  .partial()
  .refine((u) => Object.keys(u).length > 0, 'Nothing to change');
export type ClaimUpdate = z.input<typeof ClaimUpdateSchema>;

export const ClaimFileUploadRequestSchema = z.object({
  contentType: z.enum(CLAIM_FILE_TYPES),
  bytes: z.number().int().positive().max(CLAIM_FILE_MAX_BYTES),
});

export const ClaimFileRegisterSchema = z.object({
  path: z.string().min(1).max(300),
  kind: z.enum(CLAIM_FILE_KINDS),
  fileName: z.string().trim().min(1).max(200),
  contentType: z.enum(CLAIM_FILE_TYPES),
  bytes: z.number().int().positive().max(CLAIM_FILE_MAX_BYTES),
});
export type ClaimFileRegister = z.infer<typeof ClaimFileRegisterSchema>;
