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
/**
 * A listing link's life: `linking` while the worker maps it in Channex, `live` once it takes
 * bookings through V-01, `closing` while the worker unmaps it, `archived` after.
 */
export const LISTING_STATUSES = ['linking', 'live', 'closing', 'archived'] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

export const CHANNEL_ACCOUNT_STATUSES = ['pending', 'connected', 'error', 'disconnected'] as const;
export type ChannelAccountStatus = (typeof CHANNEL_ACCOUNT_STATUSES)[number];

/**
 * Who runs a property's channel listings during the move from Guesty.
 * `guesty`: came across from Guesty, which still runs its listings.
 * `none`: added in V-01, with no listings connected yet.
 * `v01`: moved over; V-01 runs its listings.
 * Only `v01` properties send anything to Channex (playbook, Section 19), so a listing never has two
 * managers. The database refuses `v01` from the API and worker: only the move-over step may set it.
 */
export const MANAGED_BY = ['guesty', 'v01', 'none'] as const;
export type ManagedBy = (typeof MANAGED_BY)[number];

export const MANAGED_BY_LABELS: Record<ManagedBy, string> = {
  guesty: 'Still on Guesty',
  v01: 'Moved here',
  none: 'Not connected yet',
};

/** What kind of place a property is. Stored as text, so the list can grow without a migration. */
export const PROPERTY_TYPES = [
  'house',
  'flat',
  'cottage',
  'cabin',
  'studio',
  'serviced_apartment',
  'unusual',
  'other',
] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

export const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  house: 'House',
  flat: 'Flat',
  cottage: 'Cottage',
  cabin: 'Cabin or lodge',
  studio: 'Studio',
  serviced_apartment: 'Serviced apartment',
  unusual: 'Something unusual',
  other: 'Other',
};

/** What guests get: the channels ask for this on every listing. */
export const SPACE_TYPES = ['entire_place', 'private_room', 'shared_room'] as const;
export type SpaceType = (typeof SPACE_TYPES)[number];

export const SPACE_TYPE_LABELS: Record<SpaceType, string> = {
  entire_place: 'The whole place',
  private_room: 'A private room',
  shared_room: 'A shared room',
};

/** Who owns the price for a property: our own rules, or PriceLabs (playbook, Section 15). */
/** A property's housekeeping state: dirty from a guest's check-out until someone marks it clean. */
export const CLEANING_STATUSES = ['clean', 'dirty'] as const;
export type CleaningStatus = (typeof CLEANING_STATUSES)[number];

export const CLEANING_STATUS_LABELS: Record<CleaningStatus, string> = {
  clean: 'Clean',
  dirty: 'Dirty',
};

export const PRICE_OWNERS = ['v01', 'pricelabs'] as const;
export type PriceOwner = (typeof PRICE_OWNERS)[number];

export const OUTBOX_KINDS = ['availability', 'restrictions'] as const;
export type OutboxKind = (typeof OUTBOX_KINDS)[number];

export const OUTBOX_STATUSES = ['pending', 'sending', 'sent', 'failed'] as const;
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

/**
 * A property's connection to the channel manager: asked for, being made (the worker is on it),
 * made, or given up on after repeated failures (a person must look).
 */
export const CHANNEX_SETUP_STATUSES = ['queued', 'working', 'done', 'failed'] as const;
export type ChannexSetupStatus = (typeof CHANNEX_SETUP_STATUSES)[number];
