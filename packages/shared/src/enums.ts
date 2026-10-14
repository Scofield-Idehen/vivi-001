/**
 * Values shared by the database, the API and the web app.
 * The database enums in packages/db are built from these lists, so they cannot drift.
 */

export const MEMBER_ROLES = ['admin', 'operations', 'guest_comms', 'accounts', 'field'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

/**
 * A V-01 staff member looking at an operator's workspace through support access.
 * Never stored as a membership: it exists only while a time-limited grant is open, and it is read-only.
 */
export const SUPPORT_ROLE = 'v01_support';
export const WORKSPACE_ROLES = [...MEMBER_ROLES, SUPPORT_ROLE] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const ROLE_LABELS: Record<WorkspaceRole, string> = {
  admin: 'Operator admin',
  operations: 'Operations',
  guest_comms: 'Guest comms',
  accounts: 'Accounts',
  field: 'Field team',
  v01_support: 'V-01 support, read-only',
};

/** V-01's own staff, who use the console. Separate from any operator's roles. */
export const PLATFORM_ROLES = ['owner', 'support', 'viewer'] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const PLATFORM_ROLE_LABELS: Record<PlatformRole, string> = {
  owner: 'Owner',
  support: 'Support',
  viewer: 'Viewer',
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
