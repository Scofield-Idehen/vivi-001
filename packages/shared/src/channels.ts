import { z } from 'zod';
import { CHANNEL_ACCOUNT_STATUSES, CHANNELS, LISTING_STATUSES } from './enums.ts';

/**
 * Channel accounts and listing links: how a property reaches Airbnb, Booking.com and Vrbo. An
 * account (Airbnb A, Booking.com B, Vrbo) is connected to Channex once; each property's listing on
 * that account is then linked to the property's Channex rate plan, and from then on prices,
 * availability and bookings flow through V-01. Guesty's List on channels page is the measure.
 */

const Uuid = z.uuid();
const Timestamp = z.string();

/** The channels V-01 can link today. Expedia and the rest come later, through Channex. */
export const LINKABLE_CHANNELS = ['airbnb', 'booking_com', 'vrbo'] as const;
export type LinkableChannel = (typeof LINKABLE_CHANNELS)[number];

export const ChannelConnectionSchema = z.object({
  /** Channex's id for the connection, once the worker has made it. */
  channexChannelId: z.string().nullable(),
  /** Airbnb and Vrbo: the account's owner opens this to authorise Channex. */
  connectUrl: z.string().nullable(),
  active: z.boolean(),
  externalAccountId: z.string().nullable(),
  lastCheckedAt: Timestamp.nullable(),
  lastError: z.string().nullable(),
});
export type ChannelConnection = z.infer<typeof ChannelConnectionSchema>;

export const ChannelAccountSchema = z.object({
  id: Uuid,
  channel: z.enum(CHANNELS),
  label: z.string(),
  status: z.enum(CHANNEL_ACCOUNT_STATUSES),
  /** Who signs in and who holds the second factor, for the team's own record. */
  loginHolder: z.string().nullable(),
  twoFactorHolder: z.string().nullable(),
  connection: ChannelConnectionSchema.nullable(),
  /** Listings Channex sees on the account, and how many of them are linked to a property. */
  listingsSeen: z.number().int(),
  listingsLinked: z.number().int(),
  createdAt: Timestamp,
});
export type ChannelAccount = z.infer<typeof ChannelAccountSchema>;

export const ChannelAccountListSchema = z.object({ accounts: z.array(ChannelAccountSchema) });
export type ChannelAccountList = z.infer<typeof ChannelAccountListSchema>;

export const ChannelAccountCreateSchema = z.object({
  channel: z.enum(LINKABLE_CHANNELS),
  label: z.string().trim().min(1).max(60),
  loginHolder: z.string().trim().max(120).optional(),
  twoFactorHolder: z.string().trim().max(120).optional(),
});
export type ChannelAccountCreate = z.infer<typeof ChannelAccountCreateSchema>;

/** What the account needs before Channex can connect it. Booking.com wants its hotel id. */
export const ChannelAccountConnectSchema = z.object({
  hotelId: z.string().trim().min(1).max(40).optional(),
});
export type ChannelAccountConnect = z.infer<typeof ChannelAccountConnectSchema>;

/** A listing Channex sees on an account, with the property it is linked to, if any. */
export const AccountListingSchema = z.object({
  externalListingId: z.string(),
  title: z.string().nullable(),
  url: z.string().nullable(),
  linkedPropertyId: Uuid.nullable(),
  linkedPropertyName: z.string().nullable(),
  seenAt: Timestamp,
});
export type AccountListing = z.infer<typeof AccountListingSchema>;

export const AccountListingListSchema = z.object({ listings: z.array(AccountListingSchema) });
export type AccountListingList = z.infer<typeof AccountListingListSchema>;

/** One property's link on one channel: the card on its page. */
export const PropertyLinkSchema = z.object({
  id: Uuid,
  channel: z.enum(CHANNELS),
  channelAccountId: Uuid,
  account: z.string(),
  externalListingId: z.string(),
  title: z.string().nullable(),
  url: z.string().nullable(),
  status: z.enum(LISTING_STATUSES),
  liveFrom: z.string().nullable(),
  lastError: z.string().nullable(),
  requestedBy: z.string().nullable(),
});
export type PropertyLink = z.infer<typeof PropertyLinkSchema>;

export const PropertyLinkListSchema = z.object({ links: z.array(PropertyLinkSchema) });
export type PropertyLinkList = z.infer<typeof PropertyLinkListSchema>;

export const PropertyLinkCreateSchema = z.object({
  channelAccountId: Uuid,
  externalListingId: z.string().trim().min(1).max(80),
});
export type PropertyLinkCreate = z.infer<typeof PropertyLinkCreateSchema>;

/** Where a listing lives on the channel's site, when the id alone says so. */
export function listingUrl(channel: string, externalListingId: string): string | null {
  if (channel === 'airbnb' && /^\d+$/.test(externalListingId))
    return `https://www.airbnb.com/rooms/${externalListingId}`;
  if (channel === 'vrbo' && /^\d+$/.test(externalListingId))
    return `https://www.vrbo.com/${externalListingId}`;
  return null;
}

/** The workspace's own sync picture: what is waiting to go out, and what came in. */
export const WorkspaceSyncSchema = z.object({
  outboxWaiting: z.number().int(),
  outboxFailed: z.number().int(),
  oldestWaitingAt: Timestamp.nullable(),
  lastSentAt: Timestamp.nullable(),
  lastBookingAt: Timestamp.nullable(),
  recent: z.array(
    z.object({
      id: z.number().int(),
      at: Timestamp,
      propertyName: z.string().nullable(),
      direction: z.string(),
      kind: z.string(),
      status: z.string(),
      message: z.string().nullable(),
    }),
  ),
});
export type WorkspaceSync = z.infer<typeof WorkspaceSyncSchema>;
