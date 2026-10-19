import type { Session } from '@supabase/supabase-js';
import {
  AmenitiesUpdateSchema,
  AmenityCodesSchema,
  addDays,
  CALENDAR_DAYS_AHEAD,
  type Calendar,
  type CalendarBlock,
  type CalendarChangeResult,
  CalendarChangeSchema,
  type CalendarNight,
  CalendarQuerySchema,
  type CalendarStay,
  CHANNEL_LABELS,
  type Channel,
  type ChannelAccount,
  ChannelAccountConnectSchema,
  ChannelAccountCreateSchema,
  type ChannexState,
  type CleaningState,
  CleaningUpdateSchema,
  type ConsoleOperator,
  type ConsoleOperatorDetail,
  type ConsoleOperatorList,
  type ConsoleOverview,
  type ConsoleSync,
  type ConsoleSyncRow,
  type CustomField,
  CustomFieldCreateSchema,
  CustomFieldUpdateSchema,
  can,
  countBeds,
  eachNight,
  FIELDS_MAX,
  formatMoney,
  isWebAddress,
  listingUrl,
  type Me,
  type MemberRole,
  nightRules,
  nightsBetween,
  type Permission,
  PHOTO_MAX_COUNT,
  PhotoOrderSchema,
  PhotoUpdateSchema,
  type Property,
  PropertyCreateSchema,
  type PropertyDetail,
  type PropertyField,
  PropertyFieldsUpdateSchema,
  type PropertyLink,
  PropertyLinkCreateSchema,
  type PropertyList,
  PropertySchema,
  type PropertyType,
  PropertyUpdateSchema,
  RESERVATION_LIST_LIMIT,
  type Reservation,
  type ReservationList,
  ReservationListQuerySchema,
  type ReservationStatus,
  type ReservationSummary,
  ReservationUpdateSchema,
  RoomsUpdateSchema,
  SUPPORT_ROLE,
  SupportAccessStartSchema,
  type SupportGrant,
  type SupportGrantList,
  type SupportVisitList,
  selectedNights,
  todayIn,
  type Workspace,
  type WorkspaceRole,
} from '@v01/shared';
import { clearDemoPhotos, deleteDemoPhoto, demoPhotoUrl, putDemoPhoto } from './demo-photos.ts';
import { ApiError } from './errors.ts';
import { SAMPLE_PHOTOS } from './sample-photos.ts';

/**
 * Demo mode's stand-in for the API. It answers the same routes with the same shapes and
 * error messages, using sample data kept in this browser, so the real screens can be tried
 * without a database or sign-in. Vivistays is the real first operator, empty until its
 * Guesty import; Northwind Stays and Brightwater Lets are invented, as are their people,
 * properties and guests. The demo user is a V-01 owner, a Vivistays admin, and an admin of
 * Northwind Stays, so its sample bookings can be tried in the Calendar; Brightwater Lets is
 * reached only through support access.
 */

const DEMO_USER = { id: '0b0c4a9e-1f6d-4c3e-9a8b-7d6e5f4a3b2c', email: 'demo@example.com' };

export const DEMO_SESSION = {
  access_token: 'demo',
  token_type: 'bearer',
  user: { id: DEMO_USER.id, email: DEMO_USER.email },
} as unknown as Session;

interface DemoTeamMember {
  email: string;
  fullName: string | null;
  role: MemberRole;
  status: 'active' | 'invited';
  sinceDaysAgo: number;
  lastSeenMinutesAgo: number | null;
}

/** Sample figures for the console, kept as "minutes ago" so they always look current. */
/** A channel account as the demo keeps it: connected ones carry the listings Channex would see. */
interface DemoAccount {
  id: string;
  channel: Channel;
  label: string;
  status: 'disconnected' | 'pending' | 'connected' | 'error';
  loginHolder: string | null;
  externalAccountId: string | null;
  /** The stand-in worker turns a pending account on a few seconds after it was asked. */
  requestedAt: string | null;
  connectUrl: string | null;
  listings: { externalListingId: string; title: string }[];
}

interface DemoLink {
  id: string;
  propertyId: string;
  accountId: string;
  externalListingId: string;
  status: 'linking' | 'live' | 'closing' | 'archived';
  liveFrom: string | null;
  requestedAt: string;
  /** Airbnb only: paused by the team; the stand-in worker confirms a few seconds later. */
  publishedWanted?: boolean;
  published?: boolean;
  pausedAt?: string;
}

interface DemoLive {
  outboxWaiting: number;
  outboxFailed: number;
  oldestWaitingMinutes: number | null;
  lastSentMinutes: number | null;
  webhooksWaiting: number;
  webhooksFailed: number;
  lastWebhookMinutes: number | null;
  arrivalsToday: number;
  departuresToday: number;
  bookingsLast7Days: number;
  lastActivityMinutes: number | null;
}

interface DemoOperator {
  workspace: Omit<Workspace, 'role'>;
  /** The demo user's own role here; null where they can only get in with support access. */
  role: MemberRole | null;
  /** Full listings. Photo addresses are "demo-photo:{id}", resolved from this browser's storage. */
  properties: PropertyDetail[];
  createdAt: string;
  team: DemoTeamMember[];
  channelAccounts: DemoAccount[];
  /** Listing links, as the API keeps them; archived ones stay for the history. */
  links: DemoLink[];
  live: DemoLive;
  calendar: DemoCalendar;
  /** Each property's cleaning, by property id. Missing: clean, never marked. */
  cleaning?: Record<string, CleaningState>;
  /** The workspace's custom fields, in order. */
  fields: CustomField[];
  /** Values by property id, then field id. Secrets sit here as typed: the demo has no database. */
  fieldValues: Record<string, Record<string, string>>;
}

/** A booking as the API keeps it: what the calendar shows, and what the reservation page adds. */
interface DemoStay extends Omit<CalendarStay, 'status'> {
  status: ReservationStatus;
  adults: number;
  children: number;
  infants: number;
  guestEmail: string | null;
  guestPhone: string | null;
  currency: string;
  totalMinor: number | null;
  payoutMinor: number | null;
  checkInTime: string | null;
  checkOutTime: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
}

/** The operator's nights with their own rules, bookings and blocks, as the API keeps them. */
interface DemoCalendar {
  nights: CalendarNight[];
  stays: DemoStay[];
  blocks: CalendarBlock[];
}

interface DemoGrant {
  id: string;
  organisationId: string;
  staffEmail: string;
  reason: string;
  startedAt: string;
  expiresAt: string;
  endedAt: string | null;
  requests: number;
}

interface DemoSyncError {
  source: 'outbox' | 'webhook';
  organisationId: string | null;
  minutesAgo: number;
  attempts: number;
  message: string;
}

interface DemoState {
  /** Raised whenever the shape changes, so a browser holding older sample data starts fresh. */
  version: 10;
  /** The day the sample bookings were laid out from. They are laid out afresh each week. */
  calendarFrom: string;
  operators: DemoOperator[];
  grants: DemoGrant[];
  unmatchedWebhooks: { waiting: number; failed: number; lastMinutes: number | null };
  errors: DemoSyncError[];
}

const STORAGE_KEY = 'v01.demo.state';
const VIVISTAYS = '6a1f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const NORTHWIND = '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a';
const BRIGHTWATER = 'c3b2a190-8f7e-4d6c-9b5a-4e3d2c1b0a99';
const MINUTE = 60_000;

const ago = (minutes: number) => new Date(Date.now() - minutes * MINUTE).toISOString();
const agoOrNull = (minutes: number | null) => (minutes === null ? null : ago(minutes));

const NO_ACTIVITY: DemoLive = {
  outboxWaiting: 0,
  outboxFailed: 0,
  oldestWaitingMinutes: null,
  lastSentMinutes: null,
  webhooksWaiting: 0,
  webhooksFailed: 0,
  lastWebhookMinutes: null,
  arrivalsToday: 0,
  departuresToday: 0,
  bookingsLast7Days: 0,
  lastActivityMinutes: null,
};

/** What a listing starts with before anyone fills it in; the API's column defaults. */
function listingDefaults(): Omit<PropertyDetail, keyof Property | 'updatedAt'> {
  return {
    addressLine2: null,
    title: null,
    summary: null,
    theSpace: null,
    guestAccess: null,
    neighbourhood: null,
    gettingAround: null,
    otherNotes: null,
    checkInMethod: null,
    petsAllowed: false,
    smokingAllowed: false,
    eventsAllowed: false,
    childrenAllowed: true,
    quietHoursStart: null,
    quietHoursEnd: null,
    houseRules: null,
    minNights: 1,
    maxNights: null,
    instantBook: true,
    advanceNoticeHours: 0,
    bookingWindowDays: 365,
    preparationDays: 0,
    cancellationPolicy: 'moderate',
    basePriceMinor: null,
    weekendPriceMinor: null,
    cleaningFeeMinor: null,
    extraGuestFeeMinor: null,
    extraGuestFrom: null,
    securityDepositMinor: null,
    licenceNumber: null,
    rooms: [],
    amenities: [],
    photos: [],
    channex: NOT_CONNECTED,
    cleaning: { status: 'clean', changedAt: null, changedBy: null },
    listings: [],
    fields: [],
    links: [],
  };
}

const NOT_CONNECTED: ChannexState = {
  status: 'not_connected',
  channexPropertyId: null,
  requestedBy: null,
  requestedAt: null,
  finishedAt: null,
  error: null,
  attempts: 0,
  autoClose: null,
  autoCloseCheckedAt: null,
};

/** A connection the stand-in worker finished: the sample properties V-01 runs were "connected" when added. */
function connectedSince(at: string): ChannexState {
  return {
    status: 'connected',
    channexPropertyId: crypto.randomUUID(),
    requestedBy: 'Demo user',
    requestedAt: at,
    finishedAt: at,
    error: null,
    attempts: 1,
    // The stand-in worker read it back the last time it "ran": early this morning.
    autoClose: true,
    autoCloseCheckedAt: checkedThisMorning(),
  };
}

/** The daily safety check runs at 04:15; the demo says it ran this morning. */
function checkedThisMorning(): string {
  const at = new Date();
  at.setHours(4, 15, 0, 0);
  if (at.getTime() > Date.now()) at.setDate(at.getDate() - 1);
  return at.toISOString();
}

/**
 * The stand-in worker: a request made more than a few seconds ago has been done. Properties saved
 * before this existed get their state from who runs them.
 */
function channexOf(detail: PropertyDetail): ChannexState {
  const current = detail.channex as ChannexState | undefined;
  if (!current) return detail.managedBy === 'v01' ? connectedSince(detail.createdAt) : NOT_CONNECTED;
  if (
    current.status === 'connecting' &&
    current.requestedAt &&
    Date.now() - Date.parse(current.requestedAt) > 4000
  ) {
    return {
      ...current,
      status: 'connected',
      channexPropertyId: crypto.randomUUID(),
      finishedAt: new Date().toISOString(),
      attempts: 1,
      autoClose: true,
      autoCloseCheckedAt: new Date().toISOString(),
    };
  }
  return current;
}

function account(
  channel: Channel,
  label: string,
  status: DemoAccount['status'],
  loginHolder: string | null,
  externalAccountId: string | null,
): DemoAccount {
  return {
    id: crypto.randomUUID(),
    channel,
    label,
    status,
    loginHolder,
    externalAccountId,
    requestedAt: null,
    connectUrl: null,
    listings: [],
  };
}

function sampleProperty(p: {
  name: string;
  code: string;
  area: string;
  type: PropertyType;
  bedrooms: number;
  beds: number;
  bathrooms: number;
  guests: number;
  prices: [number, number] | null;
  /** The usual price, weekend price and minimum stay. */
  usual?: { base: number | null; weekend?: number; minNights: number };
  managedBy: Property['managedBy'];
  title?: string;
  amenities?: string[];
  tags?: string[];
  /** Drawn sample rooms, by key (see sample-photos.ts), the first as the cover. */
  photos?: string[];
}): PropertyDetail {
  const createdAt = new Date('2026-10-14T09:00:00Z').toISOString();
  return {
    id: crypto.randomUUID(),
    name: p.name,
    internalCode: p.code,
    addressLine1: null,
    city: null,
    postcode: null,
    countryCode: 'GB',
    area: p.area,
    propertyType: p.type,
    spaceType: 'entire_place',
    bedrooms: p.bedrooms,
    beds: p.beds,
    bathrooms: p.bathrooms,
    maxGuests: p.guests,
    checkInTime: '15:00',
    checkOutTime: '10:00',
    managedBy: p.managedBy,
    priceOwner: 'v01',
    minPriceMinor: p.prices ? p.prices[0] : null,
    maxPriceMinor: p.prices ? p.prices[1] : null,
    coverPhotoUrl: null,
    photoCount: p.photos?.length ?? 0,
    channexStatus: p.managedBy === 'v01' ? 'connected' : 'not_connected',
    tags: p.tags ?? [],
    createdAt,
    ...listingDefaults(),
    // The sample properties V-01 runs were connected when they were added; the rest wait.
    channex: p.managedBy === 'v01' ? connectedSince(createdAt) : NOT_CONNECTED,
    title: p.title ?? null,
    amenities: p.amenities ?? [],
    basePriceMinor: p.usual?.base ?? null,
    weekendPriceMinor: p.usual?.weekend ?? null,
    minNights: p.usual?.minNights ?? 1,
    photos: (p.photos ?? []).map((key, position) => ({
      id: crypto.randomUUID(),
      url: `sample-photo:${key}`,
      caption: null,
      position,
      roomId: null,
      width: 960,
      height: 640,
    })),
    updatedAt: createdAt,
  };
}

interface SampleStay {
  /** Which of the operator's properties, in the order they are listed in the seed. */
  property: number;
  /** Days from the day the sample is laid out. */
  from: number;
  nights: number;
  guest: string;
  /** Everyone, children included. */
  guests: number;
  children?: number;
  channel: Channel;
  reference: string | null;
  status?: ReservationStatus;
  email?: string;
  phone?: string;
  notes?: string;
  checkInTime?: string;
  checkOutTime?: string;
}

interface SampleCalendar {
  stays: SampleStay[];
  blocks: { property: number; from: number; nights: number; reason: string }[];
  nights: {
    property: number;
    from: number;
    nights: number;
    priceMinor?: number;
    minNights?: number;
    closedToArrival?: boolean;
  }[];
}

/** Invented guests on invented properties, laid out around today so the calendar always looks current. */
const SAMPLE_CALENDARS: Record<string, SampleCalendar> = {
  [NORTHWIND]: {
    stays: [
      {
        property: 0,
        from: -3,
        nights: 4,
        guest: 'Priya Shah',
        guests: 4,
        channel: 'airbnb',
        reference: 'HM8KQ2TZ4N',
        children: 2,
        phone: '+44 7700 900101',
      },
      {
        property: 0,
        from: 1,
        nights: 3,
        guest: 'Tom Becker',
        guests: 2,
        channel: 'booking_com',
        reference: '4281907733',
        email: 'tom.becker@example.com',
        phone: '+44 7700 900102',
      },
      {
        property: 0,
        from: 6,
        nights: 3,
        guest: 'Maria Costa',
        guests: 5,
        channel: 'airbnb',
        reference: 'HMZ4P7Q1RT',
        children: 3,
      },
      {
        property: 0,
        from: 12,
        nights: 7,
        guest: 'Daniel Okafor',
        guests: 6,
        channel: 'vrbo',
        reference: 'HA-4X2K9P',
        children: 2,
        email: 'daniel.okafor@example.com',
      },
      {
        property: 0,
        from: 22,
        nights: 2,
        guest: 'Lena Fischer',
        guests: 2,
        channel: 'direct',
        reference: null,
        email: 'lena.fischer@example.com',
        phone: '+44 7700 900103',
        notes: 'Booked by phone. Paying by bank transfer before arrival.',
      },
      {
        property: 1,
        from: -1,
        nights: 3,
        guest: 'Sofia Romano',
        guests: 2,
        channel: 'airbnb',
        reference: 'HMR2D8W5KC',
        notes: 'Arriving late, around 22:00. Self check-in instructions sent.',
      },
      {
        property: 1,
        from: 2,
        nights: 1,
        guest: 'Jamie Clarke',
        guests: 1,
        channel: 'booking_com',
        reference: '4290315518',
        email: 'jamie.clarke@example.com',
      },
      {
        property: 1,
        from: 5,
        nights: 2,
        guest: 'Hannah Lee',
        guests: 2,
        channel: 'airbnb',
        reference: 'HMB6N3T9XE',
        checkInTime: '13:00',
        notes: 'Early check-in at 13:00 agreed. The cleaners know.',
      },
      {
        property: 1,
        from: 9,
        nights: 5,
        guest: 'Arjun Mehta',
        guests: 2,
        channel: 'booking_com',
        reference: '4302276641',
        email: 'arjun.mehta@example.com',
        phone: '+44 7700 900104',
      },
      {
        property: 1,
        from: 19,
        nights: 3,
        guest: 'Grace Wilson',
        guests: 2,
        channel: 'airbnb',
        reference: 'HMK1C5V8QA',
      },
      // Left early this morning; Claire Dubois arrives this afternoon, so the cottage needs cleaning.
      {
        property: 2,
        from: -2,
        nights: 2,
        guest: 'Leo Hartmann',
        guests: 2,
        channel: 'airbnb',
        reference: 'HMV3R8P2LD',
        checkOutTime: '07:00',
        notes: 'Leaving early for an 08:30 flight.',
      },
      {
        property: 2,
        from: 0,
        nights: 3,
        guest: 'Claire Dubois',
        guests: 4,
        channel: 'vrbo',
        reference: 'HA-7M3R1D',
        children: 2,
        email: 'claire.dubois@example.com',
      },
      {
        property: 2,
        from: 8,
        nights: 7,
        guest: 'Owen Price',
        guests: 3,
        channel: 'airbnb',
        reference: 'HMT9W2E6LB',
        children: 1,
        phone: '+44 7700 900105',
      },
      // Came in over Owen Price's stay: it holds no nights until someone sorts it out.
      {
        property: 2,
        from: 10,
        nights: 2,
        guest: 'Ravi Kumar',
        guests: 2,
        channel: 'booking_com',
        reference: '4311850297',
        email: 'ravi.kumar@example.com',
        notes: 'Came in over Owen Price’s stay. Ask Booking.com to move or cancel it.',
        status: 'conflict',
      },
      {
        property: 3,
        from: -4,
        nights: 7,
        guest: 'Ella Martin',
        guests: 8,
        channel: 'airbnb',
        reference: 'HMQ3F7H2NJ',
        children: 3,
        phone: '+44 7700 900106',
      },
      {
        property: 3,
        from: 10,
        nights: 7,
        guest: 'Noah Williams',
        guests: 6,
        channel: 'direct',
        reference: null,
        children: 2,
        email: 'noah.williams@example.com',
        phone: '+44 7700 900107',
        checkOutTime: '12:00',
        notes: 'Late check-out at 12:00 included for this direct booking.',
      },
      // Finished stays, for the Reservations list's Past view.
      {
        property: 0,
        from: -12,
        nights: 3,
        guest: 'Lucas Moreau',
        guests: 2,
        channel: 'airbnb',
        reference: 'HMP2L6K8WD',
      },
      {
        property: 1,
        from: -9,
        nights: 4,
        guest: 'Fatima Rahman',
        guests: 2,
        channel: 'booking_com',
        reference: '4266120934',
        email: 'fatima.rahman@example.com',
      },
      {
        property: 3,
        from: -15,
        nights: 5,
        guest: 'Amaka Okoro',
        guests: 7,
        children: 4,
        channel: 'direct',
        reference: null,
        phone: '+44 7700 900108',
      },
      // Cancelled on Airbnb: it holds no nights.
      {
        property: 3,
        from: 24,
        nights: 3,
        guest: 'Chloe Martin',
        guests: 4,
        channel: 'airbnb',
        reference: 'HMX7C3B9TR',
        status: 'cancelled',
      },
    ],
    blocks: [
      { property: 1, from: 15, nights: 2, reason: 'Maintenance: boiler service' },
      { property: 2, from: 3, nights: 4, reason: 'Owner staying' },
    ],
    nights: [
      { property: 0, from: 10, nights: 1, closedToArrival: true },
      { property: 0, from: 26, nights: 2, priceMinor: 22_000 },
      { property: 0, from: 30, nights: 4, priceMinor: 21_500, minNights: 3 },
      { property: 3, from: 20, nights: 2, priceMinor: 28_000 },
    ],
  },
  [BRIGHTWATER]: {
    stays: [
      {
        property: 0,
        from: 2,
        nights: 3,
        guest: 'Isla Grant',
        guests: 4,
        channel: 'airbnb',
        reference: 'HMW5J8D2PK',
      },
      {
        property: 0,
        from: 7,
        nights: 3,
        guest: 'Marco Bianchi',
        guests: 2,
        channel: 'booking_com',
        reference: '4318826640',
      },
      {
        property: 1,
        from: 0,
        nights: 2,
        guest: 'Emily Brown',
        guests: 3,
        channel: 'airbnb',
        reference: 'HMC4X9L1QS',
      },
      {
        property: 1,
        from: 4,
        nights: 4,
        guest: 'Yusuf Demir',
        guests: 2,
        channel: 'vrbo',
        reference: 'HA-2P8N4K',
      },
      { property: 2, from: 1, nights: 5, guest: 'Anna Novak', guests: 5, channel: 'direct', reference: null },
    ],
    blocks: [],
    nights: [],
  },
};

function demoToday(): string {
  return todayIn('Europe/London');
}

/** Lays an operator's sample bookings, blocks and nightly prices out from `from`. */
function sampleCalendar(orgId: string, properties: PropertyDetail[], from: string): DemoCalendar {
  const sample = SAMPLE_CALENDARS[orgId];
  const calendar: DemoCalendar = { nights: [], stays: [], blocks: [] };
  if (!sample) return calendar;
  const idOf = (index: number) => properties[index]?.id ?? '';
  for (const b of sample.blocks) {
    calendar.blocks.push({
      id: crypto.randomUUID(),
      propertyId: idOf(b.property),
      startsOn: addDays(from, b.from),
      endsOn: addDays(from, b.from + b.nights),
      reason: b.reason,
    });
  }
  for (const n of sample.nights) {
    for (let i = 0; i < n.nights; i++) {
      calendar.nights.push({
        propertyId: idOf(n.property),
        night: addDays(from, n.from + i),
        priceMinor: n.priceMinor ?? null,
        minNights: n.minNights ?? null,
        closedToArrival: n.closedToArrival ?? false,
        closedToDeparture: false,
      });
    }
  }
  // Each booking's total is its nights at the prices the calendar shows for them.
  sample.stays.forEach((s, index) => {
    const property = properties[s.property];
    const checkIn = addDays(from, s.from);
    const checkOut = addDays(from, s.from + s.nights);
    let total: number | null = 0;
    for (const night of eachNight(checkIn, checkOut)) {
      const own = calendar.nights.find((n) => n.propertyId === property?.id && n.night === night) ?? null;
      const price = property ? nightRules(property, night, own).priceMinor : null;
      total = total === null || price === null ? null : total + price;
    }
    // Booked a few weeks before arrival, or the day after the last one for a past stay.
    const booked = new Date(
      `${addDays(from, Math.min(s.from, 0) - 21 - (index % 9))}T10:${String(10 + index).padStart(2, '0')}:00Z`,
    );
    const children = s.children ?? 0;
    calendar.stays.push({
      id: crypto.randomUUID(),
      propertyId: idOf(s.property),
      checkIn,
      checkOut,
      status: s.status ?? 'confirmed',
      channel: s.channel,
      channelReference: s.reference,
      guestName: s.guest,
      guests: s.guests,
      adults: Math.max(1, s.guests - children),
      children,
      infants: 0,
      guestEmail: s.email ?? null,
      guestPhone: s.phone ?? null,
      currency: 'GBP',
      totalMinor: total,
      payoutMinor: null,
      checkInTime: s.checkInTime ?? null,
      checkOutTime: s.checkOutTime ?? null,
      notes: s.notes ?? null,
      createdAt: booked.toISOString(),
      updatedAt: booked.toISOString(),
      cancelledAt:
        s.status === 'cancelled' ? new Date(Date.now() - 2 * 24 * 60 * MINUTE).toISOString() : null,
    });
  });
  return calendar;
}

function operatorWorkspace(
  id: string,
  name: string,
  legalName: string | null,
  slug: string,
  accentHex: string,
) {
  return {
    organisation: { id, name, legalName, slug },
    settings: { currency: 'GBP', timeZone: 'Europe/London', locale: 'en-GB', countryCode: 'GB' },
    brand: {
      displayName: name,
      logoLightUrl: null,
      logoDarkUrl: null,
      accentHex,
      senderName: name,
      emailDomain: null,
    },
  };
}

function seed(): DemoState {
  const pastVisit = Date.now() - (2 * 24 * 60 + 190) * MINUTE;
  const state: DemoState = {
    version: 10,
    calendarFrom: demoToday(),
    operators: [
      {
        role: 'admin',
        workspace: operatorWorkspace(VIVISTAYS, 'Vivistays', null, 'vivistays', '#1E4D4F'),
        // Empty on purpose: Vivistays' real properties arrive from the Guesty export in Phase 1.
        properties: [],
        createdAt: '2026-10-14T09:00:00.000Z',
        team: [
          {
            email: DEMO_USER.email,
            fullName: 'Demo user',
            role: 'admin',
            status: 'active',
            sinceDaysAgo: 0,
            lastSeenMinutesAgo: 0,
          },
        ],
        channelAccounts: [],
        links: [],
        live: NO_ACTIVITY,
        calendar: { nights: [], stays: [], blocks: [] },
        fields: [],
        fieldValues: {},
      },
      {
        // The demo user belongs to this invented operator too, so the Calendar has bookings to try.
        role: 'admin',
        workspace: operatorWorkspace(
          NORTHWIND,
          'Northwind Stays',
          'Northwind Stays (fictional demo operator)',
          'northwind-demo',
          '#2F5E8C',
        ),
        properties: [
          sampleProperty({
            name: 'Harbour View Lodge',
            code: 'HVL',
            area: 'Harbourside',
            type: 'house',
            bedrooms: 3,
            beds: 4,
            bathrooms: 2,
            guests: 6,
            prices: [12_000, 34_000],
            usual: { base: 16_500, weekend: 19_500, minNights: 2 },
            tags: ['Sea view', 'Owner: Ellis'],
            managedBy: 'v01',
            title: 'Harbourside house with sea views',
            amenities: ['sea_view', 'log_burner', 'wifi', 'kitchen', 'washing_machine', 'free_parking'],
            photos: ['room2', 'room1'],
          }),
          sampleProperty({
            name: 'Mill Street Flat',
            code: 'MSF',
            area: 'Old Town',
            type: 'flat',
            bedrooms: 1,
            beds: 1,
            bathrooms: 1,
            guests: 2,
            prices: [6_500, 15_000],
            usual: { base: 8_500, weekend: 9_500, minNights: 1 },
            tags: ['City centre', 'Owner: Patel'],
            managedBy: 'v01',
            photos: ['room5', 'room3'],
          }),
          sampleProperty({
            name: 'Orchard Cottage',
            code: 'ORC',
            area: 'Riverside',
            type: 'cottage',
            bedrooms: 2,
            beds: 3,
            bathrooms: 1.5,
            guests: 4,
            prices: [9_000, 22_000],
            usual: { base: 12_000, weekend: 14_500, minNights: 2 },
            tags: ['Family', 'Owner: Ellis'],
            managedBy: 'guesty',
            photos: ['room4', 'room1'],
          }),
          sampleProperty({
            name: 'The Granary',
            code: 'GRN',
            area: 'Riverside',
            type: 'unusual',
            bedrooms: 4,
            beds: 5,
            bathrooms: 2.5,
            guests: 8,
            prices: null,
            usual: { base: 24_000, minNights: 3 },
            tags: ['Large groups', 'Family'],
            managedBy: 'guesty',
            photos: ['room3', 'room6'],
          }),
        ],
        createdAt: '2026-09-02T10:00:00.000Z',
        team: [
          {
            email: 'jordan@northwind.example',
            fullName: 'Jordan Ellis',
            role: 'admin',
            status: 'active',
            sinceDaysAgo: 42,
            lastSeenMinutesAgo: 12,
          },
          {
            email: 'sam@northwind.example',
            fullName: 'Sam Patel',
            role: 'operations',
            status: 'active',
            sinceDaysAgo: 40,
            lastSeenMinutesAgo: 5,
          },
          {
            email: 'alex@northwind.example',
            fullName: 'Alex Morgan',
            role: 'guest_comms',
            status: 'active',
            sinceDaysAgo: 35,
            lastSeenMinutesAgo: 95,
          },
          {
            email: 'chris@northwind.example',
            fullName: 'Chris Doyle',
            role: 'field',
            status: 'active',
            sinceDaysAgo: 21,
            lastSeenMinutesAgo: 60 * 26,
          },
        ],
        channelAccounts: [
          account('airbnb', 'Airbnb A', 'connected', 'Demo user', '48201177'),
          account('airbnb', 'Airbnb B', 'connected', 'Demo user', '48209912'),
          account('booking_com', 'Booking.com A', 'connected', null, '7731204'),
          account('vrbo', 'Vrbo', 'disconnected', null, null),
        ],
        links: [],
        live: {
          outboxWaiting: 2,
          outboxFailed: 1,
          oldestWaitingMinutes: 1,
          lastSentMinutes: 2,
          webhooksWaiting: 0,
          webhooksFailed: 0,
          lastWebhookMinutes: 14,
          arrivalsToday: 2,
          departuresToday: 1,
          bookingsLast7Days: 9,
          lastActivityMinutes: 5,
        },
        calendar: { nights: [], stays: [], blocks: [] },
        fields: [],
        fieldValues: {},
      },
      {
        role: null,
        workspace: operatorWorkspace(
          BRIGHTWATER,
          'Brightwater Lets',
          'Brightwater Lets (fictional demo operator)',
          'brightwater-demo',
          '#7A4A2B',
        ),
        properties: [
          sampleProperty({
            name: 'Quay House',
            code: 'QYH',
            area: 'Quayside',
            type: 'house',
            bedrooms: 3,
            beds: 4,
            bathrooms: 2,
            guests: 6,
            prices: [11_000, 28_000],
            usual: { base: 15_000, weekend: 17_500, minNights: 2 },
            managedBy: 'guesty',
            photos: ['room6', 'room2'],
          }),
          sampleProperty({
            name: 'Linden Court, Flat 2',
            code: 'LC2',
            area: 'Town centre',
            type: 'flat',
            bedrooms: 2,
            beds: 2,
            bathrooms: 1,
            guests: 4,
            prices: [8_000, 18_000],
            usual: { base: 10_500, minNights: 1 },
            managedBy: 'guesty',
            photos: ['room1', 'room5'],
          }),
          sampleProperty({
            name: 'The Old Bakery',
            code: 'OBK',
            area: 'Village',
            type: 'cottage',
            bedrooms: 2,
            beds: 3,
            bathrooms: 1.5,
            guests: 5,
            prices: null,
            usual: { base: null, minNights: 2 },
            managedBy: 'guesty',
            photos: ['room4', 'room3'],
          }),
        ],
        createdAt: '2026-10-08T11:30:00.000Z',
        team: [
          {
            email: 'taylor@brightwater.example',
            fullName: 'Taylor Reed',
            role: 'admin',
            status: 'active',
            sinceDaysAgo: 6,
            lastSeenMinutesAgo: 190,
          },
          {
            email: 'ops@brightwater.example',
            fullName: null,
            role: 'operations',
            status: 'invited',
            sinceDaysAgo: 2,
            lastSeenMinutesAgo: null,
          },
        ],
        channelAccounts: [
          account('airbnb', 'Airbnb', 'disconnected', null, null),
          account('booking_com', 'Booking.com', 'disconnected', null, null),
        ],
        links: [],
        live: { ...NO_ACTIVITY, lastActivityMinutes: 190 },
        calendar: { nights: [], stays: [], blocks: [] },
        fields: [],
        fieldValues: {},
      },
    ],
    grants: [
      {
        id: crypto.randomUUID(),
        organisationId: NORTHWIND,
        staffEmail: 'support@v01.example',
        reason: 'Owner reported a double booking for 3 Nov. Checking both stays.',
        startedAt: new Date(pastVisit).toISOString(),
        expiresAt: new Date(pastVisit + 30 * MINUTE).toISOString(),
        endedAt: new Date(pastVisit + 18 * MINUTE).toISOString(),
        requests: 6,
      },
    ],
    unmatchedWebhooks: { waiting: 1, failed: 0, lastMinutes: 41 },
    errors: [
      {
        source: 'outbox',
        organisationId: NORTHWIND,
        minutesAgo: 26,
        attempts: 5,
        message:
          'Channex answered 422 for Harbour View Lodge, 24 Dec 2026: the minimum stay is longer than the rate plan allows.',
      },
      {
        source: 'webhook',
        organisationId: null,
        minutesAgo: 41,
        attempts: 3,
        message: 'Channex property 7f3a-sample is not mapped to any V-01 property yet.',
      },
    ],
  };
  layOutSamples(state);
  seedFields(state);
  seedLinks(state);
  return state;
}

/**
 * What Channex would see on each connected account: a listing per property (two on Airbnb A, the
 * rest on Airbnb B), with the properties V-01 runs linked and live, and the ones still on Guesty
 * seen but not linked. Invented ids throughout.
 */
function seedLinks(s: DemoState): void {
  for (const operator of s.operators) {
    const connected = operator.channelAccounts.filter((a) => a.status === 'connected');
    if (!connected.length) continue;
    const airbnbs = connected.filter((a) => a.channel === 'airbnb');
    const booking = connected.find((a) => a.channel === 'booking_com');
    operator.properties.forEach((p, index) => {
      const code = (p.internalCode ?? 'L').toLowerCase();
      const seed = 5_550_000 + index * 1_117;
      const airbnb = airbnbs[index % Math.max(1, airbnbs.length)];
      if (airbnb) {
        airbnb.listings.push({ externalListingId: String(seed), title: p.title ?? p.name });
        if (p.managedBy === 'v01')
          operator.links.push({
            id: crypto.randomUUID(),
            propertyId: p.id,
            accountId: airbnb.id,
            externalListingId: String(seed),
            status: 'live',
            liveFrom: '2026-10-15',
            requestedAt: '2026-10-15T09:00:00.000Z',
          });
      }
      if (booking) {
        booking.listings.push({
          externalListingId: `${seed + 1}`,
          title: `${p.name} (${code.toUpperCase()})`,
        });
        if (p.managedBy === 'v01' && index % 2 === 0)
          operator.links.push({
            id: crypto.randomUUID(),
            propertyId: p.id,
            accountId: booking.id,
            externalListingId: `${seed + 1}`,
            status: 'live',
            liveFrom: '2026-10-15',
            requestedAt: '2026-10-15T09:00:00.000Z',
          });
      }
    });
  }
}

/**
 * The custom fields an operator leaving Guesty brings: a check-in instructions link, the lock
 * code, the cleaning policy, a note for the team. Sample values only; nothing here is real.
 */
function seedFields(s: DemoState): void {
  const defs: { name: string; kind: CustomField['kind'] }[] = [
    { name: 'Check-in instructions', kind: 'link' },
    { name: 'Lock code', kind: 'secret' },
    { name: 'Cleaning policy', kind: 'long_text' },
    { name: 'Note for the team', kind: 'long_text' },
  ];
  const samples: Record<string, [string | null, string | null, string | null, string | null]> = {
    HVL: [
      'https://docs.example.com/harbour-view/arrival',
      '4921#',
      'Full clean after every stay. Linen from the store in the garage; towels for six.',
      'Owner visits in August: keep the second week free.',
    ],
    ORC: [
      'https://docs.example.com/orchard/arrival',
      '7730',
      'Clean after every stay; deep clean on the first Monday of the month.',
      null,
    ],
    QYH: [null, '2580', 'Still cleaned by the Guesty-era team until the move-over.', null],
  };
  for (const operator of s.operators) {
    if (!operator.role) continue;
    operator.fields = defs.map((d, position) => ({ id: crypto.randomUUID(), ...d, position }));
    for (const property of operator.properties) {
      const values = samples[property.internalCode ?? ''];
      if (!values) continue;
      operator.fieldValues[property.id] = Object.fromEntries(
        operator.fields.flatMap((f, i) => (values[i] ? [[f.id, values[i]]] : [])),
      );
    }
  }
}

/** The invented operators' bookings, laid out from today, with every property cleaned yesterday. */
function layOutSamples(s: DemoState): void {
  s.calendarFrom = demoToday();
  for (const operator of s.operators) {
    const id = operator.workspace.organisation.id;
    if (!SAMPLE_CALENDARS[id]) continue;
    operator.calendar = sampleCalendar(id, operator.properties, s.calendarFrom);
    const tz = operator.workspace.settings.timeZone;
    const cleaned = zonedInstant(addDays(s.calendarFrom, -1), '16:20', tz).toISOString();
    const by = operator.team[0]?.fullName ?? null;
    operator.cleaning = Object.fromEntries(
      operator.properties.map((p) => [p.id, { status: 'clean' as const, changedAt: cleaned, changedBy: by }]),
    );
  }
}

/** The moment a wall-clock time happens on a date somewhere: "2026-10-16" at "07:00" in London. */
function zonedInstant(date: string, time: string, timeZone: string): Date {
  const [y = 0, m = 1, d = 1] = date.split('-').map(Number);
  const [h = 0, min = 0] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, h, min);
  // What the time zone's clock shows at that instant, read as if it were UTC: the gap is its offset.
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(guess));
  const part = (type: string) => Number(parts.find((x) => x.type === type)?.value ?? 0);
  const shown = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'));
  return new Date(guess - (shown - guess));
}

/**
 * The worker's rule, run whenever the demo calendar is read: a property goes dirty at a guest's
 * check-out time, unless someone marked it since.
 */
function sweepCleaning(operator: DemoOperator): void {
  const tz = operator.workspace.settings.timeZone;
  const today = todayIn(tz);
  const now = Date.now();
  const cleaning = operator.cleaning ?? {};
  operator.cleaning = cleaning;
  let changed = false;
  for (const stay of operator.calendar.stays) {
    if (stay.status !== 'confirmed' || stay.checkOut < addDays(today, -1) || stay.checkOut > today) continue;
    const property = operator.properties.find((p) => p.id === stay.propertyId);
    if (!property) continue;
    const left = zonedInstant(stay.checkOut, stay.checkOutTime ?? property.checkOutTime, tz).getTime();
    if (left > now || left <= now - 24 * 60 * MINUTE) continue;
    const current = cleaning[property.id];
    if (current?.changedAt && Date.parse(current.changedAt) >= left) continue;
    cleaning[property.id] = { status: 'dirty', changedAt: new Date(left).toISOString(), changedBy: null };
    changed = true;
  }
  if (changed) save();
}

let state: DemoState | null = null;

function load(): DemoState {
  if (state) return state;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as DemoState;
      if (parsed.version === 10) {
        // A week on, the sample bookings would all be in the past: lay them out again from today.
        if (parsed.calendarFrom <= addDays(demoToday(), -7)) {
          layOutSamples(parsed);
          state = parsed;
          save();
        }
        state = parsed;
        return parsed;
      }
    }
  } catch {
    // No storage (private window, blocked site data): the demo still works, it just forgets.
  }
  state = seed();
  return state;
}

function save(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // See load().
  }
}

/** Puts the sample data back the way it started. */
export function resetDemoData(): void {
  state = seed();
  save();
  void clearDemoPhotos();
}

// Access ----------------------------------------------------------------------------------------

function isOpen(g: DemoGrant, now = Date.now()): boolean {
  return g.endedAt === null && Date.parse(g.expiresAt) > now;
}

function findOperator(orgId: string | null | undefined): DemoOperator | undefined {
  return load().operators.find((o) => o.workspace.organisation.id === orgId);
}

/** The same checks as the API: membership first, then an open support grant (read-only, logged). */
function access(
  orgId: string | null | undefined,
  permission: Permission,
): { operator: DemoOperator; role: WorkspaceRole } {
  if (!orgId) throw new ApiError(400, 'workspace_required', 'Choose a workspace first.');
  const operator = findOperator(orgId);
  if (!operator) throw new ApiError(403, 'not_a_member', 'You are not a member of this workspace.');
  if (operator.role) {
    if (!can(operator.role, permission))
      throw new ApiError(403, 'not_allowed', 'Your role does not allow this.');
    return { operator, role: operator.role };
  }
  const grant = load().grants.find(
    (g) => g.organisationId === orgId && g.staffEmail === DEMO_USER.email && isOpen(g),
  );
  if (!grant) throw new ApiError(403, 'not_a_member', 'You are not a member of this workspace.');
  grant.requests += 1;
  save();
  if (!can(SUPPORT_ROLE, permission)) {
    throw new ApiError(403, 'support_read_only', 'Support access is read-only.');
  }
  return { operator, role: SUPPORT_ROLE };
}

// Console figures ------------------------------------------------------------------------------

function onV01(o: DemoOperator): number {
  return o.properties.filter((p) => p.managedBy === 'v01').length;
}

function onGuesty(o: DemoOperator): number {
  return o.properties.filter((p) => p.managedBy === 'guesty').length;
}

function lastActivity(o: DemoOperator): string | null {
  const times = [
    ...(o.live.lastActivityMinutes === null ? [] : [Date.now() - o.live.lastActivityMinutes * MINUTE]),
    ...o.properties.map((p) => Date.parse(p.createdAt)).filter((t) => t > Date.parse(o.createdAt)),
  ];
  return times.length ? new Date(Math.max(...times)).toISOString() : null;
}

function toConsoleOperator(o: DemoOperator): ConsoleOperator {
  const id = o.workspace.organisation.id;
  const connected = o.channelAccounts.filter((a) => a.status === 'connected');
  return {
    id,
    name: o.workspace.organisation.name,
    slug: o.workspace.organisation.slug,
    createdAt: o.createdAt,
    status: onV01(o) > 0 ? 'live' : 'onboarding',
    properties: o.properties.length,
    propertiesOnV01: onV01(o),
    propertiesOnGuesty: onGuesty(o),
    members: o.team.filter((m) => m.status === 'active').length,
    channelAccounts: o.channelAccounts.length,
    channelAccountsConnected: connected.length,
    channels: [...new Set(connected.map((a) => a.channel))].sort(),
    outboxWaiting: o.live.outboxWaiting,
    outboxFailed: o.live.outboxFailed,
    webhooksFailed: o.live.webhooksFailed,
    lastActivityAt: lastActivity(o),
    supportActive: load().grants.some((g) => g.organisationId === id && isOpen(g)),
  };
}

function toGrant(g: DemoGrant): SupportGrant {
  return {
    ...g,
    organisationName: findOperator(g.organisationId)?.workspace.organisation.name ?? 'Unknown operator',
    active: isOpen(g),
  };
}

function grantsNewestFirst(orgId?: string): DemoGrant[] {
  return load()
    .grants.filter((g) => !orgId || g.organisationId === orgId)
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}

function overview(): ConsoleOverview {
  const s = load();
  const sum = (pick: (l: DemoLive) => number) => s.operators.reduce((n, o) => n + pick(o.live), 0);
  const lastSent = s.operators.map((o) => o.live.lastSentMinutes).filter((m): m is number => m !== null);
  return {
    operators: s.operators.length,
    operatorsLive: s.operators.filter((o) => onV01(o) > 0).length,
    properties: s.operators.reduce((n, o) => n + o.properties.length, 0),
    propertiesOnV01: s.operators.reduce((n, o) => n + onV01(o), 0),
    propertiesOnGuesty: s.operators.reduce((n, o) => n + onGuesty(o), 0),
    arrivalsToday: sum((l) => l.arrivalsToday),
    departuresToday: sum((l) => l.departuresToday),
    bookingsLast7Days: sum((l) => l.bookingsLast7Days),
    outboxWaiting: sum((l) => l.outboxWaiting),
    outboxFailed: sum((l) => l.outboxFailed),
    webhooksWaiting: sum((l) => l.webhooksWaiting) + s.unmatchedWebhooks.waiting,
    webhooksFailed: sum((l) => l.webhooksFailed) + s.unmatchedWebhooks.failed,
    supportSessionsActive: s.grants.filter((g) => isOpen(g)).length,
    lastSentAt: lastSent.length ? ago(Math.min(...lastSent)) : null,
    generatedAt: new Date().toISOString(),
  };
}

function sync(): ConsoleSync {
  const s = load();
  const rows: ConsoleSyncRow[] = [...s.operators]
    .sort((a, b) => a.workspace.organisation.name.localeCompare(b.workspace.organisation.name))
    .map((o) => ({
      organisationId: o.workspace.organisation.id,
      organisationName: o.workspace.organisation.name,
      outboxWaiting: o.live.outboxWaiting,
      outboxFailed: o.live.outboxFailed,
      oldestWaitingAt: agoOrNull(o.live.oldestWaitingMinutes),
      lastSentAt: agoOrNull(o.live.lastSentMinutes),
      webhooksWaiting: o.live.webhooksWaiting,
      webhooksFailed: o.live.webhooksFailed,
      lastWebhookAt: agoOrNull(o.live.lastWebhookMinutes),
    }));
  if (s.unmatchedWebhooks.waiting + s.unmatchedWebhooks.failed > 0) {
    rows.push({
      organisationId: null,
      organisationName: null,
      outboxWaiting: 0,
      outboxFailed: 0,
      oldestWaitingAt: null,
      lastSentAt: null,
      webhooksWaiting: s.unmatchedWebhooks.waiting,
      webhooksFailed: s.unmatchedWebhooks.failed,
      lastWebhookAt: agoOrNull(s.unmatchedWebhooks.lastMinutes),
    });
  }
  return {
    worker: {
      lastSeenAt: new Date(Date.now() - 20_000).toISOString(),
      startedAt: checkedThisMorning(),
      recovering: false,
      // The stand-in worker came back once, after a 40-minute gap on 16 October, and drained 3 changes.
      lastRecovery: { at: '2026-10-16T09:12:00.000Z', gapSeconds: 40 * 60, drained: 3 },
    },
    rows,
    errors: [...s.errors]
      .sort((a, b) => a.minutesAgo - b.minutesAgo)
      .map((e) => ({
        source: e.source,
        organisationId: e.organisationId,
        organisationName: findOperator(e.organisationId)?.workspace.organisation.name ?? null,
        at: ago(e.minutesAgo),
        attempts: e.attempts,
        message: e.message,
      })),
    generatedAt: new Date().toISOString(),
  };
}

function operatorDetail(orgId: string): ConsoleOperatorDetail {
  const o = findOperator(orgId);
  if (!o) throw new ApiError(404, 'operator_not_found', 'There is no operator with that id.');
  return {
    operator: {
      ...toConsoleOperator(o),
      legalName: o.workspace.organisation.legalName,
      displayName: o.workspace.brand.displayName,
      currency: o.workspace.settings.currency,
      timeZone: o.workspace.settings.timeZone,
      countryCode: o.workspace.settings.countryCode,
    },
    team: [...o.team]
      .sort((a, b) =>
        a.status === b.status ? a.email.localeCompare(b.email) : a.status === 'active' ? -1 : 1,
      )
      .map((m) => ({
        email: m.email,
        fullName: m.fullName,
        role: m.role,
        status: m.status,
        since: ago(m.sinceDaysAgo * 24 * 60),
        lastSeenAt: agoOrNull(m.lastSeenMinutesAgo),
      })),
    support: grantsNewestFirst(orgId).slice(0, 20).map(toGrant),
  };
}

// Properties ---------------------------------------------------------------------------------------

function findProperty(operator: DemoOperator, id: string): PropertyDetail {
  const property = operator.properties.find((p) => p.id === id);
  if (!property) {
    throw new ApiError(404, 'property_not_found', 'That property does not exist in this workspace.');
  }
  return property;
}

/** Photo addresses point into this browser's storage; photos it no longer has are left out. */
/**
 * The listings a sample property is on: one per connected account of the operator, for properties
 * V-01 runs or that are still on Guesty (step 7 will link real ones).
 */
function listingsOf(operator: DemoOperator, detail: PropertyDetail): PropertyDetail['listings'] {
  return operator.links
    .filter((l) => l.propertyId === detail.id && l.status === 'live')
    .flatMap((l) => {
      const account = operator.channelAccounts.find((a) => a.id === l.accountId);
      return account
        ? [{ channel: account.channel, account: account.label, externalListingId: l.externalListingId }]
        : [];
    });
}

/** The stand-in worker: links asked for a few seconds ago are done; pending accounts come on. */
function settleLinks(operator: DemoOperator): void {
  const now = Date.now();
  let changed = false;
  for (const link of operator.links) {
    if (now - Date.parse(link.requestedAt) < 3000) continue;
    if (link.status === 'linking') {
      link.status = 'live';
      link.liveFrom = demoToday();
      changed = true;
    } else if (link.status === 'closing') {
      link.status = 'archived';
      changed = true;
    }
    if (
      link.status === 'live' &&
      link.publishedWanted !== undefined &&
      (link.published ?? true) !== link.publishedWanted &&
      link.pausedAt &&
      now - Date.parse(link.pausedAt) > 3000
    ) {
      link.published = link.publishedWanted;
      changed = true;
    }
  }
  for (const a of operator.channelAccounts) {
    if (a.status === 'pending' && a.requestedAt && now - Date.parse(a.requestedAt) > 6000) {
      a.status = 'connected';
      a.externalAccountId = a.externalAccountId ?? String(48_000_000 + Math.floor(Math.random() * 999_999));
      a.listings = operator.properties.map((p, i) => ({
        externalListingId: String(5_560_000 + i * 913 + operator.channelAccounts.indexOf(a)),
        title: p.title ?? p.name,
      }));
      changed = true;
    }
  }
  if (changed) save();
}

function toLink(operator: DemoOperator, l: DemoLink): PropertyLink {
  const account = operator.channelAccounts.find((a) => a.id === l.accountId);
  const listing = account?.listings.find((x) => x.externalListingId === l.externalListingId);
  return {
    id: l.id,
    channel: account?.channel ?? 'airbnb',
    channelAccountId: l.accountId,
    account: account?.label ?? 'Account',
    externalListingId: l.externalListingId,
    title: listing?.title ?? null,
    url: listingUrl(account?.channel ?? 'airbnb', l.externalListingId),
    status: l.status,
    liveFrom: l.liveFrom,
    lastError: null,
    requestedBy: 'Demo user',
    publishedWanted: l.publishedWanted ?? true,
    published: account?.channel === 'airbnb' && l.status === 'live' ? (l.published ?? true) : null,
    settingsSyncedAt:
      account?.channel === 'airbnb' && l.status === 'live'
        ? l.liveFrom
          ? `${l.liveFrom}T10:05:00.000Z`
          : null
        : null,
    settingsError: null,
  };
}

function linksOf(operator: DemoOperator, propertyId: string): PropertyLink[] {
  settleLinks(operator);
  return operator.links
    .filter((l) => l.propertyId === propertyId && l.status !== 'archived')
    .map((l) => toLink(operator, l));
}

function toAccount(operator: DemoOperator, a: DemoAccount): ChannelAccount {
  const asked = a.status !== 'disconnected';
  return {
    id: a.id,
    channel: a.channel,
    label: a.label,
    status: a.status,
    loginHolder: a.loginHolder,
    twoFactorHolder: null,
    connection: asked
      ? {
          channexChannelId:
            a.status === 'pending' && a.requestedAt && Date.now() - Date.parse(a.requestedAt) < 2000
              ? null
              : `cx-${a.id.slice(0, 8)}`,
          connectUrl: a.connectUrl,
          active: a.status === 'connected',
          externalAccountId: a.externalAccountId,
          lastCheckedAt: a.status === 'connected' ? new Date(Date.now() - 4 * 60_000).toISOString() : null,
          lastError: a.status === 'error' ? 'Channex refused the connection: the hotel id is unknown.' : null,
        }
      : null,
    listingsSeen: a.listings.length,
    listingsLinked: operator.links.filter(
      (l) => l.accountId === a.id && (l.status === 'live' || l.status === 'linking'),
    ).length,
    createdAt: operator.createdAt,
  };
}

/** Every field with this property's value; secrets only for roles that may see them. */
function fieldsOf(operator: DemoOperator, propertyId: string, role: WorkspaceRole): PropertyField[] {
  const values = operator.fieldValues[propertyId] ?? {};
  const reveal = can(role, 'secrets.read');
  return operator.fields.map((f) => {
    const value = values[f.id] ?? null;
    if (f.kind === 'secret' && !reveal) return { ...f, value: null, hidden: value !== null };
    return { ...f, value, hidden: false };
  });
}

async function resolved(
  detail: PropertyDetail,
  operator?: DemoOperator,
  role: WorkspaceRole = 'admin',
): Promise<PropertyDetail> {
  const photos: PropertyDetail['photos'] = [];
  for (const photo of detail.photos) {
    const url = photo.url.startsWith('demo-photo:')
      ? await demoPhotoUrl(photo.url.slice(11))
      : photo.url.startsWith('sample-photo:')
        ? (SAMPLE_PHOTOS[photo.url.slice(13)] ?? null)
        : photo.url;
    if (url) photos.push({ ...photo, url, position: photos.length });
  }
  const channex = channexOf(detail);
  if (channex !== detail.channex) {
    detail.channex = channex;
    save();
  }
  if (operator) sweepCleaning(operator);
  const cleaning = operator?.cleaning?.[detail.id] ?? { status: 'clean', changedAt: null, changedBy: null };
  const listings = operator ? listingsOf(operator, detail) : [];
  const fields = operator ? fieldsOf(operator, detail.id, role) : [];
  const links = operator ? linksOf(operator, detail.id) : [];
  return {
    ...detail,
    photos,
    channex,
    channexStatus: channex.status,
    cleaning,
    listings,
    fields,
    links,
    coverPhotoUrl: photos[0]?.url ?? null,
    photoCount: photos.length,
  };
}

const PROPERTY_KEYS = Object.keys(PropertySchema.shape) as (keyof Property)[];

function summary(detail: PropertyDetail): Property {
  return Object.fromEntries(PROPERTY_KEYS.map((key) => [key, detail[key]])) as Property;
}

function invalid(issues: { path: PropertyKey[]; message: string }[]): never {
  const issue = issues[0];
  throw new ApiError(400, 'invalid_request', `${issue?.path.join('.') || 'request'}: ${issue?.message}`);
}

/** The database's own rules, so the demo refuses what the real API would. */
function checkListing(d: PropertyDetail): void {
  const refuse = (message: string) => {
    throw new ApiError(400, 'invalid_request', message);
  };
  if (d.minPriceMinor && d.maxPriceMinor && d.minPriceMinor > d.maxPriceMinor) {
    refuse('The lowest price is above the highest.');
  }
  if (d.maxNights !== null && d.maxNights < d.minNights)
    refuse('The shortest stay is longer than the longest.');
  if ((d.quietHoursStart === null) !== (d.quietHoursEnd === null))
    refuse('Give quiet hours a start and an end.');
}

function renumber(photos: PropertyDetail['photos']): void {
  photos.forEach((photo, position) => {
    photo.position = position;
  });
}

/** Demo mode's photo upload: the file stays in this browser instead of going to storage. */
export async function demoAddPhoto(
  orgId: string | null,
  propertyId: string,
  photo: { blob: Blob; width: number; height: number },
): Promise<PropertyDetail> {
  const { operator } = access(orgId, 'properties.write');
  const property = findProperty(operator, propertyId);
  if (property.photos.length >= PHOTO_MAX_COUNT) {
    throw new ApiError(409, 'too_many_photos', `A property can have up to ${PHOTO_MAX_COUNT} photos.`);
  }
  const id = crypto.randomUUID();
  await putDemoPhoto(id, photo.blob);
  property.photos.push({
    id,
    url: `demo-photo:${id}`,
    caption: null,
    position: property.photos.length,
    roomId: null,
    width: photo.width,
    height: photo.height,
  });
  property.updatedAt = new Date().toISOString();
  save();
  return resolved(property);
}

// The calendar -----------------------------------------------------------------------------------

async function demoCalendar(
  operator: DemoOperator,
  from: string,
  to: string,
  free: { from: string; to: string; guests: number | undefined } | null,
): Promise<Calendar> {
  sweepCleaning(operator);
  const { stays: allStays, blocks: allBlocks } = operator.calendar;
  // Free for the stay: no booking or block on any of its nights, and room for everyone.
  const freeFor = (p: PropertyDetail) =>
    !free ||
    ((free.guests === undefined || p.maxGuests >= free.guests) &&
      !allStays.some(
        (x) =>
          x.propertyId === p.id && x.status === 'confirmed' && x.checkIn < free.to && free.from < x.checkOut,
      ) &&
      !allBlocks.some((b) => b.propertyId === p.id && b.startsOn < free.to && free.from < b.endsOn));
  const properties = [...operator.properties].filter(freeFor).sort((a, b) => a.name.localeCompare(b.name));
  const ids = new Set(properties.map((p) => p.id));
  const covers: (string | null)[] = [];
  for (const property of properties) covers.push((await resolved(property)).coverPhotoUrl);
  const { nights, stays, blocks } = operator.calendar;
  return {
    from,
    to,
    today: todayIn(operator.workspace.settings.timeZone),
    properties: properties.map((p, index) => ({
      id: p.id,
      name: p.name,
      internalCode: p.internalCode,
      coverPhotoUrl: covers[index] ?? null,
      area: p.area,
      city: p.city,
      bedrooms: p.bedrooms,
      maxGuests: p.maxGuests,
      tags: p.tags,
      cleaning: operator.cleaning?.[p.id] ?? { status: 'clean', changedAt: null, changedBy: null },
      managedBy: p.managedBy,
      priceOwner: p.priceOwner,
      basePriceMinor: p.basePriceMinor,
      weekendPriceMinor: p.weekendPriceMinor,
      minPriceMinor: p.minPriceMinor,
      maxPriceMinor: p.maxPriceMinor,
      minNights: p.minNights,
      maxNights: p.maxNights,
    })),
    propertyCount: operator.properties.length,
    nights: nights
      .filter((n) => ids.has(n.propertyId) && n.night >= from && n.night <= to)
      .sort((a, b) => a.night.localeCompare(b.night)),
    // Stays leaving on the first day are included, as the API does: that day's turnover shows.
    // Cancelled bookings, enquiries and requests hold no nights, so the calendar leaves them out.
    stays: stays
      .filter(
        (x) =>
          ids.has(x.propertyId) &&
          (x.status === 'confirmed' || x.status === 'conflict') &&
          x.checkIn <= to &&
          x.checkOut >= from,
      )
      .sort((a, b) => a.checkIn.localeCompare(b.checkIn))
      .map(
        (x): CalendarStay => ({
          id: x.id,
          propertyId: x.propertyId,
          checkIn: x.checkIn,
          checkOut: x.checkOut,
          status: x.status === 'conflict' ? 'conflict' : 'confirmed',
          channel: x.channel,
          channelReference: x.channelReference,
          guestName: x.guestName,
          guests: x.adults + x.children,
        }),
      ),
    blocks: blocks
      .filter((b) => ids.has(b.propertyId) && b.startsOn <= to && b.endsOn > from)
      .sort((a, b) => a.startsOn.localeCompare(b.startsOn)),
  };
}

/** Consecutive nights as [first night, first free night) runs. Nights must be in order. */
function runs(nights: string[]): [string, string][] {
  const out: [string, string][] = [];
  for (const night of nights) {
    const last = out.at(-1);
    if (last && last[1] === night) last[1] = addDays(night, 1);
    else out.push([night, addDays(night, 1)]);
  }
  return out;
}

function listNames(properties: { name: string }[]): string {
  const all = properties.map((p) => p.name);
  if (all.length <= 2) return all.join(' and ');
  return `${all.slice(0, 2).join(', ')} and ${all.length - 2} more`;
}

const usualNight = (n: CalendarNight) =>
  n.priceMinor === null && n.minNights === null && !n.closedToArrival && !n.closedToDeparture;

/** The API's PATCH /v1/calendar, with its rules and messages, on this browser's sample data. */
function changeDemoCalendar(operator: DemoOperator, body: unknown): CalendarChangeResult {
  const parsed = CalendarChangeSchema.safeParse(body);
  if (!parsed.success) invalid(parsed.error.issues);
  const change = parsed.data;
  const { currency, locale, timeZone } = operator.workspace.settings;
  const today = todayIn(timeZone);
  if (change.firstNight < today) {
    throw new ApiError(400, 'nights_passed', 'Those nights have passed. Start from tonight or later.');
  }
  if (change.lastNight > addDays(today, CALENDAR_DAYS_AHEAD)) {
    throw new ApiError(400, 'too_far_ahead', 'Nights can be changed up to two years ahead.');
  }
  const ids = [...new Set(change.propertyIds)];
  const chosen = operator.properties
    .filter((p) => ids.includes(p.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (chosen.length !== ids.length) {
    throw new ApiError(404, 'property_not_found', "One of those properties isn't in this workspace.");
  }
  if (typeof change.priceMinor === 'number') {
    const price = change.priceMinor;
    const amount = (minor: number) => formatMoney({ amountMinor: minor, currency }, locale);
    const elsewhere = chosen.filter((p) => p.priceOwner !== 'v01');
    if (elsewhere.length) {
      throw new ApiError(
        409,
        'prices_set_in_pricelabs',
        `PriceLabs sets the prices for ${listNames(elsewhere)}, so they can't be changed here.`,
      );
    }
    for (const p of chosen) {
      if (p.minPriceMinor && price < p.minPriceMinor) {
        throw new ApiError(
          400,
          'below_lowest_price',
          `${amount(price)} is below the lowest price for ${p.name}, ${amount(p.minPriceMinor)}.`,
        );
      }
      if (p.maxPriceMinor && price > p.maxPriceMinor) {
        throw new ApiError(
          400,
          'above_highest_price',
          `${amount(price)} is above the highest price for ${p.name}, ${amount(p.maxPriceMinor)}.`,
        );
      }
    }
  }
  const nights = selectedNights(change.firstNight, change.lastNight, change.daysOfWeek);
  if (nights.length === 0) {
    throw new ApiError(400, 'no_nights', 'None of those nights fall on the chosen days of the week.');
  }

  const calendar = operator.calendar;
  const result: CalendarChangeResult = {
    changedNights: 0,
    blockedNights: 0,
    takenNights: 0,
    reopenedNights: 0,
  };
  const rules = {
    ...(change.priceMinor !== undefined ? { priceMinor: change.priceMinor } : {}),
    ...(change.minNights !== undefined ? { minNights: change.minNights } : {}),
    ...(change.closedToArrival !== undefined ? { closedToArrival: change.closedToArrival } : {}),
    ...(change.closedToDeparture !== undefined ? { closedToDeparture: change.closedToDeparture } : {}),
  };
  if (Object.keys(rules).length) {
    for (const property of chosen) {
      for (const night of nights) {
        const row = calendar.nights.find((n) => n.propertyId === property.id && n.night === night);
        const next: CalendarNight = {
          ...(row ?? {
            propertyId: property.id,
            night,
            priceMinor: null,
            minNights: null,
            closedToArrival: false,
            closedToDeparture: false,
          }),
          ...rules,
        };
        const same = row
          ? row.priceMinor === next.priceMinor &&
            row.minNights === next.minNights &&
            row.closedToArrival === next.closedToArrival &&
            row.closedToDeparture === next.closedToDeparture
          : usualNight(next);
        if (same) continue;
        result.changedNights += 1;
        if (row) Object.assign(row, next);
        else calendar.nights.push(next);
      }
    }
    // A night back on every usual rule keeps no row of its own.
    calendar.nights = calendar.nights.filter((n) => !usualNight(n));
  }

  const held = (propertyId: string, night: string) =>
    calendar.stays.some(
      (x) =>
        x.propertyId === propertyId && x.status === 'confirmed' && x.checkIn <= night && night < x.checkOut,
    ) || calendar.blocks.some((b) => b.propertyId === propertyId && b.startsOn <= night && night < b.endsOn);

  if (change.blocked === true) {
    for (const property of chosen) {
      const free = nights.filter((night) => !held(property.id, night));
      result.takenNights += nights.length - free.length;
      for (const [startsOn, endsOn] of runs(free)) {
        result.blockedNights += nightsBetween(startsOn, endsOn);
        calendar.blocks.push({
          id: crypto.randomUUID(),
          propertyId: property.id,
          startsOn,
          endsOn,
          reason: change.blockReason || null,
        });
      }
    }
  } else if (change.blocked === false) {
    const opening = new Set(nights);
    const kept: CalendarBlock[] = [];
    for (const block of calendar.blocks) {
      const all = ids.includes(block.propertyId) ? eachNight(block.startsOn, block.endsOn) : [];
      const reopened = all.filter((night) => opening.has(night)).length;
      if (reopened === 0) {
        kept.push(block);
        continue;
      }
      result.reopenedNights += reopened;
      for (const [startsOn, endsOn] of runs(all.filter((night) => !opening.has(night)))) {
        kept.push({
          id: crypto.randomUUID(),
          propertyId: block.propertyId,
          startsOn,
          endsOn,
          reason: block.reason,
        });
      }
    }
    calendar.blocks = kept;
  }
  return result;
}

// Routes ---------------------------------------------------------------------------------------

const pause = () => new Promise((resolve) => setTimeout(resolve, 120));
const OPERATOR_PATH = /^\/v1\/console\/operators\/([0-9a-f-]{36})$/;
const START_PATH = /^\/v1\/console\/operators\/([0-9a-f-]{36})\/support-access$/;
const END_PATH = /^\/v1\/console\/support-access\/([0-9a-f-]{36})\/end$/;
// Reservations -----------------------------------------------------------------------------------

const RESERVATION_PATH = /^\/v1\/reservations\/([0-9a-f-]{36})$/;
const CLEANING_PATH = /^\/v1\/properties\/([0-9a-f-]{36})\/cleaning$/;
const CHANNEX_PATH = /^\/v1\/properties\/([0-9a-f-]{36})\/channex$/;

function reservationSummary(operator: DemoOperator, x: DemoStay): ReservationSummary {
  return {
    id: x.id,
    propertyId: x.propertyId,
    propertyName: operator.properties.find((p) => p.id === x.propertyId)?.name ?? '',
    status: x.status,
    channel: x.channel,
    channelReference: x.channelReference,
    checkIn: x.checkIn,
    checkOut: x.checkOut,
    guestName: x.guestName,
    adults: x.adults,
    children: x.children,
    infants: x.infants,
    currency: x.currency,
    totalMinor: x.totalMinor,
    createdAt: x.createdAt,
  };
}

function toReservation(operator: DemoOperator, x: DemoStay): Reservation {
  const property = operator.properties.find((p) => p.id === x.propertyId);
  return {
    ...reservationSummary(operator, x),
    propertyCode: property?.internalCode ?? null,
    propertyCheckInTime: property?.checkInTime ?? '15:00',
    propertyCheckOutTime: property?.checkOutTime ?? '10:00',
    checkInTime: x.checkInTime,
    checkOutTime: x.checkOutTime,
    guestEmail: x.guestEmail,
    guestPhone: x.guestPhone,
    payoutMinor: x.payoutMinor,
    notes: x.notes,
    cancelledAt: x.cancelledAt,
    updatedAt: x.updatedAt,
    today: todayIn(operator.workspace.settings.timeZone),
  };
}

/** The API's GET /v1/reservations: upcoming (staying now included), past or cancelled, searched. */
function demoReservations(operator: DemoOperator, query: Record<string, string>): ReservationList {
  const parsed = ReservationListQuerySchema.safeParse(query);
  if (!parsed.success) invalid(parsed.error.issues);
  const { view, q } = parsed.data;
  const today = todayIn(operator.workspace.settings.timeZone);
  const words = q?.toLowerCase() ?? '';
  const nameOf = (x: DemoStay) => operator.properties.find((p) => p.id === x.propertyId)?.name ?? '';
  const matching = operator.calendar.stays.filter((x) => {
    const inView =
      view === 'cancelled'
        ? x.status === 'cancelled'
        : x.status !== 'cancelled' && (view === 'past' ? x.checkOut < today : x.checkOut >= today);
    if (!inView) return false;
    if (!words) return true;
    return [x.guestName ?? '', x.channelReference ?? '', nameOf(x)].some((v) =>
      v.toLowerCase().includes(words),
    );
  });
  matching.sort((a, b) =>
    view === 'upcoming'
      ? a.checkIn.localeCompare(b.checkIn) || a.createdAt.localeCompare(b.createdAt)
      : view === 'past'
        ? b.checkIn.localeCompare(a.checkIn)
        : (b.cancelledAt ?? b.updatedAt).localeCompare(a.cancelledAt ?? a.updatedAt),
  );
  return {
    today,
    reservations: matching.slice(0, RESERVATION_LIST_LIMIT).map((x) => reservationSummary(operator, x)),
    more: matching.length > RESERVATION_LIST_LIMIT,
  };
}

function findStay(operator: DemoOperator, id: string): DemoStay {
  const stay = operator.calendar.stays.find((x) => x.id === id);
  if (!stay) {
    throw new ApiError(404, 'reservation_not_found', 'That booking does not exist in this workspace.');
  }
  return stay;
}

/** The API's PATCH /v1/reservations/:id: contact details, agreed times and notes. */
function changeDemoReservation(operator: DemoOperator, id: string, body: unknown): Reservation {
  const stay = findStay(operator, id);
  const parsed = ReservationUpdateSchema.safeParse(body);
  if (!parsed.success) invalid(parsed.error.issues);
  const change = parsed.data;
  const orNull = (v: string | null | undefined) => (v === undefined ? undefined : v || null);
  const next = {
    guestName: orNull(change.guestName),
    guestEmail: orNull(change.guestEmail),
    guestPhone: orNull(change.guestPhone),
    checkInTime: change.checkInTime,
    checkOutTime: change.checkOutTime,
    notes: orNull(change.notes),
  };
  for (const [key, value] of Object.entries(next)) {
    if (value !== undefined) Object.assign(stay, { [key]: value });
  }
  stay.updatedAt = new Date().toISOString();
  save();
  return toReservation(operator, stay);
}

const PROPERTY_PATH =
  /^\/v1\/properties\/([0-9a-f-]{36})(\/rooms|\/amenities|\/photos\/order|\/archive|\/fields)?$/;
const FIELD_PATH = /^\/v1\/custom-fields(?:\/([0-9a-f-]{36}))?$/;
const ACCOUNT_PATH = /^\/v1\/channel-accounts(?:\/([0-9a-f-]{36})(\/connect|\/listings)?)?$/;
const LINK_PATH = /^\/v1\/properties\/([0-9a-f-]{36})\/links(?:\/([0-9a-f-]{36})(\/pause|\/resume)?)?$/;
const PHOTO_PATH = /^\/v1\/properties\/([0-9a-f-]{36})\/photos\/([0-9a-f-]{36})$/;

export async function demoFetch<T>(
  path: string,
  options: { orgId?: string | null; method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'; body?: unknown },
): Promise<T> {
  await pause();
  const method = options.method ?? 'GET';
  const s = load();

  if (method === 'GET' && path === '/v1/me') {
    const me: Me = {
      user: { id: DEMO_USER.id, email: DEMO_USER.email, fullName: 'Demo user' },
      memberships: s.operators
        .filter((o) => o.role !== null)
        .map((o) => ({
          organisationId: o.workspace.organisation.id,
          organisationName: o.workspace.organisation.name,
          role: o.role as MemberRole,
        })),
      platformRole: 'owner',
      supportAccess: s.grants
        .filter((g) => g.staffEmail === DEMO_USER.email && isOpen(g))
        .map((g) => ({
          grantId: g.id,
          organisationId: g.organisationId,
          organisationName: findOperator(g.organisationId)?.workspace.organisation.name ?? '',
          expiresAt: g.expiresAt,
        })),
    };
    return me as T;
  }

  if (method === 'GET' && path === '/v1/workspace') {
    const { operator, role } = access(options.orgId, 'workspace.read');
    return { ...operator.workspace, role } as T;
  }

  if (method === 'GET' && path === '/v1/workspace/support-visits') {
    const { operator } = access(options.orgId, 'workspace.read');
    const visits: SupportVisitList = {
      visits: grantsNewestFirst(operator.workspace.organisation.id).map((g) => ({
        id: g.id,
        staffEmail: g.staffEmail,
        reason: g.reason,
        startedAt: g.startedAt,
        expiresAt: g.expiresAt,
        endedAt: g.endedAt,
      })),
    };
    return visits as T;
  }

  if (method === 'GET' && path === '/v1/properties') {
    const { operator } = access(options.orgId, 'properties.read');
    const sorted = [...operator.properties].sort((a, b) => a.name.localeCompare(b.name));
    const list: PropertyList = { properties: [] };
    for (const property of sorted) list.properties.push(summary(await resolved(property)));
    return list as T;
  }

  if (method === 'POST' && path === '/v1/properties') {
    const { operator } = access(options.orgId, 'properties.write');
    const parsed = PropertyCreateSchema.safeParse(options.body);
    if (!parsed.success) invalid(parsed.error.issues);
    const input = parsed.data;
    if (input.internalCode && operator.properties.some((p) => p.internalCode === input.internalCode)) {
      throw new ApiError(409, 'code_in_use', `Another property already uses ${input.internalCode}.`);
    }
    const now = new Date().toISOString();
    const created: PropertyDetail = {
      id: crypto.randomUUID(),
      name: input.name,
      internalCode: input.internalCode ?? null,
      addressLine1: input.addressLine1 ?? null,
      city: input.city ?? null,
      postcode: input.postcode ?? null,
      countryCode: input.countryCode,
      area: input.area ?? null,
      propertyType: input.propertyType ?? null,
      spaceType: input.spaceType ?? 'entire_place',
      bedrooms: input.bedrooms ?? null,
      beds: input.beds ?? null,
      bathrooms: input.bathrooms ?? null,
      maxGuests: input.maxGuests,
      checkInTime: input.checkInTime ?? '15:00',
      checkOutTime: input.checkOutTime ?? '10:00',
      // Added in V-01, so nothing is connected yet (the API does the same).
      managedBy: 'none',
      priceOwner: input.priceOwner ?? 'v01',
      minPriceMinor: input.minPriceMinor ?? null,
      maxPriceMinor: input.maxPriceMinor ?? null,
      coverPhotoUrl: null,
      photoCount: 0,
      channexStatus: 'not_connected',
      tags: [],
      createdAt: now,
      ...listingDefaults(),
      title: input.title ?? null,
      summary: input.summary ?? null,
      basePriceMinor: input.basePriceMinor ?? null,
      cleaningFeeMinor: input.cleaningFeeMinor ?? null,
      amenities: [...(input.amenities ?? [])].sort(),
      updatedAt: now,
    };
    operator.properties.push(created);
    save();
    return (await resolved(created)) as T;
  }

  const propertyMatch = PROPERTY_PATH.exec(path);
  if (propertyMatch?.[1]) {
    const [, id, part] = propertyMatch;
    if (method === 'GET' && !part) {
      const { operator, role } = access(options.orgId, 'properties.read');
      return (await resolved(findProperty(operator, id), operator, role)) as T;
    }
    const { operator, role } = access(options.orgId, 'properties.write');
    const property = findProperty(operator, id);

    if (method === 'PUT' && part === '/fields') {
      const parsed = PropertyFieldsUpdateSchema.safeParse(options.body);
      if (!parsed.success) invalid(parsed.error.issues);
      const values = { ...(operator.fieldValues[property.id] ?? {}) };
      for (const [fieldId, value] of Object.entries(parsed.data.values)) {
        const field = operator.fields.find((f) => f.id === fieldId);
        if (!field)
          throw new ApiError(404, 'field_not_found', 'One of those fields does not exist in this workspace.');
        if (value && field.kind === 'link' && !isWebAddress(value)) {
          throw new ApiError(
            422,
            'not_a_link',
            `"${field.name}" needs a web address starting with https://.`,
          );
        }
        if (value && field.kind === 'secret' && !can(role, 'secrets.read')) {
          throw new ApiError(403, 'not_allowed', 'Your role does not allow setting secrets.');
        }
        if (value) values[fieldId] = value;
        else delete values[fieldId];
      }
      operator.fieldValues[property.id] = values;
      save();
      return { fields: fieldsOf(operator, property.id, role) } as T;
    }

    if (method === 'POST' && part === '/archive') {
      operator.properties = operator.properties.filter((p) => p.id !== property.id);
      operator.calendar.stays = operator.calendar.stays.filter((st) => st.propertyId !== property.id);
      operator.calendar.blocks = operator.calendar.blocks.filter((bl) => bl.propertyId !== property.id);
      save();
      return { archivedAt: new Date().toISOString() } as T;
    }

    if (method === 'PATCH' && !part) {
      const parsed = PropertyUpdateSchema.safeParse(options.body);
      if (!parsed.success) invalid(parsed.error.issues);
      const changes: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(parsed.data)) {
        if (value === undefined) continue;
        changes[key] = typeof value === 'string' && value.trim() === '' ? null : value;
      }
      if (changes.name === null) throw new ApiError(400, 'invalid_request', 'A property needs a name.');
      const code = changes.internalCode;
      if (
        typeof code === 'string' &&
        operator.properties.some((p) => p.id !== id && p.internalCode === code)
      ) {
        throw new ApiError(409, 'code_in_use', `Another property already uses ${code}.`);
      }
      const next = { ...property, ...changes } as PropertyDetail;
      checkListing(next);
      Object.assign(property, changes, { updatedAt: new Date().toISOString() });
    } else if (method === 'PUT' && part === '/rooms') {
      const parsed = RoomsUpdateSchema.safeParse(options.body);
      if (!parsed.success) invalid(parsed.error.issues);
      const known = new Set(property.rooms.map((r) => r.id));
      const used = new Set<string>();
      property.rooms = parsed.data.rooms.map((room) => {
        const keep = room.id && known.has(room.id) && !used.has(room.id) ? room.id : crypto.randomUUID();
        used.add(keep);
        return {
          id: keep,
          kind: room.kind,
          name: room.name?.trim() || null,
          beds: room.beds,
          privateBathroom: room.privateBathroom,
        };
      });
      for (const photo of property.photos) {
        if (photo.roomId && !used.has(photo.roomId)) photo.roomId = null;
      }
      if (property.rooms.length > 0) {
        property.bedrooms = property.rooms.filter((r) => r.kind === 'bedroom').length;
        property.beds = countBeds(property.rooms);
      }
      property.updatedAt = new Date().toISOString();
    } else if (method === 'PUT' && part === '/amenities') {
      const parsed = AmenitiesUpdateSchema.safeParse(options.body);
      const codes = parsed.success ? AmenityCodesSchema.safeParse(parsed.data.amenities) : null;
      if (!codes?.success) {
        throw new ApiError(400, 'invalid_request', 'One of those amenities is not on the list.');
      }
      property.amenities = [...codes.data].sort();
      property.updatedAt = new Date().toISOString();
    } else if (method === 'PUT' && part === '/photos/order') {
      const parsed = PhotoOrderSchema.safeParse(options.body);
      if (!parsed.success) invalid(parsed.error.issues);
      const wanted = parsed.data.photoIds;
      const byId = new Map(property.photos.map((photo) => [photo.id, photo]));
      if (wanted.length !== property.photos.length || wanted.some((photoId) => !byId.has(photoId))) {
        throw new ApiError(
          409,
          'photos_changed',
          'The photos changed while you were ordering them. Try again.',
        );
      }
      property.photos = wanted.map((photoId) => byId.get(photoId) as PropertyDetail['photos'][number]);
      renumber(property.photos);
      property.updatedAt = new Date().toISOString();
    } else {
      throw new ApiError(404, 'not_found', 'No such endpoint.');
    }
    save();
    return (await resolved(property)) as T;
  }

  const photoMatch = PHOTO_PATH.exec(path);
  if (photoMatch?.[1] && photoMatch[2]) {
    const [, id, photoId] = photoMatch;
    const { operator } = access(options.orgId, 'properties.write');
    const property = findProperty(operator, id);
    const photo = property.photos.find((p) => p.id === photoId);
    if (!photo) throw new ApiError(404, 'photo_not_found', 'That photo is not on this property.');
    if (method === 'PATCH') {
      const parsed = PhotoUpdateSchema.safeParse(options.body);
      if (!parsed.success) invalid(parsed.error.issues);
      const { caption, roomId } = parsed.data;
      if (roomId && !property.rooms.some((r) => r.id === roomId)) {
        throw new ApiError(400, 'invalid_request', 'That room is not in this property.');
      }
      if (caption !== undefined) photo.caption = caption?.trim() || null;
      if (roomId !== undefined) photo.roomId = roomId;
    } else if (method === 'DELETE') {
      property.photos = property.photos.filter((p) => p.id !== photoId);
      renumber(property.photos);
      void deleteDemoPhoto(photoId);
    } else {
      throw new ApiError(404, 'not_found', 'No such endpoint.');
    }
    property.updatedAt = new Date().toISOString();
    save();
    return (await resolved(property)) as T;
  }

  if (method === 'GET' && path.startsWith('/v1/calendar?')) {
    const { operator } = access(options.orgId, 'calendar.read');
    const query = Object.fromEntries(new URLSearchParams(path.slice(path.indexOf('?') + 1)));
    const parsed = CalendarQuerySchema.safeParse(query);
    if (!parsed.success) invalid(parsed.error.issues);
    const { from, to, freeFrom, freeTo, guests } = parsed.data;
    const free = freeFrom && freeTo ? { from: freeFrom, to: freeTo, guests } : null;
    return (await demoCalendar(operator, from, to, free)) as T;
  }

  if (method === 'PATCH' && path === '/v1/calendar') {
    const { operator } = access(options.orgId, 'calendar.write');
    const result = changeDemoCalendar(operator, options.body);
    save();
    return result as T;
  }

  if (method === 'GET' && (path === '/v1/reservations' || path.startsWith('/v1/reservations?'))) {
    const { operator } = access(options.orgId, 'reservations.read');
    const query = Object.fromEntries(new URLSearchParams(path.split('?')[1] ?? ''));
    return demoReservations(operator, query) as T;
  }

  if (method === 'GET' && path === '/v1/channels/sync') {
    const { operator } = access(options.orgId, 'channels.read');
    return {
      outboxWaiting: operator.live.outboxWaiting,
      outboxFailed: operator.live.outboxFailed,
      oldestWaitingAt: agoOrNull(operator.live.oldestWaitingMinutes),
      lastSentAt: agoOrNull(operator.live.lastSentMinutes),
      lastBookingAt: agoOrNull(operator.live.lastWebhookMinutes),
      recent: operator.links
        .filter((l) => l.status === 'live')
        .slice(0, 6)
        .map((l, i) => ({
          id: i + 1,
          at: l.requestedAt,
          propertyName: operator.properties.find((p) => p.id === l.propertyId)?.name ?? null,
          direction: 'out',
          kind: 'link',
          status: 'ok',
          message: operator.channelAccounts.find((a) => a.id === l.accountId)?.label ?? null,
        })),
    } as T;
  }

  const accountMatch = ACCOUNT_PATH.exec(path);
  if (accountMatch) {
    const [, accountId, part] = accountMatch;
    if (method === 'GET' && !accountId) {
      const { operator } = access(options.orgId, 'channels.read');
      settleLinks(operator);
      return { accounts: operator.channelAccounts.map((a) => toAccount(operator, a)) } as T;
    }
    if (method === 'POST' && !accountId) {
      const { operator } = access(options.orgId, 'channels.manage');
      const parsed = ChannelAccountCreateSchema.safeParse(options.body);
      if (!parsed.success) invalid(parsed.error.issues);
      if (operator.channelAccounts.some((a) => a.label.toLowerCase() === parsed.data.label.toLowerCase()))
        throw new ApiError(
          409,
          'account_exists',
          `There is already an account called "${parsed.data.label}".`,
        );
      const made = account(
        parsed.data.channel,
        parsed.data.label,
        'disconnected',
        parsed.data.loginHolder ?? null,
        null,
      );
      operator.channelAccounts.push(made);
      save();
      return toAccount(operator, made) as T;
    }
    if (method === 'GET' && part === '/listings') {
      const { operator } = access(options.orgId, 'channels.read');
      const a = operator.channelAccounts.find((x) => x.id === accountId);
      if (!a)
        throw new ApiError(
          404,
          'account_not_found',
          'That channel account does not exist in this workspace.',
        );
      settleLinks(operator);
      return {
        listings: a.listings.map((l) => {
          const link = operator.links.find(
            (x) =>
              x.accountId === a.id &&
              x.externalListingId === l.externalListingId &&
              (x.status === 'live' || x.status === 'linking'),
          );
          const property = link ? operator.properties.find((p) => p.id === link.propertyId) : undefined;
          return {
            externalListingId: l.externalListingId,
            title: l.title,
            url: listingUrl(a.channel, l.externalListingId),
            linkedPropertyId: property?.id ?? null,
            linkedPropertyName: property?.name ?? null,
            seenAt: new Date(Date.now() - 25 * 60_000).toISOString(),
          };
        }),
      } as T;
    }
    if (method === 'POST' && part === '/connect') {
      const { operator } = access(options.orgId, 'channels.manage');
      const a = operator.channelAccounts.find((x) => x.id === accountId);
      if (!a)
        throw new ApiError(
          404,
          'account_not_found',
          'That channel account does not exist in this workspace.',
        );
      const parsed = ChannelAccountConnectSchema.safeParse(options.body ?? {});
      if (!parsed.success) invalid(parsed.error.issues);
      if (a.status === 'connected')
        throw new ApiError(409, 'already_connected', `${a.label} is already connected.`);
      if (a.channel === 'booking_com' && !parsed.data.hotelId && !a.externalAccountId)
        throw new ApiError(422, 'hotel_id_required', "Booking.com needs the account's hotel id to connect.");
      if (!operator.properties.some((p) => p.channex.status === 'connected'))
        throw new ApiError(409, 'no_properties_connected', 'Connect at least one property to Channex first.');
      a.status = 'pending';
      a.requestedAt = new Date().toISOString();
      if (parsed.data.hotelId) a.externalAccountId = parsed.data.hotelId;
      a.connectUrl =
        a.channel === 'booking_com'
          ? null
          : `https://connect.channex.example/${a.channel}/${a.id.slice(0, 8)}`;
      save();
      return toAccount(operator, a) as T;
    }
  }

  const linkMatch = LINK_PATH.exec(path);
  if (linkMatch?.[1]) {
    const [, propertyId, linkId, pauseAction] = linkMatch;
    if (method === 'POST' && linkId && pauseAction) {
      const { operator } = access(options.orgId, 'properties.write');
      const link = operator.links.find(
        (l) => l.id === linkId && l.propertyId === propertyId && l.status === 'live',
      );
      if (!link) throw new ApiError(404, 'link_not_found', 'That link is not live.');
      const a = operator.channelAccounts.find((x) => x.id === link.accountId);
      if (a?.channel !== 'airbnb')
        throw new ApiError(
          409,
          'not_on_this_channel',
          `${CHANNEL_LABELS[a?.channel ?? 'booking_com']} listings are paused on the channel itself for now.`,
        );
      link.publishedWanted = pauseAction === '/resume';
      link.pausedAt = new Date().toISOString();
      save();
      return { links: linksOf(operator, propertyId) } as T;
    }
    if (method === 'GET') {
      const { operator } = access(options.orgId, 'channels.read');
      return { links: linksOf(operator, propertyId) } as T;
    }
    const { operator } = access(options.orgId, 'properties.write');
    const property = findProperty(operator, propertyId);
    if (method === 'POST' && !linkId) {
      const parsed = PropertyLinkCreateSchema.safeParse(options.body);
      if (!parsed.success) invalid(parsed.error.issues);
      const a = operator.channelAccounts.find((x) => x.id === parsed.data.channelAccountId);
      if (!a)
        throw new ApiError(
          404,
          'account_not_found',
          'That channel account does not exist in this workspace.',
        );
      if (a.status !== 'connected')
        throw new ApiError(409, 'account_not_connected', `${a.label} isn't connected yet.`);
      if (property.channex.status !== 'connected')
        throw new ApiError(409, 'property_not_connected', 'Connect the property to Channex first.');
      if (
        operator.links.some(
          (l) =>
            l.propertyId === property.id &&
            l.status !== 'archived' &&
            operator.channelAccounts.find((x) => x.id === l.accountId)?.channel === a.channel,
        )
      )
        throw new ApiError(
          409,
          'channel_taken',
          `This property already has a ${CHANNEL_LABELS[a.channel]} listing linked. Unlink it first.`,
        );
      const taken = operator.links.find(
        (l) =>
          l.accountId === a.id &&
          l.externalListingId === parsed.data.externalListingId &&
          l.status !== 'archived',
      );
      if (taken) {
        const other = operator.properties.find((p) => p.id === taken.propertyId);
        throw new ApiError(
          409,
          'listing_taken',
          `That listing is already linked to ${other?.name ?? 'another property'}.`,
        );
      }
      operator.links.push({
        id: crypto.randomUUID(),
        propertyId: property.id,
        accountId: a.id,
        externalListingId: parsed.data.externalListingId,
        status: 'linking',
        liveFrom: null,
        requestedAt: new Date().toISOString(),
      });
      save();
      return { links: linksOf(operator, property.id) } as T;
    }
    if (method === 'DELETE' && linkId) {
      const link = operator.links.find(
        (l) =>
          l.id === linkId && l.propertyId === property.id && (l.status === 'live' || l.status === 'linking'),
      );
      if (!link) throw new ApiError(404, 'link_not_found', 'That link does not exist, or is already gone.');
      link.status = 'closing';
      link.requestedAt = new Date().toISOString();
      save();
      return { links: linksOf(operator, property.id) } as T;
    }
  }

  const fieldMatch = FIELD_PATH.exec(path);
  if (fieldMatch) {
    const fieldId = fieldMatch[1];
    if (method === 'GET' && !fieldId) {
      const { operator } = access(options.orgId, 'properties.read');
      return { fields: operator.fields } as T;
    }
    const { operator } = access(options.orgId, 'fields.manage');
    const taken = (name: string, except?: string) =>
      operator.fields.some((f) => f.id !== except && f.name.toLowerCase() === name.toLowerCase());
    if (method === 'POST' && !fieldId) {
      const parsed = CustomFieldCreateSchema.safeParse(options.body);
      if (!parsed.success) invalid(parsed.error.issues);
      if (operator.fields.length >= FIELDS_MAX)
        throw new ApiError(409, 'too_many_fields', `A workspace can have ${FIELDS_MAX} custom fields.`);
      if (taken(parsed.data.name))
        throw new ApiError(409, 'field_exists', `There is already a field called "${parsed.data.name}".`);
      const field: CustomField = {
        id: crypto.randomUUID(),
        ...parsed.data,
        position: operator.fields.length,
      };
      operator.fields.push(field);
      save();
      return field as T;
    }
    const field = operator.fields.find((f) => f.id === fieldId);
    if (!field) throw new ApiError(404, 'field_not_found', 'That field does not exist in this workspace.');
    if (method === 'PATCH') {
      const parsed = CustomFieldUpdateSchema.safeParse(options.body);
      if (!parsed.success) invalid(parsed.error.issues);
      if (parsed.data.name !== undefined) {
        if (taken(parsed.data.name, field.id))
          throw new ApiError(409, 'field_exists', `There is already a field called "${parsed.data.name}".`);
        field.name = parsed.data.name;
      }
      if (parsed.data.position !== undefined) {
        const rest = operator.fields.filter((f) => f.id !== field.id);
        rest.splice(Math.min(parsed.data.position, rest.length), 0, field);
        rest.forEach((f, index) => {
          f.position = index;
        });
        operator.fields = rest;
      }
      save();
      return field as T;
    }
    if (method === 'DELETE') {
      operator.fields = operator.fields.filter((f) => f.id !== field.id);
      operator.fields.forEach((f, index) => {
        f.position = index;
      });
      for (const values of Object.values(operator.fieldValues)) delete values[field.id];
      save();
      return { deleted: true } as T;
    }
  }

  if (method === 'POST' && path === '/v1/channex/connect-all') {
    const { operator } = access(options.orgId, 'channels.manage');
    const result = { queued: 0, alreadyConnected: 0, alreadyConnecting: 0 };
    for (const property of operator.properties) {
      const state = channexOf(property);
      if (state.status === 'connected') result.alreadyConnected += 1;
      else if (state.status === 'connecting') result.alreadyConnecting += 1;
      else {
        property.channex = {
          ...NOT_CONNECTED,
          status: 'connecting',
          requestedBy: 'Demo user',
          requestedAt: new Date().toISOString(),
        };
        result.queued += 1;
      }
    }
    save();
    return result as T;
  }

  const channexMatch = CHANNEX_PATH.exec(path);
  if (method === 'POST' && channexMatch?.[1]) {
    const { operator } = access(options.orgId, 'channels.manage');
    const property = findProperty(operator, channexMatch[1]);
    const current = channexOf(property);
    if (current.status === 'connected') {
      throw new ApiError(409, 'already_connected', 'This property is already connected to Channex.');
    }
    if (current.status === 'connecting') return current as T;
    property.channex = {
      ...NOT_CONNECTED,
      status: 'connecting',
      requestedBy: 'Demo user',
      requestedAt: new Date().toISOString(),
    };
    save();
    return property.channex as T;
  }

  const cleaningMatch = CLEANING_PATH.exec(path);
  if (method === 'PUT' && cleaningMatch?.[1]) {
    const { operator } = access(options.orgId, 'cleaning.write');
    const property = findProperty(operator, cleaningMatch[1]);
    const parsed = CleaningUpdateSchema.safeParse(options.body);
    if (!parsed.success) invalid(parsed.error.issues);
    const marked: CleaningState = {
      status: parsed.data.status,
      changedAt: new Date().toISOString(),
      changedBy: 'Demo user',
    };
    operator.cleaning = { ...operator.cleaning, [property.id]: marked };
    save();
    return marked as T;
  }

  const reservationMatch = RESERVATION_PATH.exec(path);
  if (reservationMatch?.[1]) {
    if (method === 'GET') {
      const { operator } = access(options.orgId, 'reservations.read');
      return toReservation(operator, findStay(operator, reservationMatch[1])) as T;
    }
    if (method === 'PATCH') {
      const { operator } = access(options.orgId, 'reservations.write');
      return changeDemoReservation(operator, reservationMatch[1], options.body) as T;
    }
  }

  // The V-01 console: the demo user is a V-01 owner.
  if (method === 'GET' && path === '/v1/console/overview') return overview() as T;
  if (method === 'GET' && path === '/v1/console/operators') {
    const list: ConsoleOperatorList = {
      operators: [...s.operators]
        .sort((a, b) => a.workspace.organisation.name.localeCompare(b.workspace.organisation.name))
        .map(toConsoleOperator),
    };
    return list as T;
  }
  const operatorMatch = OPERATOR_PATH.exec(path);
  if (method === 'GET' && operatorMatch?.[1]) return operatorDetail(operatorMatch[1]) as T;
  if (method === 'GET' && path === '/v1/console/sync') return sync() as T;
  if (method === 'GET' && path === '/v1/console/support') {
    const log: SupportGrantList = { grants: grantsNewestFirst().map(toGrant) };
    return log as T;
  }

  const startMatch = START_PATH.exec(path);
  if (method === 'POST' && startMatch?.[1]) {
    const orgId = startMatch[1];
    if (!findOperator(orgId))
      throw new ApiError(404, 'operator_not_found', 'There is no operator with that id.');
    const parsed = SupportAccessStartSchema.safeParse(options.body);
    if (!parsed.success) {
      throw new ApiError(400, 'invalid_request', parsed.error.issues[0]?.message ?? 'Check the request.');
    }
    const now = Date.now();
    for (const g of s.grants) {
      if (g.organisationId === orgId && g.staffEmail === DEMO_USER.email && isOpen(g, now)) {
        g.endedAt = new Date(now).toISOString();
      }
    }
    const grant: DemoGrant = {
      id: crypto.randomUUID(),
      organisationId: orgId,
      staffEmail: DEMO_USER.email,
      reason: parsed.data.reason,
      startedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + parsed.data.minutes * MINUTE).toISOString(),
      endedAt: null,
      requests: 0,
    };
    s.grants.push(grant);
    save();
    return toGrant(grant) as T;
  }

  const endMatch = END_PATH.exec(path);
  if (method === 'POST' && endMatch?.[1]) {
    const grant = s.grants.find((g) => g.id === endMatch[1]);
    if (!grant || !isOpen(grant)) return { ended: false } as T;
    grant.endedAt = new Date().toISOString();
    save();
    return { ended: true } as T;
  }

  throw new ApiError(404, 'not_found', 'No such endpoint.');
}
