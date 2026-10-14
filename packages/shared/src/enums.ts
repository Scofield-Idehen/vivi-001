/**
 * Values shared by the database, the API and the web app.
 * The database enums in packages/db are built from these lists, so they cannot drift.
 */

export const MEMBER_ROLES = ['admin', 'operations', 'guest_comms', 'accounts', 'field'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const ROLE_LABELS: Record<MemberRole, string> = {
  admin: 'Operator admin',
  operations: 'Operations',
  guest_comms: 'Guest comms',
  accounts: 'Accounts',
  field: 'Field team',
};

export const CHANNELS = ['airbnb', 'booking_com', 'vrbo', 'expedia', 'direct'] as const;
export type Channel = (typeof CHANNELS)[number];

export const CHANNEL_LABELS: Record<Channel, string> = {
  airbnb: 'Airbnb',
  booking_com: 'Booking.com',
  vrbo: 'Vrbo',
  expedia: 'Expedia',
  direct: 'Direct',
};

/** Only `confirmed` holds nights on the calendar. `conflict` is a real booking that overlapped and needs a person. */
export const RESERVATION_STATUSES = ['inquiry', 'request', 'confirmed', 'cancelled', 'conflict'] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

/** `live` takes new bookings; `closing` honours existing stays during an account move; `archived` is history. */
export const LISTING_STATUSES = ['live', 'closing', 'archived'] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

export const CHANNEL_ACCOUNT_STATUSES = ['pending', 'connected', 'error', 'disconnected'] as const;
export type ChannelAccountStatus = (typeof CHANNEL_ACCOUNT_STATUSES)[number];

/** During migration only `v01` properties send anything to Channex (playbook, Section 19). */
export const MANAGED_BY = ['guesty', 'v01'] as const;
export type ManagedBy = (typeof MANAGED_BY)[number];

/** Who owns the price for a property: our own rules, or PriceLabs (playbook, Section 15). */
export const PRICE_OWNERS = ['v01', 'pricelabs'] as const;
export type PriceOwner = (typeof PRICE_OWNERS)[number];

export const OUTBOX_KINDS = ['availability', 'restrictions'] as const;
export type OutboxKind = (typeof OUTBOX_KINDS)[number];

export const OUTBOX_STATUSES = ['pending', 'sending', 'sent', 'failed'] as const;
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];
