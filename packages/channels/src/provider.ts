/**
 * The swap layer (playbook, Fear 14). All channel code sits behind this interface,
 * so moving from Channex to another channel manager means writing one new adapter,
 * not touching the rest of the system. Nothing outside packages/channels imports Channex code.
 */

/** Identifies a property at the channel manager. For Channex: property, room type and rate plan ids. */
export interface ExternalPropertyRef {
  externalPropertyId: string;
  externalRoomTypeId: string;
  externalRatePlanId: string;
}

/** A date range is inclusive at both ends, as channel managers expect: [dateFrom, dateTo]. */
export interface AvailabilityUpdate {
  ref: ExternalPropertyRef;
  dateFrom: string;
  dateTo: string;
  /** Units available. A single holiday home is 1 (open) or 0 (closed). */
  available: number;
}

export interface RestrictionUpdate {
  ref: ExternalPropertyRef;
  dateFrom: string;
  dateTo: string;
  /** Nightly price in minor units of the property's currency. */
  rateMinor?: number;
  /** The shortest stay for guests arriving on these dates. */
  minStayArrival?: number;
  /** The longest stay; null means no limit. */
  maxStay?: number | null;
  closedToArrival?: boolean;
  closedToDeparture?: boolean;
  stopSell?: boolean;
}

/** What the channel manager needs to hold one holiday home's prices, availability and bookings. */
export interface ListingSetup {
  /** The name the team knows it by. Guests see each channel's own listing, never this. */
  title: string;
  currency: string;
  countryCode: string;
  timeZone: string;
  /** The most guests it sleeps. */
  maxGuests: number;
  city?: string | null;
  address?: string | null;
  postcode?: string | null;
  /** The operator's group at the channel manager, so its properties sit apart from every other operator's. */
  groupId?: string | null;
}

export interface PushResult {
  /** The provider's task id, stored in the sync log so any change can be traced. */
  taskId: string | null;
  /** Items the provider accepted the call for but rejected individually. Never ignore these. */
  warnings: string[];
}

export type RevisionStatus = 'new' | 'modified' | 'cancelled';

/** Where a booking came from, as V-01 names channels. Any other source comes in as direct. */
export type BookingChannel = 'airbnb' | 'booking_com' | 'vrbo' | 'expedia' | 'direct';

export interface BookingRevision {
  id: string;
  bookingId: string;
  externalPropertyId: string;
  status: RevisionStatus;
  /** The stay: arrival and departure dates, [arrival, departure). */
  arrivalDate: string;
  departureDate: string;
  /** The channel's name as the channel manager sent it, kept for the record. */
  otaName: string | null;
  otaReservationCode: string | null;
  channel: BookingChannel;
  guestName: string | null;
  guestEmail: string | null;
  guestPhone: string | null;
  adults: number;
  children: number;
  infants: number;
  /** The booking's total as a decimal string, such as "450.00", in `currency`. */
  amount: string | null;
  currency: string | null;
  /** When the channel manager made this revision, so revisions of one booking apply in order. */
  insertedAt: string | null;
  /** The full payload exactly as received, stored before processing so it can be replayed. */
  raw: unknown;
}

export interface ChannelProvider {
  readonly name: string;
  pushAvailability(updates: AvailabilityUpdate[]): Promise<PushResult>;
  pushRestrictions(updates: RestrictionUpdate[]): Promise<PushResult>;
  /** Unacknowledged booking revisions, oldest first. */
  fetchBookingRevisionFeed(options?: {
    externalPropertyId?: string;
    page?: number;
  }): Promise<BookingRevision[]>;
  /** Only call this after the revision is saved in our database (playbook rule 3). */
  acknowledgeBookingRevision(revisionId: string): Promise<void>;
  /** Reads a stored payload back into a revision, so a stored booking can be imported, or replayed. */
  parseRevision(raw: unknown): BookingRevision;
  /**
   * Creates the property at the channel manager: the property, one unit (a whole home is booked once
   * a night) and one rate plan. The channels' existing listings are then linked to it in the channel
   * manager, so they keep their reviews. Leaves nothing half made: if a part is refused, what was
   * created is removed again before the error is thrown.
   */
  createListing(setup: ListingSetup): Promise<ExternalPropertyRef>;
  /** Makes a group to hold one operator's properties, and returns its id. */
  createGroup(title: string): Promise<string>;
}

export type ChannelErrorKind = 'rate_limited' | 'server' | 'auth' | 'validation' | 'network';

export class ChannelError extends Error {
  constructor(
    message: string,
    readonly kind: ChannelErrorKind,
    readonly status?: number,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'ChannelError';
  }

  /** Rate limits, server errors and network failures are worth retrying; the rest need a person. */
  get retryable(): boolean {
    return this.kind === 'rate_limited' || this.kind === 'server' || this.kind === 'network';
  }
}
