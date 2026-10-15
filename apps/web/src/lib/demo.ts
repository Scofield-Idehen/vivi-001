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
  type Channel,
  type ConsoleOperator,
  type ConsoleOperatorDetail,
  type ConsoleOperatorList,
  type ConsoleOverview,
  type ConsoleSync,
  type ConsoleSyncRow,
  can,
  countBeds,
  eachNight,
  formatMoney,
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
  channelAccounts: { channel: Channel; connected: boolean }[];
  live: DemoLive;
  calendar: DemoCalendar;
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
  version: 7;
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
    photoCount: 0,
    tags: p.tags ?? [],
    createdAt,
    ...listingDefaults(),
    title: p.title ?? null,
    amenities: p.amenities ?? [],
    basePriceMinor: p.usual?.base ?? null,
    weekendPriceMinor: p.usual?.weekend ?? null,
    minNights: p.usual?.minNights ?? 1,
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
    version: 7,
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
        live: NO_ACTIVITY,
        calendar: { nights: [], stays: [], blocks: [] },
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
          { channel: 'airbnb', connected: true },
          { channel: 'airbnb', connected: true },
          { channel: 'booking_com', connected: true },
          { channel: 'vrbo', connected: false },
        ],
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
          { channel: 'airbnb', connected: false },
          { channel: 'booking_com', connected: false },
        ],
        live: { ...NO_ACTIVITY, lastActivityMinutes: 190 },
        calendar: { nights: [], stays: [], blocks: [] },
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
  return state;
}

/** The invented operators' bookings, laid out from today. */
function layOutSamples(s: DemoState): void {
  s.calendarFrom = demoToday();
  for (const operator of s.operators) {
    const id = operator.workspace.organisation.id;
    if (SAMPLE_CALENDARS[id]) operator.calendar = sampleCalendar(id, operator.properties, s.calendarFrom);
  }
}

let state: DemoState | null = null;

function load(): DemoState {
  if (state) return state;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as DemoState;
      if (parsed.version === 7) {
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
  const connected = o.channelAccounts.filter((a) => a.connected);
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
async function resolved(detail: PropertyDetail): Promise<PropertyDetail> {
  const photos: PropertyDetail['photos'] = [];
  for (const photo of detail.photos) {
    const url = photo.url.startsWith('demo-photo:') ? await demoPhotoUrl(photo.url.slice(11)) : photo.url;
    if (url) photos.push({ ...photo, url, position: photos.length });
  }
  return { ...detail, photos, coverPhotoUrl: photos[0]?.url ?? null, photoCount: photos.length };
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

const PROPERTY_PATH = /^\/v1\/properties\/([0-9a-f-]{36})(\/rooms|\/amenities|\/photos\/order)?$/;
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
      const { operator } = access(options.orgId, 'properties.read');
      return (await resolved(findProperty(operator, id))) as T;
    }
    const { operator } = access(options.orgId, 'properties.write');
    const property = findProperty(operator, id);

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
