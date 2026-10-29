import type { Session } from '@supabase/supabase-js';
import {
  AmenitiesUpdateSchema,
  AmenityCodesSchema,
  addDays,
  BrandUpdateSchema,
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
  type Charge,
  ChargeCreateSchema,
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
  type DailyOverview,
  DamageReportSchema,
  eachNight,
  FIELDS_MAX,
  formatMoney,
  type GuestLink,
  type GuestStay,
  type Invitation,
  InviteSchema,
  isWebAddress,
  LOW_BATTERY,
  LockConnectSchema,
  LockUpdateSchema,
  listingUrl,
  longDay,
  type Me,
  type MemberRole,
  MemberRoleUpdateSchema,
  type Message,
  MessageSendSchema,
  type MessageTemplate,
  MessageTemplateCreateSchema,
  MessageTemplateUpdateSchema,
  type MessageVia,
  MeUpdateSchema,
  monthWeeks,
  nightRules,
  nightsBetween,
  type OverviewRange,
  type Payment,
  PaymentCreateSchema,
  type Permission,
  PHOTO_MAX_COUNT,
  PhotoOrderSchema,
  type PhotoStage,
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
  previousMonth,
  RESERVATION_LIST_LIMIT,
  type Reservation,
  ReservationCancelSchema,
  ReservationCreateSchema,
  type ReservationList,
  ReservationListQuerySchema,
  type ReservationStatus,
  type ReservationSummary,
  ReservationUpdateSchema,
  type Revenue,
  RoomsUpdateSchema,
  renderTemplate,
  SUPPORT_ROLE,
  SupportAccessStartSchema,
  type SupportGrant,
  type SupportGrantList,
  type SupportVisitList,
  selectedNights,
  type Task,
  TaskCreateSchema,
  type TaskList,
  TaskListQuerySchema,
  type TaskTemplate,
  TaskTemplateUpdateSchema,
  TaskUpdateSchema,
  type TeamList,
  type Thread,
  type ThreadDetail,
  type ThreadList,
  ThreadListQuerySchema,
  ThreadUpdateSchema,
  type Today,
  type TodayStay,
  type Trends,
  todayIn,
  type Workspace,
  type WorkspaceRole,
} from '@v01/shared';
import {
  connectDemoLocks,
  type DemoLocks,
  demoDoorCode,
  demoJobCode,
  demoLocksView,
  demoStayCodes,
  emptyLocks,
} from './demo-locks.ts';
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
  /** Demo only: the role before "see it as the field team" was switched on. */
  originalRole?: MemberRole;
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
  /** Tasks for the field team, and what each kind starts with. Missing in older saved states. */
  tasks?: Task[];
  taskTemplates?: TaskTemplate[];
  /** Open invitations to the team. Missing in older saved states. */
  invitations?: Invitation[];
  /** The Inbox: a thread per booking, and the automatic messages and saved replies. Missing in older saved states. */
  threads?: DemoThread[];
  messageTemplates?: MessageTemplate[];
  /** The workspace's custom fields, in order. */
  fields: CustomField[];
  /** Values by property id, then field id. Secrets sit here as typed: the demo has no database. */
  fieldValues: Record<string, Record<string, string>>;
  /** The pretend TTLock account and its locks. Missing in older saved states. */
  locks?: DemoLocks;
}

const locksOf = (operator: DemoOperator): DemoLocks => (operator.locks ??= emptyLocks());

/** A stay's door codes in the demo, as the worker would have them on the locks by now. */
function stayCodes(operator: DemoOperator, stay: DemoStay, reveal: boolean) {
  const property = operator.properties.find((p) => p.id === stay.propertyId);
  if (!property) return [];
  const tz = operator.workspace.settings.timeZone;
  return demoStayCodes(locksOf(operator), stay, property, tz, todayIn(tz), reveal);
}

/** A booking's conversation, as the API keeps it; the counts are worked out from the messages. */
interface DemoThread {
  id: string;
  reservationId: string;
  status: 'open' | 'done';
  /** Messages from the guest nobody has opened yet. */
  unread: number;
  /** The sample conversation for this guest has been laid in. */
  seeded: boolean;
  messages: Message[];
}

/** A booking as the API keeps it: what the calendar shows, and what the reservation page adds. */
interface DemoStay extends Omit<CalendarStay, 'status'> {
  status: ReservationStatus;
  /** The key in the guest's link, made the first time the link is asked for. */
  guestKey?: string;
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
  /** Money for the record, and why the team cancelled it. Missing in older saved states. */
  charges?: Charge[];
  payments?: Payment[];
  cancellationReason?: string | null;
  cancelledBy?: string | null;
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
  version: 13;
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
    cleaner: null,
    maintainer: null,
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
  crossCheckedAt: null,
  crossCheckDifferences: null,
  crossCheckError: null,
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
    crossCheckedAt: checkedThisMorning(3, 30),
    crossCheckDifferences: 0,
    crossCheckError: null,
  };
}

/** The daily safety check runs at 04:15 and the cross-check at 03:30; the demo says they ran this morning. */
function checkedThisMorning(hour = 4, minute = 15): string {
  const at = new Date();
  at.setHours(hour, minute, 0, 0);
  if (at.getTime() > Date.now()) at.setDate(at.getDate() - 1);
  return at.toISOString();
}

/** A state saved before the cross-check existed gets last night's check, like every connected property. */
function withCrossCheck(state: ChannexState): ChannexState {
  if (state.crossCheckedAt !== undefined) return state;
  return {
    ...state,
    ...(state.status === 'connected'
      ? { crossCheckedAt: checkedThisMorning(3, 30), crossCheckDifferences: 0, crossCheckError: null }
      : { crossCheckedAt: null, crossCheckDifferences: null, crossCheckError: null }),
  };
}

/**
 * The stand-in worker: a request made more than a few seconds ago has been done. Properties saved
 * before this existed get their state from who runs them.
 */
function channexOf(detail: PropertyDetail): ChannexState {
  const current = detail.channex ? withCrossCheck(detail.channex as ChannexState) : undefined;
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
      // Checked tonight for the first time.
      crossCheckedAt: null,
      crossCheckDifferences: null,
      crossCheckError: null,
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
  /** An invented address, so the guest's page has somewhere to point. */
  address?: [string, string, string];
}): PropertyDetail {
  const createdAt = new Date('2026-10-14T09:00:00Z').toISOString();
  return {
    id: crypto.randomUUID(),
    name: p.name,
    internalCode: p.code,
    addressLine1: p.address?.[0] ?? null,
    city: p.address?.[1] ?? null,
    postcode: p.address?.[2] ?? null,
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

function demoTodayDate(): string {
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
      guestPhone: null,
    },
  };
}

function seed(): DemoState {
  const pastVisit = Date.now() - (2 * 24 * 60 + 190) * MINUTE;
  const state: DemoState = {
    version: 13,
    calendarFrom: demoTodayDate(),
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
        fields: standardFields(),
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
            address: ['4 Quay Lane', 'Harbourside', 'HB1 2QL'],
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
            address: ['12 Mill Street, Flat 2', 'Harbourside', 'HB1 3MS'],
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
            address: ['Orchard Lane', 'Appleford', 'AP2 7OC'],
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
            address: ['The Granary, Home Farm', 'Appleford', 'AP2 7HF'],
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
        fields: standardFields(),
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
            address: ['9 Quay Street', 'Brightwater', 'BW4 1QS'],
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
        fields: standardFields(),
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

// Tasks: cleans, maintenance and inspections for the field team ----------------------------------

/** A stable id for a team member, from their email: the demo has no user table. */
function memberId(email: string): string {
  if (email === DEMO_USER.email) return DEMO_USER.id;
  let h = 0x811c9dc5;
  for (const ch of email) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  const hex = (n: number) => {
    h = Math.imul(h ^ n, 0x01000193) >>> 0;
    return h.toString(16).padStart(8, '0');
  };
  const a = hex(1);
  const b = hex(2);
  const c = hex(3);
  const d = hex(4);
  return `${a}-${b.slice(0, 4)}-4${b.slice(5, 8)}-a${c.slice(1, 4)}-${c.slice(4)}${d.slice(0, 8)}`;
}

function memberName(operator: DemoOperator, userId: string | null): { id: string; name: string } | null {
  if (!userId) return null;
  const m = operator.team.find((x) => memberId(x.email) === userId);
  return m ? { id: userId, name: m.fullName ?? m.email } : null;
}

function standardTemplates(): TaskTemplate[] {
  return [
    {
      kind: 'cleaning',
      title: 'Clean after check-out',
      checklist: [
        'Strip and remake every bed',
        'Bathrooms: shower, basin, toilet, mirrors, fresh towels',
        'Kitchen: surfaces, hob, oven, fridge, bins out, dishwasher empty',
        'Floors throughout',
        'Restock: toilet rolls, bin bags, tea and coffee, toiletries',
        'Check for damage and anything left behind',
        'Windows and doors locked, heating as set, lights off',
      ],
      automatic: true,
    },
    {
      kind: 'maintenance',
      title: 'Maintenance visit',
      checklist: ['Note what was found', 'Note what was fixed or still needs doing'],
      automatic: false,
    },
    {
      kind: 'inspection',
      title: 'Inspection',
      checklist: ['Walk every room', 'Note anything worn, broken or missing'],
      automatic: false,
    },
  ];
}

function templatesOf(operator: DemoOperator): TaskTemplate[] {
  if (!operator.taskTemplates) operator.taskTemplates = standardTemplates();
  return operator.taskTemplates;
}

/**
 * The stand-in worker's check-out cleans: one per confirmed stay leaving within a week, due by the
 * next guest's arrival, assigned to the field team member who usually cleans. The first time a
 * sample workspace is opened it also gets yesterday's finished clean and one maintenance job, so
 * the page has a history.
 */
/** The address on one line, for the stamp on photos. */
function addressOf(
  p: { addressLine1?: string | null; city?: string | null; postcode?: string | null } | undefined,
): string | null {
  const parts = [p?.addressLine1, p?.city, p?.postcode].filter((x): x is string => Boolean(x));
  return parts.length ? parts.join(', ') : null;
}

function settleTasks(operator: DemoOperator): Task[] {
  const first = !operator.tasks;
  operator.tasks ??= [];
  const tasks = operator.tasks;
  const templates = templatesOf(operator);
  const clean = templates.find((t) => t.kind === 'cleaning');
  const today = todayIn(operator.workspace.settings.timeZone);
  const crew = operator.team.filter((m) => m.role === 'field' && m.status === 'active');
  const cleanerFor = (propertyIndex: number) => {
    const m = crew[propertyIndex % Math.max(1, crew.length)];
    return m ? { id: memberId(m.email), name: m.fullName ?? m.email } : null;
  };
  const nameOf = (propertyId: string) => operator.properties.find((p) => p.id === propertyId)?.name ?? '';
  let changed = false;
  if (clean?.automatic) {
    for (const stay of operator.calendar.stays) {
      if (stay.status !== 'confirmed' || stay.checkOut < today || stay.checkOut > addDays(today, 7)) continue;
      if (tasks.some((t) => t.reservationId === stay.id && t.source === 'check_out')) continue;
      const property = operator.properties.find((p) => p.id === stay.propertyId);
      if (!property) continue;
      const next = operator.calendar.stays.find(
        (x) => x.propertyId === stay.propertyId && x.status === 'confirmed' && x.checkIn === stay.checkOut,
      );
      const leaves = stay.checkOutTime ?? property.checkOutTime;
      const arrives = next ? (next.checkInTime ?? property.checkInTime) : null;
      const index = operator.properties.findIndex((p) => p.id === property.id);
      tasks.push({
        id: crypto.randomUUID(),
        propertyId: property.id,
        propertyName: property.name,
        propertyAddress: addressOf(property),
        access: [],
        reservationId: stay.id,
        kind: 'cleaning',
        source: 'check_out',
        title: clean.title,
        notes: `Guest leaves at ${leaves}${arrives ? `. Next guest arrives at ${arrives}.` : '. Nobody arrives today.'}`,
        status: 'open',
        dueOn: stay.checkOut,
        dueTime: arrives,
        assignee: cleanerFor(index),
        checklist: clean.checklist.map((text) => ({ text, done: false })),
        photos: [],
        guestLeavesAt: leaves,
        nextArrivalAt: arrives,
        doneBy: null,
        doneAt: null,
        createdAt: new Date().toISOString(),
      });
      changed = true;
    }
  }
  if (first && operator.properties.length) {
    const p0 = operator.properties[0] as PropertyDetail;
    const p1 = operator.properties[1] ?? p0;
    const who = cleanerFor(0);
    const yesterday = addDays(today, -1);
    tasks.push(
      {
        id: crypto.randomUUID(),
        propertyId: p0.id,
        propertyName: p0.name,
        propertyAddress: addressOf(p0),
        access: [],
        reservationId: null,
        kind: 'cleaning',
        source: 'check_out',
        title: clean?.title ?? 'Clean after check-out',
        notes: 'Guest leaves at 10:00. Next guest arrives at 16:00.',
        status: 'done',
        dueOn: yesterday,
        dueTime: '16:00',
        assignee: who,
        checklist: (clean?.checklist ?? []).map((text) => ({ text, done: true })),
        photos: [],
        guestLeavesAt: null,
        nextArrivalAt: null,
        doneBy: who?.name ?? null,
        doneAt: zonedInstant(yesterday, '14:40', operator.workspace.settings.timeZone).toISOString(),
        createdAt: zonedInstant(
          addDays(yesterday, -3),
          '09:00',
          operator.workspace.settings.timeZone,
        ).toISOString(),
      },
      {
        id: crypto.randomUUID(),
        propertyId: p1.id,
        propertyName: p1.name,
        propertyAddress: addressOf(p1),
        access: [],
        reservationId: null,
        kind: 'maintenance',
        source: 'report',
        title: 'Damage reported',
        notes:
          'Shower screen cracked along the bottom edge; still holding but needs replacing before it goes.',
        status: 'open',
        dueOn: addDays(today, 2),
        dueTime: null,
        assignee: null,
        checklist: (templates.find((t) => t.kind === 'maintenance')?.checklist ?? []).map((text) => ({
          text,
          done: false,
        })),
        photos: [],
        guestLeavesAt: null,
        nextArrivalAt: null,
        doneBy: null,
        doneAt: null,
        createdAt: new Date(Date.now() - 50 * MINUTE).toISOString(),
      },
    );
    changed = true;
  }
  // A stay that was cancelled takes its open clean with it.
  for (const t of tasks) {
    if (t.source !== 'check_out' || !t.reservationId || t.status === 'done' || t.status === 'cancelled')
      continue;
    const stay = operator.calendar.stays.find((x) => x.id === t.reservationId);
    if (stay?.status !== 'confirmed' || stay.checkOut !== t.dueOn) {
      t.status = 'cancelled';
      changed = true;
    }
    t.propertyName = nameOf(t.propertyId) || t.propertyName;
  }
  if (changed) save();
  return tasks;
}

function demoTaskList(operator: DemoOperator, role: WorkspaceRole, query: Record<string, string>): TaskList {
  const parsed = TaskListQuerySchema.safeParse(query);
  if (!parsed.success) invalid(parsed.error.issues);
  const q = parsed.data;
  const today = todayIn(operator.workspace.settings.timeZone);
  const all = settleTasks(operator);
  const crewOnly = role === 'field' || q.mine === '1';
  const open = (t: Task) => t.status === 'open' || t.status === 'in_progress';
  const visible = all.filter((t) => !crewOnly || !t.assignee || t.assignee.id === DEMO_USER.id);
  const inView = visible.filter((t) =>
    q.view === 'today'
      ? open(t) && t.dueOn <= today
      : q.view === 'upcoming'
        ? open(t) && t.dueOn > today && t.dueOn <= addDays(today, 14)
        : q.view === 'open'
          ? open(t)
          : t.status === 'done' && t.dueOn >= addDays(today, -30),
  );
  const filtered = inView.filter(
    (t) =>
      (!q.propertyId || t.propertyId === q.propertyId) && (!q.assigneeId || t.assignee?.id === q.assigneeId),
  );
  filtered.sort(
    (a, b) =>
      (q.view === 'done' ? b.dueOn.localeCompare(a.dueOn) : a.dueOn.localeCompare(b.dueOn)) ||
      (a.dueTime ?? '99').localeCompare(b.dueTime ?? '99') ||
      a.propertyName.localeCompare(b.propertyName),
  );
  const openOnes = visible.filter(open);
  return {
    today,
    tasks: filtered,
    counts: {
      today: openOnes.filter((t) => t.dueOn <= today).length,
      upcoming: openOnes.filter((t) => t.dueOn > today && t.dueOn <= addDays(today, 14)).length,
      open: openOnes.length,
    },
  };
}

function findTask(operator: DemoOperator, role: WorkspaceRole, id: string): Task {
  const task = settleTasks(operator).find((t) => t.id === id);
  if (!task || (role === 'field' && task.assignee && task.assignee.id !== DEMO_USER.id)) {
    throw new ApiError(404, 'task_not_found', 'That task does not exist in this workspace.');
  }
  return task;
}

export async function demoAddTaskPhoto(
  orgId: string | null,
  taskId: string,
  photo: { blob: Blob; width: number; height: number },
  stage: PhotoStage = 'found',
  stamp: string | null = null,
): Promise<Task> {
  const { operator, role } = access(orgId, 'tasks.write');
  const task = findTask(operator, role, taskId);
  if (task.photos.length >= 20)
    throw new ApiError(409, 'too_many_photos', 'A task can have up to 20 photos.');
  const id = crypto.randomUUID();
  await putDemoPhoto(id, photo.blob);
  task.photos.push({
    id,
    url: `demo-photo:${id}`,
    width: photo.width,
    height: photo.height,
    takenBy: 'Demo user',
    stage,
    stamp,
    at: new Date().toISOString(),
  });
  save();
  return resolvedTask(task);
}

/** A task with its photos' addresses resolved from this browser's storage. */
async function resolvedTask(task: Task): Promise<Task> {
  const photos: Task['photos'] = [];
  for (const p of task.photos) {
    const url = p.url.startsWith('demo-photo:') ? await demoPhotoUrl(p.url.slice(11)) : p.url;
    if (url) photos.push({ ...p, url });
  }
  return { ...task, photos };
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
 * The standard fields every workspace starts with (Alpha, 19 Oct 2026), plus a note for the team,
 * as an operator leaving Guesty fills them. Sample values only; nothing here is real.
 */
function seedFields(s: DemoState): void {
  const defs: { name: string; kind: CustomField['kind']; guestVisible: boolean; crewVisible: boolean }[] = [
    ...standardFields().map(({ name, kind, guestVisible, crewVisible }) => ({
      name,
      kind,
      guestVisible,
      crewVisible,
    })),
    { name: 'Note for the team', kind: 'long_text', guestVisible: false, crewVisible: false },
  ];
  type Values = [string | null, string | null, string | null, string | null, string | null, string | null];
  const samples: Record<string, Values> = {
    HVL: [
      '4921#',
      '7718#',
      'HarbourView-Guest',
      'seabreeze2026',
      'https://docs.example.com/harbour-view/arrival',
      'Owner visits in August: keep the second week free.',
    ],
    ORC: [
      '7730',
      '7731',
      'Orchard Wifi',
      'apples-and-pears',
      'https://docs.example.com/orchard/arrival',
      null,
    ],
    QYH: [
      '2580',
      null,
      'Quay House',
      'tide-tables',
      null,
      'Still cleaned by the Guesty-era team until the move-over.',
    ],
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
  s.calendarFrom = demoTodayDate();
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

/** The standard custom fields every workspace starts with (migration 0024; Alpha, 19 Oct 2026). */
function standardFields(): CustomField[] {
  return (
    [
      ['Top lock code', 'secret', true],
      ['Bottom lock code', 'secret', false],
      ['Wi-Fi name', 'text', true],
      ['Wi-Fi password', 'secret', true],
      ['Check-in instructions', 'link', true],
    ] as const
  ).map(([name, kind, guestVisible], position) => ({
    id: crypto.randomUUID(),
    name,
    kind,
    position,
    guestVisible,
    crewVisible: name === 'Bottom lock code',
  }));
}

let state: DemoState | null = null;

function load(): DemoState {
  if (state) return state;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as DemoState;
      if ((parsed.version as number) === 10) {
        // Version 11 brought the standard custom fields; the sample workspaces start again with them.
        seedFields(parsed);
        (parsed as { version: number }).version = 11;
      }
      if ((parsed.version as number) === 11) {
        // Version 12 brought tasks; the sample workspaces get their check-out cleans.
        (parsed as { version: number }).version = 12;
      }
      if ((parsed.version as number) === 12) {
        // Version 13: which fields guests see. The standard ones, except the bottom lock.
        const standard = new Set(['top lock code', 'wi-fi name', 'wi-fi password', 'check-in instructions']);
        const addresses: Record<string, [string, string, string]> = {
          HVL: ['4 Quay Lane', 'Harbourside', 'HB1 2QL'],
          MSF: ['12 Mill Street, Flat 2', 'Harbourside', 'HB1 3MS'],
          ORC: ['Orchard Lane', 'Appleford', 'AP2 7OC'],
          GRN: ['The Granary, Home Farm', 'Appleford', 'AP2 7HF'],
          QYH: ['9 Quay Street', 'Brightwater', 'BW4 1QS'],
        };
        for (const operator of parsed.operators) {
          for (const f of operator.fields) f.guestVisible ??= standard.has(f.name.toLowerCase());
          for (const f of operator.fields) f.crewVisible ??= f.name.toLowerCase() === 'bottom lock code';
          for (const p of operator.properties) {
            const a = addresses[p.internalCode ?? ''];
            if (a && !p.addressLine1) [p.addressLine1, p.city, p.postcode] = a;
          }
        }
        (parsed as { version: number }).version = 13;
      }
      if (parsed.version === 13) {
        // A week on, the sample bookings would all be in the past: lay them out again from today.
        if (parsed.calendarFrom <= addDays(demoTodayDate(), -7)) {
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
/**
 * Demo only: look at a workspace as the field team would, and back. The demo user's role changes,
 * and with it everything the API stand-in lets them see. Their jobs are the unassigned ones.
 */
export function setDemoRole(orgId: string, role: MemberRole): void {
  const operator = findOperator(orgId);
  if (!operator?.role) return;
  operator.originalRole ??= operator.role;
  operator.role = role;
  save();
}

export function demoOriginalRole(orgId: string): MemberRole | null {
  return findOperator(orgId)?.originalRole ?? null;
}

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
      link.liveFrom = demoTodayDate();
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
    cancellationReason: x.cancellationReason ?? null,
    cancelledBy: x.cancelledBy ?? null,
    charges: x.charges ?? [],
    payments: x.payments ?? [],
    chargesMinor: (x.charges ?? []).reduce((sum, c) => sum + c.amountMinor, 0),
    paidMinor: (x.payments ?? []).reduce((sum, p) => sum + p.amountMinor, 0),
    balanceMinor:
      x.totalMinor === null
        ? null
        : x.totalMinor +
          (x.charges ?? []).reduce((sum, c) => sum + c.amountMinor, 0) -
          (x.payments ?? []).reduce((sum, p) => sum + p.amountMinor, 0),
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

/** The nightly cross-check across the properties V-01 runs, from each property's state. */
function demoCrossCheck(operator: DemoOperator): WorkspaceSyncCrossCheck {
  const live = operator.properties
    .filter((p) => p.managedBy === 'v01')
    .map((p) => channexOf(p))
    .filter((c) => c.status === 'connected');
  const checked = live.filter((c) => c.crossCheckedAt !== null);
  return {
    lastCheckedAt:
      checked
        .map((c) => c.crossCheckedAt as string)
        .sort()
        .at(-1) ?? null,
    properties: live.length,
    matching: live.filter((c) => c.crossCheckDifferences === 0).length,
    differing: live.filter((c) => (c.crossCheckDifferences ?? 0) > 0).length,
    failed: live.filter((c) => c.crossCheckError !== null).length,
    unchecked: live.length - checked.length,
  };
}

type WorkspaceSyncCrossCheck = {
  lastCheckedAt: string | null;
  properties: number;
  matching: number;
  differing: number;
  failed: number;
  unchecked: number;
};

const SHORT_DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const shortDay = (date: string) => SHORT_DAY.format(new Date(`${date}T12:00:00Z`));

/** GET /v1/today: arrivals, departures, cleans due and what needs a person, from the demo's own state. */
function demoToday(operator: DemoOperator, role: WorkspaceRole): Today {
  const today = todayIn(operator.workspace.settings.timeZone);
  const seesGuests = can(role, 'reservations.read');
  const seesChannels = can(role, 'channels.read');
  const seesProperties = can(role, 'properties.read');
  const nameOf = (propertyId: string) => operator.properties.find((p) => p.id === propertyId)?.name ?? '';
  const nights = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
  const stay = (x: DemoStay, time: string | null): TodayStay => ({
    reservationId: x.id,
    propertyId: x.propertyId,
    propertyName: nameOf(x.propertyId),
    guestName: seesGuests ? x.guestName : null,
    channel: x.channel,
    checkIn: x.checkIn,
    checkOut: x.checkOut,
    nights: nights(x.checkIn, x.checkOut),
    time: time ? time.slice(0, 5) : null,
    guests: x.adults + x.children,
  });
  const confirmed = operator.calendar.stays.filter((x) => x.status === 'confirmed');
  const byName = (a: TodayStay, b: TodayStay) => a.propertyName.localeCompare(b.propertyName);
  const arrivals = confirmed
    .filter((x) => x.checkIn === today)
    .map((x) => stay(x, x.checkInTime))
    .sort(byName);
  const departures = confirmed
    .filter((x) => x.checkOut === today)
    .map((x) => stay(x, x.checkOutTime))
    .sort(byName);
  const staying = confirmed.filter((x) => x.checkIn <= today && x.checkOut > today).length;

  const cleansDue = seesProperties
    ? Object.entries(operator.cleaning ?? {})
        .filter(([, c]) => c.status === 'dirty')
        .map(([propertyId, c]) => ({ propertyId, propertyName: nameOf(propertyId), since: c.changedAt }))
        .sort((a, b) => a.propertyName.localeCompare(b.propertyName))
    : [];

  const attention: Today['attention'] = [];
  if (seesGuests) {
    for (const x of operator.calendar.stays.filter((x) => x.status === 'conflict' && x.checkOut >= today)) {
      attention.push({
        id: `conflict:${x.id}`,
        severity: 'urgent',
        title: `Two bookings overlap at ${nameOf(x.propertyId)}`,
        detail: `A ${CHANNEL_LABELS[x.channel]} booking for ${shortDay(x.checkIn)} to ${shortDay(x.checkOut)} clashes with another stay. One guest has to be moved or refunded.`,
        to: `/reservations/${x.id}`,
      });
    }
  }
  if (seesChannels) {
    if (operator.live.outboxFailed > 0) {
      const n = operator.live.outboxFailed;
      attention.push({
        id: 'outbox-failed',
        severity: 'urgent',
        title: `${n} ${n === 1 ? 'change' : 'changes'} didn’t reach the channels`,
        detail: 'Channex refused them. The calendar on the channels may be out of date until they go.',
        to: '/channels',
      });
    }
    for (const p of operator.properties.filter((p) => p.managedBy === 'v01')) {
      const c = channexOf(p);
      if (c.crossCheckError) {
        attention.push({
          id: `cross-check-failed:${p.id}`,
          severity: 'warning',
          title: `Couldn’t check ${p.name} against Channex`,
          detail: `${c.crossCheckError} The worker tries again tonight.`,
          to: `/properties/${p.id}`,
        });
      } else if ((c.crossCheckDifferences ?? 0) > 0) {
        const n = c.crossCheckDifferences as number;
        attention.push({
          id: `cross-check:${p.id}`,
          severity: 'warning',
          title: `Channex didn’t match ${p.name}`,
          detail: `${n} ${n === 1 ? 'night' : 'nights'} differed in last night’s check and ${n === 1 ? 'was' : 'were'} sent again. If it happens again tomorrow, someone is changing things in Channex or on the channel.`,
          to: `/properties/${p.id}`,
        });
      }
    }
    for (const a of operator.channelAccounts.filter((a) => a.status === 'error' || a.status === 'pending')) {
      attention.push(
        a.status === 'error'
          ? {
              id: `account:${a.id}`,
              severity: 'urgent',
              title: `${a.label} isn’t connected`,
              detail: `Channex lost the connection to the ${CHANNEL_LABELS[a.channel]} account.`,
              to: '/channels',
            }
          : {
              id: `account:${a.id}`,
              severity: 'warning',
              title: `${a.label} is waiting to be authorised`,
              detail: `The account’s owner has to open the ${CHANNEL_LABELS[a.channel]} link on Channels & sync.`,
              to: '/channels',
            },
      );
    }
  }
  if (can(role, 'inbox.read')) {
    const waiting = settleThreads(operator)
      .map((th) => threadView(operator, th))
      .filter((t) => t.awaitingSince !== null);
    if (waiting.length) {
      const oldest = Math.min(...waiting.map((t) => Date.parse(t.awaitingSince as string)));
      const hours = (Date.now() - oldest) / 3_600_000;
      attention.push({
        id: 'inbox:awaiting',
        severity: hours >= 24 ? 'urgent' : 'warning',
        title:
          waiting.length === 1
            ? 'A guest is waiting for a reply'
            : `${waiting.length} guests are waiting for a reply`,
        detail:
          hours >= 24
            ? `The longest for ${Math.floor(hours / 24)} ${Math.floor(hours / 24) === 1 ? 'day' : 'days'}.`
            : hours >= 1
              ? `The longest for ${Math.floor(hours)} ${Math.floor(hours) === 1 ? 'hour' : 'hours'}.`
              : 'Within the hour.',
        to: '/inbox',
      });
    }
  }
  if (seesProperties) {
    const locks = locksOf(operator);
    for (const l of locks.locks.filter(
      (x) => x.propertyId && x.battery !== null && x.battery < LOW_BATTERY,
    )) {
      attention.push({
        id: `locks:battery:${l.id}`,
        severity: (l.battery ?? 0) < 10 ? 'urgent' : 'warning',
        title: `${nameOf(l.propertyId as string)}: ${l.name} battery at ${l.battery}%`,
        detail: 'Change the batteries before it runs out and locks a guest out.',
        to: '/workspace#locks',
      });
    }
  }
  attention.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'urgent' ? -1 : 1));

  // At a glance, worked out the way the API does.
  const plusDays = (day: string, n: number) =>
    new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const homes = operator.properties.length;
  const glanceNights = Array.from({ length: 14 }, (_, i) => {
    const date = plusDays(today, i);
    const occupied = new Set(
      confirmed.filter((x) => x.checkIn <= date && x.checkOut > date).map((x) => x.propertyId),
    ).size;
    return { date, occupied };
  });
  const month = today.slice(0, 7);
  const lastMonth = plusDays(`${month}-01`, -1).slice(0, 7);
  const sumWhere = (keep: (x: DemoStay) => boolean) =>
    confirmed.filter(keep).reduce((sum, x) => sum + (x.totalMinor ?? 0), 0);
  const ago = (days: number) => Date.now() - days * 86_400_000;
  const channelCounts = new Map<DemoStay['channel'], number>();
  for (const x of confirmed.filter((x) => Date.parse(x.createdAt) > ago(90))) {
    channelCounts.set(x.channel, (channelCounts.get(x.channel) ?? 0) + 1);
  }
  const tasks = settleTasks(operator);
  const due = tasks.filter((t) => (t.status === 'open' || t.status === 'in_progress') && t.dueOn <= today);
  const awaiting = can(role, 'inbox.read')
    ? settleThreads(operator)
        .map((th) => threadView(operator, th))
        .filter((t) => t.awaitingSince !== null).length
    : 0;
  return {
    date: today,
    arrivals,
    departures,
    staying,
    cleansDue,
    attention,
    workerSeenAt: new Date(Date.now() - 20_000).toISOString(),
    glance: {
      homes,
      nights: glanceNights,
      money: seesGuests
        ? {
            currency: operator.workspace.settings.currency,
            thisMonthMinor: sumWhere((x) => x.checkIn.startsWith(month)),
            lastMonthMinor: sumWhere((x) => x.checkIn.startsWith(lastMonth)),
            next30Minor: sumWhere((x) => x.checkIn >= today && x.checkIn < plusDays(today, 30)),
          }
        : null,
      channels: seesGuests
        ? [...channelCounts]
            .map(([channel, bookings]) => ({ channel, bookings }))
            .sort((a, b) => b.bookings - a.bookings)
        : [],
      newBookings: operator.calendar.stays.filter(
        (x) => x.status !== 'cancelled' && Date.parse(x.createdAt) > ago(7),
      ).length,
      jobs: {
        open: due.length,
        doneToday: tasks.filter((t) => t.status === 'done' && t.dueOn === today).length,
        unassigned: due.filter((t) => !t.assignee).length,
      },
      awaitingReply: awaiting,
    },
  };
}

/** GET /v1/overview: the day's moves, worked out the way the API does from the demo's own stays. */
function demoOverview(operator: DemoOperator, range: OverviewRange): DailyOverview {
  const tz = operator.workspace.settings.timeZone;
  const today = todayIn(tz);
  const localNow = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date());
  const from = range === 'tomorrow' ? addDays(today, 1) : today;
  const to = range === 'week' ? addDays(today, 6) : from;
  const isToday = range === 'today';
  const homes = new Map(operator.properties.map((p) => [p.id, p]));
  const dirty = (id: string) => operator.cleaning?.[id]?.status === 'dirty';
  const confirmed = operator.calendar.stays.filter(
    (x) => x.status === 'confirmed' && homes.has(x.propertyId),
  );
  const ins = confirmed
    .filter((x) => x.checkIn >= from && x.checkIn <= to)
    .map((x) => ({
      x,
      day: x.checkIn,
      at: (x.checkInTime ?? homes.get(x.propertyId)?.checkInTime ?? '15:00').slice(0, 5),
    }));
  const outs = confirmed
    .filter((x) => x.checkOut >= from && x.checkOut <= to)
    .map((x) => ({
      x,
      day: x.checkOut,
      at: (x.checkOutTime ?? homes.get(x.propertyId)?.checkOutTime ?? '10:00').slice(0, 5),
    }));
  const past = (r: { day: string; at: string }) => r.day < today || (r.day === today && r.at <= localNow);
  const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const gaps = ins.flatMap((i) =>
    outs
      .filter((o) => o.x.propertyId === i.x.propertyId && o.day === i.day)
      .map((o) => minutes(i.at) - minutes(o.at)),
  );
  return {
    range,
    from,
    to,
    checkIns: {
      total: ins.length,
      done: isToday ? ins.filter(past).length : null,
      ready: isToday ? ins.filter((i) => !dirty(i.x.propertyId)).length : null,
    },
    checkOuts: {
      total: outs.length,
      done: isToday ? outs.filter(past).length : null,
      cleaned: isToday
        ? outs.filter(
            (o) => !dirty(o.x.propertyId) && (operator.cleaning?.[o.x.propertyId]?.changedAt ?? '') >= from,
          ).length
        : null,
    },
    turnovers: {
      total: gaps.length,
      shortestHours: gaps.length ? Math.round((Math.min(...gaps) / 60) * 10) / 10 : null,
    },
    staying: confirmed.filter((x) => x.checkIn < from && x.checkOut > from).length,
    needCleaning: operator.properties.filter((p) => dirty(p.id)).length,
  };
}

/** GET /v1/overview/revenue: each booking's money spread over its nights, against the month before. */
function demoRevenue(operator: DemoOperator, month: string | null): Revenue {
  const m = month ?? todayIn(operator.workspace.settings.timeZone).slice(0, 7);
  const before = previousMonth(m);
  const byNight = new Map<string, { minor: number; nights: number }>();
  for (const x of operator.calendar.stays) {
    if (x.status !== 'confirmed' || x.totalMinor === null) continue;
    const n = Math.max(1, Math.round((Date.parse(x.checkOut) - Date.parse(x.checkIn)) / 86_400_000));
    for (let night = x.checkIn; night < x.checkOut; night = addDays(night, 1)) {
      const k = byNight.get(night) ?? { minor: 0, nights: 0 };
      k.minor += x.totalMinor / n;
      k.nights += 1;
      byNight.set(night, k);
    }
  }
  const lastDay = (mm: string) => {
    const [y, mo] = mm.split('-').map(Number) as [number, number];
    return new Date(Date.UTC(y, mo, 0)).getUTCDate();
  };
  const day = (mm: string, d: number) => `${mm}-${String(d).padStart(2, '0')}`;
  const sum = (mm: string, a: number, b: number) => {
    let minor = 0;
    let nights = 0;
    for (let d = a; d <= Math.min(b, lastDay(mm)); d++) {
      const r = byNight.get(day(mm, d));
      if (r) {
        minor += r.minor;
        nights += r.nights;
      }
    }
    return { minor: Math.round(minor), nights };
  };
  const rate = (s: { minor: number; nights: number }) => (s.nights ? Math.round(s.minor / s.nights) : null);
  const per = (mm: string, d: number) => {
    const r = d <= lastDay(mm) ? byNight.get(day(mm, d)) : undefined;
    return r ? Math.round(r.minor / r.nights) : null;
  };
  return {
    month: m,
    currency: operator.workspace.settings.currency,
    adr: {
      currentMinor: rate(sum(m, 1, 31)),
      previousMinor: rate(sum(before, 1, 31)),
      days: Array.from({ length: lastDay(m) }, (_, i) => ({
        date: day(m, i + 1),
        currentMinor: per(m, i + 1),
        previousMinor: per(before, i + 1),
      })),
    },
    total: {
      currentMinor: sum(m, 1, 31).minor,
      previousMinor: sum(before, 1, 31).minor,
      weeks: monthWeeks(m).map((w) => ({
        label: w.label,
        days: w.to - w.from + 1,
        currentMinor: sum(m, w.from, w.to).minor,
        previousMinor: sum(before, w.from, w.to).minor,
      })),
    },
  };
}

/** GET /v1/overview/trends: check-ins, check-outs, turnovers and occupancy for the next 7 or 30 days. */
function demoTrends(operator: DemoOperator, days: 7 | 30): Trends {
  const today = todayIn(operator.workspace.settings.timeZone);
  const homes = operator.properties.length;
  const conf = operator.calendar.stays.filter((x) => x.status === 'confirmed');
  const pct = (o: number, h: number) => (h ? Math.round((o / h) * 1000) / 10 : 0);
  let occupiedSum = 0;
  const out = Array.from({ length: days }, (_, i) => {
    const date = addDays(today, i);
    const occupied = new Set(
      conf.filter((x) => x.checkIn <= date && x.checkOut > date).map((x) => x.propertyId),
    ).size;
    occupiedSum += occupied;
    const leaving = conf.filter((x) => x.checkOut === date);
    return {
      date,
      checkIns: conf.filter((x) => x.checkIn === date).length,
      checkOuts: leaving.length,
      turnovers: leaving.filter((o) => conf.some((b) => b.propertyId === o.propertyId && b.checkIn === date))
        .length,
      occupancy: pct(occupied, homes),
    };
  });
  return {
    days: out,
    totals: {
      checkIns: out.reduce((s, d) => s + d.checkIns, 0),
      checkOuts: out.reduce((s, d) => s + d.checkOuts, 0),
      turnovers: out.reduce((s, d) => s + d.turnovers, 0),
      occupancy: pct(occupiedSum, homes * days),
    },
  };
}

function findStay(operator: DemoOperator, id: string): DemoStay {
  const stay = operator.calendar.stays.find((x) => x.id === id);
  if (!stay) {
    throw new ApiError(404, 'reservation_not_found', 'That booking does not exist in this workspace.');
  }
  return stay;
}

/** GET /v1/stay/:key: the guest's page, public, with codes only from arrival to departure. */
function demoGuestStay(s: DemoState, key: string): GuestStay {
  for (const operator of s.operators) {
    const stay = operator.calendar.stays.find((x) => x.guestKey === key);
    if (!stay) continue;
    const property = operator.properties.find((p) => p.id === stay.propertyId);
    if (!property || stay.status !== 'confirmed') break;
    const today = todayIn(operator.workspace.settings.timeZone);
    const phase: GuestStay['phase'] =
      today < stay.checkIn ? 'before' : today <= stay.checkOut ? 'during' : 'after';
    const values = operator.fieldValues[property.id] ?? {};
    const fields: GuestStay['fields'] = operator.fields
      .filter((f) => f.guestVisible && values[f.id])
      .map((f) => ({
        name: f.name,
        kind: f.kind,
        value:
          f.kind === 'secret' ? (phase === 'during' ? (values[f.id] ?? null) : null) : (values[f.id] ?? null),
      }));
    const photo = property.photos[0]?.url ?? null;
    return {
      guestName: stay.guestName,
      checkIn: stay.checkIn,
      checkOut: stay.checkOut,
      checkInTime: stay.checkInTime ?? property.checkInTime,
      checkOutTime: stay.checkOutTime ?? property.checkOutTime,
      nights: Math.round((Date.parse(stay.checkOut) - Date.parse(stay.checkIn)) / 86_400_000),
      guests: stay.adults + stay.children,
      timeZone: operator.workspace.settings.timeZone,
      phase,
      codesFrom: phase === 'before' ? stay.checkIn : null,
      doorCode: phase === 'during' && stayCodes(operator, stay, true).length ? demoDoorCode(stay.id) : null,
      property: {
        name: property.name,
        title: property.title,
        summary: property.summary,
        addressLine1: property.addressLine1,
        addressLine2: property.addressLine2,
        city: property.city,
        postcode: property.postcode,
        countryCode: property.countryCode,
        gettingAround: property.gettingAround,
        guestAccess: property.guestAccess,
        checkInMethod: property.checkInMethod,
        houseRules: property.houseRules,
        petsAllowed: property.petsAllowed,
        smokingAllowed: property.smokingAllowed,
        eventsAllowed: property.eventsAllowed,
        childrenAllowed: property.childrenAllowed,
        quietHoursStart: property.quietHoursStart,
        quietHoursEnd: property.quietHoursEnd,
        maxGuests: property.maxGuests,
        photoUrl: photo?.startsWith('sample-photo:') ? (SAMPLE_PHOTOS[photo.slice(13)] ?? null) : photo,
      },
      brand: {
        displayName: operator.workspace.brand.displayName,
        logoLightUrl: operator.workspace.brand.logoLightUrl,
        accentHex: operator.workspace.brand.accentHex,
        phone: operator.workspace.brand.guestPhone ?? '+44 1631 000000',
        email: `hello@${operator.workspace.brand.emailDomain ?? 'example.com'}`,
      },
      fields,
    };
  }
  throw new ApiError(404, 'stay_not_found', 'This link is not for a current stay.');
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

  if (method === 'PATCH' && path === '/v1/workspace/brand') {
    const { operator, role } = access(options.orgId, 'workspace.manage');
    const parsed = BrandUpdateSchema.safeParse(options.body);
    if (!parsed.success) invalid(parsed.error.issues);
    if (parsed.data.guestPhone !== undefined)
      operator.workspace.brand.guestPhone = parsed.data.guestPhone || null;
    save();
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
      if ('cleanerUserId' in changes) {
        const cleaner = memberName(operator, changes.cleanerUserId as string | null);
        if (changes.cleanerUserId && !cleaner)
          throw new ApiError(400, 'not_a_member', 'The cleaner has to be a member of this workspace.');
        delete changes.cleanerUserId;
        changes.cleaner = cleaner;
      }
      if ('maintainerUserId' in changes) {
        const maintainer = memberName(operator, changes.maintainerUserId as string | null);
        if (changes.maintainerUserId && !maintainer)
          throw new ApiError(400, 'not_a_member', 'That person has to be a member of this workspace.');
        delete changes.maintainerUserId;
        changes.maintainer = maintainer;
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

  // The team: invitations and roles ----------------------------------------------------------------

  if (method === 'PATCH' && path === '/v1/me') {
    const parsed = MeUpdateSchema.safeParse(options.body);
    if (!parsed.success) invalid(parsed.error.issues);
    for (const o of load().operators) {
      const me = o.team.find((m) => m.email === DEMO_USER.email);
      if (me) me.fullName = parsed.data.fullName;
    }
    save();
    return { fullName: parsed.data.fullName } as T;
  }

  if (method === 'GET' && path === '/v1/invitations') {
    const { operator } = access(options.orgId, 'members.manage');
    return { invitations: operator.invitations ?? [] } as T;
  }

  if (method === 'POST' && path === '/v1/invitations') {
    const { operator } = access(options.orgId, 'members.manage');
    const parsed = InviteSchema.safeParse(options.body);
    if (!parsed.success) invalid(parsed.error.issues);
    const email = parsed.data.email.trim().toLowerCase();
    if (operator.team.some((m) => m.email.toLowerCase() === email && m.status === 'active'))
      throw new ApiError(409, 'already_member', `${email} is already in this workspace.`);
    operator.invitations ??= [];
    operator.invitations = operator.invitations.filter((i) => i.email !== email);
    const now = Date.now();
    const invitation: Invitation = {
      id: crypto.randomUUID(),
      email,
      name: parsed.data.name,
      role: parsed.data.role,
      invitedBy: operator.team.find((m) => m.email === DEMO_USER.email)?.fullName ?? 'Demo user',
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 14 * 86_400_000).toISOString(),
    };
    operator.invitations.unshift(invitation);
    save();
    return { invitation, email: 'invited', reason: null } as T;
  }

  const invitationMatch = /^\/v1\/invitations\/([0-9a-f-]{36})$/.exec(path);
  if (method === 'DELETE' && invitationMatch?.[1]) {
    const { operator } = access(options.orgId, 'members.manage');
    const before = operator.invitations?.length ?? 0;
    operator.invitations = (operator.invitations ?? []).filter((i) => i.id !== invitationMatch[1]);
    if (operator.invitations.length === before)
      throw new ApiError(404, 'invitation_not_found', 'That invitation is no longer open.');
    save();
    return null as T;
  }

  const memberMatch = /^\/v1\/members\/([0-9a-f-]{36})$/.exec(path);
  if (memberMatch?.[1] && (method === 'PATCH' || method === 'DELETE')) {
    const { operator } = access(options.orgId, 'members.manage');
    const member = operator.team.find((m) => memberId(m.email) === memberMatch[1] && m.status === 'active');
    if (!member) throw new ApiError(404, 'member_not_found', 'That person is not in this workspace.');
    if (member.email === DEMO_USER.email)
      throw new ApiError(
        400,
        method === 'PATCH' ? 'own_role' : 'own_membership',
        `Ask another admin to ${method === 'PATCH' ? 'change your role' : 'remove you'}.`,
      );
    const adminCount = operator.team.filter((m) => m.status === 'active' && m.role === 'admin').length;
    if (method === 'DELETE') {
      if (member.role === 'admin' && adminCount <= 1)
        throw new ApiError(400, 'last_admin', 'The workspace needs at least one admin.');
      operator.team.splice(operator.team.indexOf(member), 1);
      save();
      return null as T;
    }
    const parsed = MemberRoleUpdateSchema.safeParse(options.body);
    if (!parsed.success) invalid(parsed.error.issues);
    if (parsed.data.role !== undefined) {
      if (member.role === 'admin' && parsed.data.role !== 'admin' && adminCount <= 1)
        throw new ApiError(400, 'last_admin', 'The workspace needs at least one admin.');
      member.role = parsed.data.role;
    }
    if (parsed.data.name !== undefined) member.fullName = parsed.data.name;
    save();
    return {
      id: memberId(member.email),
      name: member.fullName ?? member.email,
      email: member.email,
      role: member.role,
    } as T;
  }

  // Door locks: the pretend TTLock.
  if (path === '/v1/locks' || path.startsWith('/v1/locks/')) {
    const homes = () => {
      const { operator } = access(options.orgId, 'properties.read');
      return operator.properties.map((p) => ({ id: p.id, name: p.name }));
    };
    if (method === 'GET' && path === '/v1/locks') {
      const { operator } = access(options.orgId, 'properties.read');
      return demoLocksView(locksOf(operator), homes()) as T;
    }
    const { operator } = access(options.orgId, 'locks.manage');
    if (method === 'POST' && path === '/v1/locks/connect') {
      const parsed = LockConnectSchema.safeParse(options.body);
      if (!parsed.success) invalid(parsed.error.issues);
      try {
        operator.locks = connectDemoLocks(
          locksOf(operator),
          parsed.data.username,
          parsed.data.password,
          homes(),
        );
      } catch (error) {
        throw new ApiError(
          400,
          'lock_sign_in_refused',
          `TTLock refused the sign-in: ${(error as Error).message}. Use the TTLock app’s account, not the developer one.`,
        );
      }
    } else if (method === 'POST' && path === '/v1/locks/refresh') {
      const state = locksOf(operator);
      if (!state.account)
        throw new ApiError(404, 'lock_account_missing', 'Connect the TTLock account first.');
      state.account.syncedAt = new Date().toISOString();
    } else if (method === 'DELETE' && path === '/v1/locks/account') {
      operator.locks = emptyLocks();
    } else if (method === 'PATCH') {
      const lock = locksOf(operator).locks.find((l) => l.id === path.split('/')[3]);
      if (!lock) throw new ApiError(404, 'lock_not_found', 'That lock is not in this workspace.');
      const parsed = LockUpdateSchema.safeParse(options.body);
      if (!parsed.success) invalid(parsed.error.issues);
      const propertyId = parsed.data.propertyId === undefined ? lock.propertyId : parsed.data.propertyId;
      const makesCodes = parsed.data.makesCodes ?? (propertyId ? lock.makesCodes : false);
      if (makesCodes && !propertyId)
        throw new ApiError(400, 'lock_needs_property', 'Put the lock on a property before turning codes on.');
      if (makesCodes && !lock.hasGateway)
        throw new ApiError(
          400,
          'lock_needs_gateway',
          'This lock isn’t on a gateway, so codes can’t be sent to it. Pair it with a gateway in the TTLock app.',
        );
      lock.propertyId = propertyId;
      lock.makesCodes = makesCodes;
    }
    save();
    return demoLocksView(locksOf(operator), homes()) as T;
  }

  const doorCodesMatch = /^\/v1\/reservations\/([0-9a-f-]{36})\/door-codes$/.exec(path);
  if (method === 'GET' && doorCodesMatch) {
    const { operator, role } = access(options.orgId, 'reservations.read');
    const stay = findStay(operator, doorCodesMatch[1] as string);
    return { codes: stayCodes(operator, stay, can(role, 'secrets.read')) } as T;
  }

  if (method === 'GET' && path === '/v1/team') {
    const { operator, role } = access(options.orgId, 'workspace.read');
    const hide = !can(role, 'members.manage') && role !== 'operations';
    return {
      members: operator.team
        .filter((m) => m.status === 'active')
        .map((m) => ({
          id: memberId(m.email),
          name: m.fullName ?? m.email,
          email: hide ? '' : m.email,
          role: m.role,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    } satisfies TeamList as T;
  }

  if (method === 'GET' && path === '/v1/task-templates') {
    const { operator } = access(options.orgId, 'tasks.read');
    return { templates: templatesOf(operator) } as T;
  }

  const templateMatch = /^\/v1\/task-templates\/(cleaning|maintenance|inspection)$/.exec(path);
  if (method === 'PATCH' && templateMatch) {
    const { operator } = access(options.orgId, 'tasks.manage');
    const parsed = TaskTemplateUpdateSchema.safeParse(options.body);
    if (!parsed.success) invalid(parsed.error.issues);
    const tpl = templatesOf(operator).find((t) => t.kind === templateMatch[1]);
    if (!tpl) throw new ApiError(404, 'template_not_found', 'That kind of task has no template here.');
    if (parsed.data.title !== undefined) tpl.title = parsed.data.title;
    if (parsed.data.checklist !== undefined) tpl.checklist = parsed.data.checklist;
    if (parsed.data.automatic !== undefined) tpl.automatic = parsed.data.automatic;
    save();
    return tpl as T;
  }

  if (method === 'GET' && (path === '/v1/tasks' || path.startsWith('/v1/tasks?'))) {
    const { operator, role } = access(options.orgId, 'tasks.read');
    const query = Object.fromEntries(new URLSearchParams(path.split('?')[1] ?? ''));
    const list = demoTaskList(operator, role, query);
    return { ...list, tasks: await Promise.all(list.tasks.map(resolvedTask)) } as T;
  }

  if (method === 'POST' && path === '/v1/tasks') {
    const { operator } = access(options.orgId, 'tasks.manage');
    const parsed = TaskCreateSchema.safeParse(options.body);
    if (!parsed.success) invalid(parsed.error.issues);
    const b = parsed.data;
    const property = findProperty(operator, b.propertyId);
    const tpl = templatesOf(operator).find((t) => t.kind === b.kind);
    const task: Task = {
      id: crypto.randomUUID(),
      propertyId: property.id,
      propertyName: property.name,
      propertyAddress: addressOf(property),
      access: [],
      reservationId: null,
      kind: b.kind,
      source: 'manual',
      title: b.title ?? tpl?.title ?? 'Task',
      notes: b.notes || null,
      status: 'open',
      dueOn: b.dueOn,
      dueTime: b.dueTime ?? null,
      assignee:
        memberName(operator, b.assigneeId ?? null) ??
        (b.kind === 'cleaning' ? property.cleaner : b.kind === 'maintenance' ? property.maintainer : null),
      checklist: (b.checklist ?? tpl?.checklist ?? []).map((text) => ({ text, done: false })),
      photos: [],
      guestLeavesAt: null,
      nextArrivalAt: null,
      doneBy: null,
      doneAt: null,
      createdAt: new Date().toISOString(),
    };
    settleTasks(operator).push(task);
    save();
    return task as T;
  }

  const taskMatch = /^\/v1\/tasks\/([0-9a-f-]{36})(?:\/(report|photos)(?:\/([0-9a-f-]{36}))?)?$/.exec(path);
  if (taskMatch) {
    const [, taskId, part, photoId] = taskMatch;
    if (method === 'GET' && !part) {
      const { operator, role } = access(options.orgId, 'tasks.read');
      const task = await resolvedTask(findTask(operator, role, taskId as string));
      // Getting in: the crew's fields, on the job's day, for whoever may work it; never accounts.
      const today = todayIn(operator.workspace.settings.timeZone);
      const open = task.status !== 'done' && task.status !== 'cancelled' && task.dueOn <= today;
      const allowed = role === 'field' || can(role, 'secrets.read');
      const values = operator.fieldValues[task.propertyId] ?? {};
      const door =
        open && allowed
          ? demoJobCode(locksOf(operator), task, operator.workspace.settings.timeZone, today)
          : null;
      return {
        ...task,
        access:
          open && allowed
            ? [
                ...(door ? [door] : []),
                ...operator.fields
                  .filter((f) => f.crewVisible)
                  .map((f) => ({ name: f.name, kind: f.kind, value: values[f.id] ?? null })),
              ]
            : [],
      } as T;
    }
    if (method === 'PATCH' && !part) {
      const { operator, role } = access(options.orgId, 'tasks.write');
      const task = findTask(operator, role, taskId as string);
      const parsed = TaskUpdateSchema.safeParse(options.body);
      if (!parsed.success) invalid(parsed.error.issues);
      const b = parsed.data;
      if (role === 'field') {
        const extra = Object.keys(b).filter((k) => !['status', 'checklist', 'notes'].includes(k));
        if (extra.length)
          throw new ApiError(403, 'not_allowed', 'The field team can start, tick off and finish a task.');
        if (b.status === 'cancelled')
          throw new ApiError(403, 'not_allowed', 'Only the office cancels a task.');
      }
      const finishing = b.status === 'done' && task.status !== 'done';
      if (b.title !== undefined) task.title = b.title;
      if (b.notes !== undefined) task.notes = b.notes || null;
      if (b.dueOn !== undefined) task.dueOn = b.dueOn;
      if (b.dueTime !== undefined) task.dueTime = b.dueTime;
      if (b.assigneeId !== undefined) task.assignee = memberName(operator, b.assigneeId);
      if (b.checklist !== undefined) task.checklist = b.checklist;
      if (b.status !== undefined) {
        if (task.status === 'done' && b.status !== 'done') {
          task.doneBy = null;
          task.doneAt = null;
        }
        task.status = b.status;
      }
      if (finishing) {
        task.doneBy = 'Demo user';
        task.doneAt = new Date().toISOString();
        task.checklist = task.checklist.map((c) => ({ ...c, done: true }));
        if (task.kind === 'cleaning') {
          operator.cleaning ??= {};
          operator.cleaning[task.propertyId] = {
            status: 'clean',
            changedAt: task.doneAt,
            changedBy: 'Demo user',
          };
        }
      }
      if (role === 'field' && !task.assignee && b.status && b.status !== 'open') {
        task.assignee = { id: DEMO_USER.id, name: 'Demo user' };
      }
      save();
      return (await resolvedTask(task)) as T;
    }
    if (method === 'POST' && part === 'report') {
      const { operator, role } = access(options.orgId, 'tasks.write');
      const from = findTask(operator, role, taskId as string);
      const parsed = DamageReportSchema.safeParse(options.body);
      if (!parsed.success) invalid(parsed.error.issues);
      const tpl = templatesOf(operator).find((t) => t.kind === 'maintenance');
      const maintainer = operator.properties.find((p) => p.id === from.propertyId)?.maintainer ?? null;
      const task: Task = {
        id: crypto.randomUUID(),
        propertyId: from.propertyId,
        propertyName: from.propertyName,
        propertyAddress: from.propertyAddress,
        access: [],
        reservationId: null,
        kind: 'maintenance',
        source: 'report',
        title: 'Damage reported',
        notes: parsed.data.what,
        status: 'open',
        dueOn: from.dueOn,
        dueTime: null,
        assignee: maintainer,
        checklist: (tpl?.checklist ?? []).map((text) => ({ text, done: false })),
        photos: [],
        guestLeavesAt: null,
        nextArrivalAt: null,
        doneBy: null,
        doneAt: null,
        createdAt: new Date().toISOString(),
      };
      settleTasks(operator).push(task);
      save();
      return task as T;
    }
    if (method === 'DELETE' && part === 'photos' && photoId) {
      const { operator, role } = access(options.orgId, 'tasks.write');
      const task = findTask(operator, role, taskId as string);
      const photo = task.photos.find((p) => p.id === photoId);
      if (!photo) throw new ApiError(404, 'photo_not_found', 'That photo is not on this task.');
      task.photos = task.photos.filter((p) => p.id !== photoId);
      if (photo.url.startsWith('demo-photo:')) await deleteDemoPhoto(photo.url.slice(11));
      save();
      return (await resolvedTask(task)) as T;
    }
  }

  if (method === 'GET' && path === '/v1/today') {
    const { operator, role } = access(options.orgId, 'workspace.read');
    return demoToday(operator, role) as T;
  }

  if (method === 'GET' && path.startsWith('/v1/overview')) {
    const url = new URL(path, 'https://demo.invalid');
    if (url.pathname === '/v1/overview') {
      const { operator } = access(options.orgId, 'calendar.read');
      const r = url.searchParams.get('range');
      return demoOverview(operator, r === 'tomorrow' || r === 'week' ? r : 'today') as T;
    }
    if (url.pathname === '/v1/overview/revenue') {
      const { operator } = access(options.orgId, 'reservations.read');
      return demoRevenue(operator, url.searchParams.get('month')) as T;
    }
    if (url.pathname === '/v1/overview/trends') {
      const { operator } = access(options.orgId, 'calendar.read');
      return demoTrends(operator, url.searchParams.get('days') === '30' ? 30 : 7) as T;
    }
  }

  if (method === 'GET' && path === '/v1/channels/sync') {
    const { operator } = access(options.orgId, 'channels.read');
    return {
      outboxWaiting: operator.live.outboxWaiting,
      outboxFailed: operator.live.outboxFailed,
      oldestWaitingAt: agoOrNull(operator.live.oldestWaitingMinutes),
      lastSentAt: agoOrNull(operator.live.lastSentMinutes),
      lastBookingAt: agoOrNull(operator.live.lastWebhookMinutes),
      crossCheck: demoCrossCheck(operator),
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
        name: parsed.data.name,
        kind: parsed.data.kind,
        guestVisible: parsed.data.guestVisible ?? false,
        crewVisible: parsed.data.crewVisible ?? false,
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
      if (parsed.data.guestVisible !== undefined) field.guestVisible = parsed.data.guestVisible;
      if (parsed.data.crewVisible !== undefined) field.crewVisible = parsed.data.crewVisible;
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

  // The Inbox ------------------------------------------------------------------------------------

  if (method === 'GET' && (path === '/v1/inbox/threads' || path.startsWith('/v1/inbox/threads?'))) {
    const { operator } = access(options.orgId, 'inbox.read');
    const query = Object.fromEntries(new URLSearchParams(path.split('?')[1] ?? ''));
    const parsed = ThreadListQuerySchema.safeParse(query);
    if (!parsed.success) invalid(parsed.error.issues);
    return demoThreadList(operator, parsed.data) as T;
  }

  if (method === 'GET' && path === '/v1/inbox/templates') {
    const { operator } = access(options.orgId, 'inbox.read');
    return { templates: messageTemplatesOf(operator) } as T;
  }

  if (method === 'POST' && path === '/v1/inbox/templates') {
    const { operator } = access(options.orgId, 'inbox.manage');
    const parsed = MessageTemplateCreateSchema.safeParse(options.body);
    if (!parsed.success) invalid(parsed.error.issues);
    const b = parsed.data;
    const all = messageTemplatesOf(operator);
    if (b.trigger !== 'manual' && all.some((t) => t.trigger === b.trigger))
      throw new ApiError(409, 'trigger_taken', 'There is already an automatic message for that moment.');
    const made: MessageTemplate = {
      id: crypto.randomUUID(),
      name: b.name,
      trigger: b.trigger,
      sendTime: b.trigger === 'manual' || b.trigger === 'booking_confirmed' ? null : (b.sendTime ?? '10:00'),
      body: b.body,
      enabled: b.enabled ?? true,
      position: Math.max(0, ...all.map((t) => t.position)) + 1,
    };
    all.push(made);
    save();
    return made as T;
  }

  const messageTemplateMatch = /^\/v1\/inbox\/templates\/([0-9a-f-]{36})$/.exec(path);
  if (messageTemplateMatch?.[1] && (method === 'PATCH' || method === 'DELETE')) {
    const { operator } = access(options.orgId, 'inbox.manage');
    const all = messageTemplatesOf(operator);
    const tpl = all.find((t) => t.id === messageTemplateMatch[1]);
    if (!tpl) throw new ApiError(404, 'template_not_found', 'That message does not exist here.');
    if (method === 'DELETE') {
      if (tpl.trigger !== 'manual')
        throw new ApiError(400, 'standard_template', 'An automatic message is switched off, not removed.');
      all.splice(all.indexOf(tpl), 1);
      save();
      return null as T;
    }
    const parsed = MessageTemplateUpdateSchema.safeParse(options.body);
    if (!parsed.success) invalid(parsed.error.issues);
    const b = parsed.data;
    if (b.trigger !== undefined && b.trigger !== tpl.trigger && tpl.trigger !== 'manual')
      throw new ApiError(
        400,
        'trigger_fixed',
        'An automatic message keeps its moment; switch it off instead.',
      );
    if (b.name !== undefined) tpl.name = b.name;
    if (b.trigger !== undefined) tpl.trigger = b.trigger;
    if (b.sendTime !== undefined) tpl.sendTime = b.sendTime;
    if (b.body !== undefined) tpl.body = b.body;
    if (b.enabled !== undefined) tpl.enabled = b.enabled;
    save();
    return tpl as T;
  }

  const reservationThreadMatch = /^\/v1\/reservations\/([0-9a-f-]{36})\/thread$/.exec(path);
  if (method === 'GET' && reservationThreadMatch?.[1]) {
    const { operator } = access(options.orgId, 'inbox.read');
    const th = settleThreads(operator).find((x) => x.reservationId === reservationThreadMatch[1]);
    if (!th) throw new ApiError(404, 'thread_not_found', 'That booking has no conversation here.');
    return threadView(operator, th) as T;
  }

  const threadMatch = /^\/v1\/inbox\/threads\/([0-9a-f-]{36})(?:\/(messages))?$/.exec(path);
  if (threadMatch?.[1]) {
    const threadId = threadMatch[1];
    const notFound = () =>
      new ApiError(404, 'thread_not_found', 'That conversation does not exist in this workspace.');
    if (method === 'GET' && !threadMatch[2]) {
      const { operator } = access(options.orgId, 'inbox.read');
      const th = settleThreads(operator).find((x) => x.id === threadId);
      if (!th) throw notFound();
      return { thread: threadView(operator, th), messages: th.messages } satisfies ThreadDetail as T;
    }
    if (method === 'PATCH' && !threadMatch[2]) {
      const { operator } = access(options.orgId, 'inbox.write');
      const th = settleThreads(operator).find((x) => x.id === threadId);
      if (!th) throw notFound();
      const parsed = ThreadUpdateSchema.safeParse(options.body);
      if (!parsed.success) invalid(parsed.error.issues);
      if (parsed.data.status !== undefined) th.status = parsed.data.status;
      if (parsed.data.read) th.unread = 0;
      save();
      return threadView(operator, th) as T;
    }
    if (method === 'POST' && threadMatch[2] === 'messages') {
      const { operator } = access(options.orgId, 'inbox.write');
      const th = settleThreads(operator).find((x) => x.id === threadId);
      if (!th) throw notFound();
      const parsed = MessageSendSchema.safeParse(options.body);
      if (!parsed.success) invalid(parsed.error.issues);
      const view = threadView(operator, th);
      let via = view.via;
      if (parsed.data.via && (view.via === 'email' || view.via === 'sms')) {
        if (parsed.data.via === 'email' && !view.guestEmail)
          throw new ApiError(400, 'no_email', 'There is no email for this guest. Add one on the booking.');
        if (parsed.data.via === 'sms' && !view.guestPhone)
          throw new ApiError(
            400,
            'no_phone',
            'There is no phone number for this guest. Add one on the booking.',
          );
        via = parsed.data.via;
      }
      if (!via)
        throw new ApiError(
          400,
          'no_way_to_reach',
          'There is no email or phone number for this guest yet. Add one on the booking, then write again.',
        );
      const now = new Date().toISOString();
      // The demo stands in for the worker: it goes at once.
      th.messages.push({
        id: crypto.randomUUID(),
        threadId: th.id,
        direction: 'out',
        via,
        body: parsed.data.body,
        status: 'sent',
        note: null,
        sentBy: operator.team.find((m) => m.email === DEMO_USER.email)?.fullName ?? 'Demo user',
        automatic: false,
        templateName: null,
        at: now,
        sentAt: now,
      });
      th.unread = 0;
      th.status = 'open';
      save();
      return { thread: threadView(operator, th), messages: th.messages } satisfies ThreadDetail as T;
    }
  }

  const guestLinkMatch = /^\/v1\/reservations\/([0-9a-f-]{36})\/guest-link$/.exec(path);
  if (method === 'GET' && guestLinkMatch?.[1]) {
    const { operator } = access(options.orgId, 'reservations.write');
    const stay = findStay(operator, guestLinkMatch[1]);
    if (!stay.guestKey) {
      stay.guestKey = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
        b.toString(16).padStart(2, '0'),
      ).join('');
      save();
    }
    return { key: stay.guestKey, path: `/stay/${stay.guestKey}` } satisfies GuestLink as T;
  }

  const stayMatch = /^\/v1\/stay\/([0-9a-f]{32})$/.exec(path);
  if (method === 'GET' && stayMatch?.[1]) {
    return demoGuestStay(s, stayMatch[1]) as T;
  }

  if (method === 'POST' && path === '/v1/reservations') {
    const { operator } = access(options.orgId, 'reservations.write');
    const parsed = ReservationCreateSchema.safeParse(options.body);
    if (!parsed.success) invalid(parsed.error.issues);
    const b = parsed.data;
    const property = findProperty(operator, b.propertyId);
    const taken =
      operator.calendar.stays.some(
        (x) =>
          x.propertyId === property.id &&
          x.status === 'confirmed' &&
          x.checkIn < b.checkOut &&
          b.checkIn < x.checkOut,
      ) ||
      operator.calendar.blocks.some(
        (bl) => bl.propertyId === property.id && bl.startsOn < b.checkOut && b.checkIn < bl.endsOn,
      );
    if (taken) {
      throw new ApiError(
        409,
        'nights_taken',
        `${property.name} is not free for ${b.checkIn} to ${b.checkOut}: another booking or a block holds those nights.`,
      );
    }
    const now = new Date().toISOString();
    const stay: DemoStay = {
      id: crypto.randomUUID(),
      propertyId: property.id,
      checkIn: b.checkIn,
      checkOut: b.checkOut,
      status: 'confirmed',
      channel: 'direct',
      channelReference: null,
      guestName: b.guestName,
      guests: b.adults + b.children,
      adults: b.adults,
      children: b.children,
      infants: b.infants,
      guestEmail: b.guestEmail?.toLowerCase() || null,
      guestPhone: b.guestPhone || null,
      currency: operator.workspace.settings.currency,
      totalMinor: b.totalMinor ?? null,
      payoutMinor: null,
      checkInTime: b.checkInTime ?? null,
      checkOutTime: b.checkOutTime ?? null,
      notes: b.notes || null,
      createdAt: now,
      updatedAt: now,
      cancelledAt: null,
    };
    operator.calendar.stays.push(stay);
    save();
    return toReservation(operator, stay) as T;
  }

  const moneyMatch =
    /^\/v1\/reservations\/([0-9a-f-]{36})\/(charges|payments|cancel)(?:\/([0-9a-f-]{36}))?$/.exec(path);
  if (moneyMatch?.[1]) {
    const [, stayId, what, itemId] = moneyMatch;
    if (what === 'cancel' && method === 'POST') {
      const { operator } = access(options.orgId, 'reservations.write');
      const stay = findStay(operator, stayId);
      const parsed = ReservationCancelSchema.safeParse(options.body);
      if (!parsed.success) invalid(parsed.error.issues);
      if (stay.channel !== 'direct')
        throw new ApiError(
          400,
          'cancel_on_channel',
          'This booking came from a channel; cancel it there and it arrives here.',
        );
      if (stay.status === 'cancelled')
        throw new ApiError(400, 'already_cancelled', 'This booking is already cancelled.');
      stay.status = 'cancelled';
      stay.cancelledAt = new Date().toISOString();
      stay.cancellationReason = parsed.data.reason;
      stay.cancelledBy = operator.team.find((m) => m.email === DEMO_USER.email)?.fullName ?? 'Demo user';
      stay.updatedAt = stay.cancelledAt;
      save();
      return toReservation(operator, stay) as T;
    }
    const { operator } = access(options.orgId, 'money.write');
    const stay = findStay(operator, stayId);
    const by = operator.team.find((m) => m.email === DEMO_USER.email)?.fullName ?? 'Demo user';
    if (method === 'POST' && what === 'charges') {
      const parsed = ChargeCreateSchema.safeParse(options.body);
      if (!parsed.success) invalid(parsed.error.issues);
      stay.charges ??= [];
      stay.charges.push({
        id: crypto.randomUUID(),
        ...parsed.data,
        createdBy: by,
        createdAt: new Date().toISOString(),
      });
      save();
      return toReservation(operator, stay) as T;
    }
    if (method === 'POST' && what === 'payments') {
      const parsed = PaymentCreateSchema.safeParse(options.body);
      if (!parsed.success) invalid(parsed.error.issues);
      stay.payments ??= [];
      stay.payments.push({
        id: crypto.randomUUID(),
        amountMinor: parsed.data.amountMinor,
        method: parsed.data.method,
        paidOn: parsed.data.paidOn,
        note: parsed.data.note || null,
        recordedBy: by,
        createdAt: new Date().toISOString(),
      });
      stay.payments.sort((a, b) => a.paidOn.localeCompare(b.paidOn));
      save();
      return toReservation(operator, stay) as T;
    }
    if (method === 'DELETE' && itemId) {
      if (what === 'charges') stay.charges = (stay.charges ?? []).filter((c) => c.id !== itemId);
      else stay.payments = (stay.payments ?? []).filter((p) => p.id !== itemId);
      save();
      return toReservation(operator, stay) as T;
    }
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

// The Inbox: a thread per booking, with the automatic messages the worker would have sent ------------

const SITE_CHATS = new Set(['airbnb', 'booking_com', 'vrbo', 'expedia']);

function viaOf(stay: DemoStay): MessageVia | null {
  if (SITE_CHATS.has(stay.channel)) return stay.channel as MessageVia;
  if (stay.guestEmail) return 'email';
  if (stay.guestPhone) return 'sms';
  return null;
}

function standardMessageTemplates(): MessageTemplate[] {
  return [
    {
      id: crypto.randomUUID(),
      name: 'Booking confirmed',
      trigger: 'booking_confirmed',
      sendTime: null,
      body: 'Hi {{guest_first_name}},\n\nThank you for booking {{property}}. We have you from {{check_in}} to {{check_out}}, {{nights}} nights.\n\nEverything you need for your stay is on your page, which fills in as the day comes: {{stay_link}}\n\nIf anything comes up before then, just reply here.\n\n{{operator}}',
      enabled: true,
      position: 1,
    },
    {
      id: crypto.randomUUID(),
      name: 'The day before arrival',
      trigger: 'before_arrival',
      sendTime: '10:00',
      body: 'Hi {{guest_first_name}},\n\nYou arrive tomorrow. Check-in at {{property}} is from {{check_in_time}}. Your page has the address, how to get in, and the Wi-Fi; the door code appears there on the day: {{stay_link}}\n\nSafe travels,\n{{operator}}',
      enabled: true,
      position: 2,
    },
    {
      id: crypto.randomUUID(),
      name: 'Day of arrival',
      trigger: 'arrival_day',
      sendTime: '09:00',
      body: 'Hi {{guest_first_name}},\n\nToday is the day. From {{check_in_time}} your door code is on your page: {{stay_link}}\n\nReply here if you need anything on the way.\n\n{{operator}}',
      enabled: false,
      position: 3,
    },
    {
      id: crypto.randomUUID(),
      name: 'The day before check-out',
      trigger: 'before_departure',
      sendTime: '17:00',
      body: 'Hi {{guest_first_name}},\n\nA quick note that check-out tomorrow is by {{check_out_time}}. Leave the keys as you found them and pull the door closed behind you.\n\nThank you for staying with us.\n{{operator}}',
      enabled: true,
      position: 4,
    },
  ];
}

function messageTemplatesOf(operator: DemoOperator): MessageTemplate[] {
  operator.messageTemplates ??= standardMessageTemplates();
  return operator.messageTemplates;
}

/** The sample conversations, laid in once per guest: what a week in the Inbox looks like. */
const SAMPLE_CONVERSATIONS: Record<
  string,
  { daysAgo: number; time: string; from: 'guest' | 'team'; body: string }[]
> = {
  'Priya Shah': [
    {
      daysAgo: 2,
      time: '18:40',
      from: 'guest',
      body: 'Hi, we’ve arrived and the top lock code worked first time. Is the heating on a timer?',
    },
    {
      daysAgo: 2,
      time: '19:05',
      from: 'team',
      body: 'Welcome, Priya! Yes: it comes on 6 to 9 in the morning and 4 to 10 at night. The panel by the kitchen door overrides it if you want it warmer.',
    },
  ],
  'Tom Becker': [
    {
      daysAgo: 0,
      time: '-2h',
      from: 'guest',
      body: 'Thanks for this. We’ll be arriving around 13:00 tomorrow. Is an early check-in possible?',
    },
  ],
  'Claire Dubois': [
    { daysAgo: 1, time: '15:12', from: 'guest', body: 'Is there a cot we could use for our baby?' },
    {
      daysAgo: 1,
      time: '15:40',
      from: 'team',
      body: 'There is a travel cot in the cupboard on the landing, with fresh sheets. Let us know if you need anything else.',
    },
  ],
  'Leo Hartmann': [
    {
      daysAgo: 1,
      time: '-26h',
      from: 'guest',
      body: 'Could we leave our bags somewhere until 2pm after check-out tomorrow? Our train is late afternoon.',
    },
  ],
};

function settleThreads(operator: DemoOperator): DemoThread[] {
  operator.threads ??= [];
  const threads = operator.threads;
  const stays = operator.calendar.stays;
  // Bookings laid out again get new ids; their old threads go.
  for (let i = threads.length - 1; i >= 0; i--) {
    if (!stays.some((s) => s.id === threads[i]?.reservationId)) threads.splice(i, 1);
  }
  const tz = operator.workspace.settings.timeZone;
  const today = todayIn(tz);
  const now = Date.now();
  const templates = messageTemplatesOf(operator);
  // Where the demo lives; a file opened from disk has no address, so a stand-in.
  const base = `${window.location.origin.startsWith('http') ? window.location.origin : 'https://v01.example'}/stay/`;
  let changed = false;
  for (const stay of stays) {
    let th = threads.find((x) => x.reservationId === stay.id);
    if (!th) {
      th = {
        id: crypto.randomUUID(),
        reservationId: stay.id,
        status: 'open',
        unread: 0,
        seeded: false,
        messages: [],
      };
      threads.push(th);
      changed = true;
    }
    const via = viaOf(stay);
    if (stay.status !== 'confirmed' || !via) continue;
    const property = operator.properties.find((p) => p.id === stay.propertyId);
    const first = stay.guestName?.trim().split(/\s+/)[0] ?? 'there';
    if (!stay.guestKey) {
      stay.guestKey = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
        b.toString(16).padStart(2, '0'),
      ).join('');
      changed = true;
    }
    const key = stay.guestKey;
    const values = {
      guest_first_name: first,
      guest_name: stay.guestName ?? 'Guest',
      property: property?.name ?? '',
      check_in: longDay(stay.checkIn),
      check_in_time: stay.checkInTime ?? property?.checkInTime?.slice(0, 5) ?? '15:00',
      check_out: longDay(stay.checkOut),
      check_out_time: stay.checkOutTime ?? property?.checkOutTime?.slice(0, 5) ?? '10:00',
      nights: String(nightsBetween(stay.checkIn, stay.checkOut)),
      stay_link: `${base}${key}`,
      operator: operator.workspace.brand.displayName,
      door_code: stayCodes(operator, stay, true).length
        ? demoDoorCode(stay.id)
        : `on your page from the day you arrive: ${base}${key}`,
    };
    // The automatic messages whose moment has come, as the worker sends them.
    for (const tpl of templates) {
      if (!tpl.enabled || tpl.trigger === 'manual') continue;
      if (th.messages.some((m) => m.automatic && m.templateName === tpl.name)) continue;
      let at: Date | null = null;
      if (tpl.trigger === 'booking_confirmed') at = new Date(stay.createdAt);
      else if (tpl.trigger === 'before_arrival')
        at = zonedInstant(addDays(stay.checkIn, -1), tpl.sendTime ?? '10:00', tz);
      else if (tpl.trigger === 'arrival_day') at = zonedInstant(stay.checkIn, tpl.sendTime ?? '09:00', tz);
      else if (tpl.trigger === 'before_departure')
        at = zonedInstant(addDays(stay.checkOut, -1), tpl.sendTime ?? '17:00', tz);
      if (!at || at.getTime() > now) continue;
      // A booking made before the day-before note was due never gets it late; only moments since booking count.
      if (tpl.trigger !== 'booking_confirmed' && at.getTime() < Date.parse(stay.createdAt)) continue;
      th.messages.push({
        id: crypto.randomUUID(),
        threadId: th.id,
        direction: 'out',
        via,
        body: renderTemplate(tpl.body, values),
        status: 'sent',
        note: null,
        sentBy: null,
        automatic: true,
        templateName: tpl.name,
        at: at.toISOString(),
        sentAt: at.toISOString(),
      });
      changed = true;
    }
    // The sample conversation for this guest, once.
    const sample = stay.guestName ? SAMPLE_CONVERSATIONS[stay.guestName] : undefined;
    if (sample && !th.seeded) {
      for (const line of sample) {
        const at = line.time.startsWith('-')
          ? new Date(now - Number(line.time.slice(1, -1)) * 3_600_000)
          : zonedInstant(addDays(today, -line.daysAgo), line.time, tz);
        th.messages.push({
          id: crypto.randomUUID(),
          threadId: th.id,
          direction: line.from === 'guest' ? 'in' : 'out',
          via,
          body: line.body,
          status: line.from === 'guest' ? 'received' : 'sent',
          note: null,
          sentBy: line.from === 'guest' ? null : (operator.team[0]?.fullName ?? 'Demo user'),
          automatic: false,
          templateName: null,
          at: at.toISOString(),
          sentAt: line.from === 'guest' ? null : at.toISOString(),
        });
      }
      const last = sample[sample.length - 1];
      th.unread = last?.from === 'guest' ? 1 : 0;
      th.seeded = true;
      changed = true;
    }
    th.messages.sort((a, b) => a.at.localeCompare(b.at));
  }
  if (changed) save();
  return threads;
}

function threadView(operator: DemoOperator, th: DemoThread): Thread {
  const stay = findStay(operator, th.reservationId);
  const property = operator.properties.find((p) => p.id === stay.propertyId);
  const last = th.messages[th.messages.length - 1] ?? null;
  // The guest's last message with no reply after it.
  let awaitingSince: string | null = null;
  for (const m of th.messages) {
    if (m.direction === 'in') awaitingSince ??= m.at;
    else if (!m.automatic) awaitingSince = null;
  }
  return {
    id: th.id,
    reservationId: stay.id,
    propertyId: stay.propertyId,
    propertyName: property?.name ?? '',
    guestName: stay.guestName,
    guestEmail: stay.guestEmail,
    guestPhone: stay.guestPhone,
    channel: stay.channel,
    reservationStatus: stay.status,
    checkIn: stay.checkIn,
    checkOut: stay.checkOut,
    status: th.status,
    via: viaOf(stay),
    lastMessageAt: last?.at ?? null,
    lastMessage: last
      ? { direction: last.direction, body: last.body.replace(/\s+/g, ' ').slice(0, 140), at: last.at }
      : null,
    unread: th.unread,
    awaitingSince,
  };
}

function demoThreadList(
  operator: DemoOperator,
  query: { view: 'awaiting' | 'open' | 'all'; q?: string },
): ThreadList {
  const all = settleThreads(operator).map((th) => threadView(operator, th));
  const q = query.q?.trim().toLowerCase();
  const matches = (t: Thread) =>
    !q ||
    (t.guestName ?? '').toLowerCase().includes(q) ||
    t.propertyName.toLowerCase().includes(q) ||
    (operator.calendar.stays.find((s) => s.id === t.reservationId)?.channelReference ?? '')
      .toLowerCase()
      .includes(q);
  const byView = (t: Thread) =>
    query.view === 'awaiting'
      ? t.awaitingSince !== null
      : query.view === 'open'
        ? t.status === 'open' && t.lastMessageAt !== null
        : true;
  const threads = all
    .filter((t) => byView(t) && matches(t))
    .sort((a, b) => {
      if (a.lastMessageAt && b.lastMessageAt) return b.lastMessageAt.localeCompare(a.lastMessageAt);
      if (a.lastMessageAt) return -1;
      if (b.lastMessageAt) return 1;
      return b.checkIn.localeCompare(a.checkIn);
    });
  return {
    threads,
    counts: {
      awaiting: all.filter((t) => t.awaitingSince !== null).length,
      open: all.filter((t) => t.status === 'open' && t.lastMessageAt !== null).length,
    },
  };
}
