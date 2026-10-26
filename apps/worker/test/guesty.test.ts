import { WorkerDatabase } from '@v01/db';
import { createTestDatabase, seedOperator, type TestDatabase } from '@v01/db/testing';
import { GuestyClient, type GuestyListing, type GuestyReservation, SecretBox } from '@v01/integrations';
import { addDays } from '@v01/shared';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { silentLogger } from '../src/deps.ts';
import { importFromGuesty } from '../src/guesty/import.ts';
import {
  amenityCodes,
  calendarChanges,
  channelOf,
  countryCodeOf,
  messageFromPost,
  propertyFromListing,
  propertyTypeOf,
  reservationFrom,
  reservationStatusOf,
} from '../src/guesty/mapping.ts';
import { GuestySnapshot } from '../src/guesty/snapshot.ts';

/**
 * The import from Guesty, against a stand-in for Guesty's Open API: a small account with two
 * homes, a multi-unit parent, bookings of every kind and a calendar with blocks and own prices.
 */

const TODAY = '2026-10-15';
const day = (n: number) => addDays(TODAY, n);
const ORG = { currency: 'GBP', countryCode: 'GB', timeZone: 'Europe/London' };

const HARBOUR: GuestyListing = {
  _id: 'L1',
  title: 'Harbourside house with sea views and a hot tub, sleeps six in comfort',
  nickname: 'Harbour House',
  active: true,
  type: 'SINGLE',
  accommodates: 6,
  bedrooms: 3,
  beds: 4,
  bathrooms: 2.5,
  propertyType: 'House',
  roomType: 'Entire home/apt',
  address: { street: '4 Quay Lane', city: 'Oban', country: 'United Kingdom', zipcode: 'PA34 4AA' },
  amenities: ['Wireless Internet', 'Kitchen', 'Hot tub', 'Washer', 'Free parking on premises', 'Teleporter'],
  pictures: [
    { _id: 'p1', original: 'https://cdn.guesty.test/l1/1.jpg', caption: 'The front' },
    { _id: 'p2', original: 'https://cdn.guesty.test/l1/2.jpg' },
  ],
  terms: { minNights: 2, maxNights: 21 },
  prices: {
    currency: 'GBP',
    basePrice: 150,
    weekendBasePrice: 180,
    cleaningFee: 60,
    extraPersonFee: 20,
    guestsIncludedInRegularFee: 4,
    securityDepositFee: 250,
  },
  publicDescription: {
    summary: 'A house by the harbour.',
    space: 'Three bedrooms.',
    houseRules: 'No parties.',
  },
  defaultCheckInTime: '16:00',
  defaultCheckOutTime: '10:00',
  integrations: [
    { _id: 'i1', platform: 'airbnb2', externalId: '5550001', airbnb: { hostId: 'host-a' } },
    { _id: 'i2', platform: 'bookingCom', externalId: '7731204', bookingCom: { accountId: 'bc-1' } },
  ],
  tags: ['harbour', 'hot tub'],
  customFields: [
    { fieldId: 'cf-top', value: '4321' },
    { fieldId: 'cf-wifi', value: 'HarbourNet' },
    { fieldId: 'cf-bin', value: 'Thursday' },
  ],
  houseRules: { petsAllowed: true, smokingAllowed: false },
};

const MILL: GuestyListing = {
  _id: 'L2',
  title: 'Mill Street Flat',
  nickname: 'Mill Street Flat',
  active: false,
  type: 'SINGLE',
  accommodates: 2,
  propertyType: 'Apartment',
  address: { city: 'Oban', country: 'GB' },
  prices: { currency: 'GBP', basePrice: 90 },
  integrations: [{ _id: 'i3', platform: 'airbnb2', externalId: '5550002', airbnb: { hostId: 'host-b' } }],
};

const PARENT: GuestyListing = {
  _id: 'L3',
  title: 'The Mews (all units)',
  type: 'MTL',
  active: true,
  accommodates: 10,
};

const RESERVATIONS: GuestyReservation[] = [
  {
    _id: 'R1',
    listingId: 'L1',
    status: 'confirmed',
    checkInDateLocalized: day(10),
    checkOutDateLocalized: day(13),
    guest: { fullName: 'Hannah Lee', email: 'Hannah@Guest.Example', phone: '+44 7700 900123' },
    numberOfGuests: { numberOfAdults: 2, numberOfChildren: 1, numberOfInfants: 0 },
    integration: { platform: 'airbnb2' },
    confirmationCode: 'HMGUESTY01',
    money: { currency: 'GBP', totalPrice: 540, hostPayout: 500 },
    plannedArrival: '17:00',
  },
  {
    _id: 'R2',
    listingId: 'L1',
    status: 'canceled',
    checkInDateLocalized: day(20),
    checkOutDateLocalized: day(22),
    guest: { fullName: 'Owen Price' },
    source: 'bookingCom',
    confirmationCode: '4311850297',
    canceledAt: '2026-10-01T10:00:00Z',
  },
  {
    _id: 'R3',
    listingId: 'L1',
    status: 'confirmed',
    checkInDateLocalized: day(12),
    checkOutDateLocalized: day(14),
    guest: { fullName: 'Ravi Kumar', email: 'hannah@guest.example' },
    source: 'manual',
  },
  {
    _id: 'R4',
    listingId: 'L9',
    status: 'confirmed',
    checkInDateLocalized: day(1),
    checkOutDateLocalized: day(2),
  },
  {
    _id: 'R5',
    listingId: 'L1',
    status: 'inquiry',
    checkInDateLocalized: day(30),
    checkOutDateLocalized: day(33),
  },
];

function stubGuesty(options: { listings?: GuestyListing[]; reservations?: GuestyReservation[] } = {}) {
  const listings = options.listings ?? [HARBOUR, MILL, PARENT];
  const reservations = options.reservations ?? RESERVATIONS;
  const paths: string[] = [];
  const page = (items: unknown[], url: URL) => {
    const limit = Number(url.searchParams.get('limit') ?? 25);
    const skip = Number(url.searchParams.get('skip') ?? 0);
    return { results: items.slice(skip, skip + limit), count: items.length, limit, skip };
  };
  const impl = (async (rawUrl: string) => {
    const url = new URL(rawUrl);
    paths.push(url.pathname);
    if (url.pathname === '/oauth2/token') {
      return new Response(JSON.stringify({ access_token: 'tok', expires_in: 86_400 }), {
        status: 200,
        headers: { 'x-ratelimit-remaining-day': '4' },
      });
    }
    if (url.pathname === '/v1/communication/conversations') {
      const wanted = JSON.parse(url.searchParams.get('filters') ?? '[]')[0]?.value ?? [];
      const all = [
        { _id: 'C1', meta: { reservations: [{ _id: 'R1' }] } },
        { _id: 'C3', reservation: { _id: 'R3' } },
      ].filter((c) => wanted.includes(c.meta?.reservations?.[0]?._id ?? c.reservation?._id));
      return Response.json({ status: 200, data: { conversations: all, cursor: { after: null } } });
    }
    if (url.pathname === '/v1/communication/conversations/C1/posts') {
      // Two pages, to follow the cursor.
      if (!url.searchParams.get('cursorAfter')) {
        return Response.json({
          data: {
            posts: [
              {
                _id: 'P1',
                module: 'airbnb2',
                type: 'fromGuest',
                body: 'Hi! Can we arrive at 2?',
                createdAt: `${day(-3)}T09:00:00Z`,
              },
              {
                _id: 'P2',
                module: 'log',
                type: 'fromGuesty',
                body: 'Reservation confirmed',
                createdAt: `${day(-3)}T09:01:00Z`,
              },
            ],
            cursor: { after: 'next' },
          },
        });
      }
      return Response.json({
        data: {
          posts: [
            {
              _id: 'P3',
              module: 'airbnb2',
              type: 'fromHost',
              body: '<p>Of course &amp; welcome!</p>',
              createdAt: `${day(-3)}T10:00:00Z`,
              isAutomatic: false,
            },
          ],
          cursor: { after: null },
        },
      });
    }
    if (url.pathname === '/v1/communication/conversations/C3/posts') {
      return Response.json({
        data: {
          posts: [
            {
              _id: 'P9',
              module: 'email',
              type: 'fromGuest',
              body: 'Is there parking?',
              createdAt: `${day(-1)}T08:00:00Z`,
            },
          ],
        },
      });
    }
    if (url.pathname === '/v1/listings') return Response.json(page(listings, url));
    if (url.pathname === '/v1/reservations') return Response.json(page(reservations, url));
    if (url.pathname === '/v1/properties-api/custom-fields/L1') {
      return Response.json([
        { fieldId: 'cf-top', displayName: 'Top Lock', value: '4321' },
        { fieldId: 'cf-wifi', displayName: 'WiFi name', value: 'HarbourNet' },
        { fieldId: 'cf-bin', displayName: 'Bin day', value: 'Thursday' },
      ]);
    }
    if (url.pathname.startsWith('/v1/availability-pricing/api/calendar/listings/L1')) {
      const from = url.searchParams.get('startDate') as string;
      const days = [];
      for (let d = from; d <= (url.searchParams.get('endDate') as string); d = addDays(d, 1)) {
        const n = Math.round((Date.parse(d) - Date.parse(TODAY)) / 86_400_000);
        days.push({
          date: d,
          status: n === 3 || n === 4 ? 'unavailable' : n >= 10 && n < 13 ? 'booked' : 'available',
          price: n === 6 ? 210 : [5, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay()) ? 180 : 150,
          isBasePrice: n !== 6,
          minNights: n === 7 ? 4 : 2,
          isBaseMinNights: n !== 7,
          cta: n === 8,
          blocks: n === 3 || n === 4 ? { m: true } : n >= 10 && n < 13 ? { b: true } : {},
          note: n === 3 || n === 4 ? 'Owner stay' : null,
        });
      }
      return Response.json({ status: 200, data: { days } });
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
  const client = new GuestyClient({ clientId: 'id', clientSecret: 'secret', fetch: impl });
  return { client, paths };
}

describe('Guesty words into V-01 words', () => {
  it('reads a Guesty message: who wrote it, by what, as plain text; leaves log lines and notes', () => {
    expect(
      messageFromPost(
        {
          _id: 'p1',
          module: 'email',
          type: 'fromHost',
          body: '<div>Hi Sam,<br>See you <b>Friday</b> &amp; thanks</div>',
          createdAt: '2026-10-01T10:00:00Z',
        },
        'airbnb',
      ),
    ).toEqual({
      externalId: 'guesty:p1',
      direction: 'out',
      via: 'email',
      body: 'Hi Sam,\nSee you Friday & thanks',
      at: '2026-10-01T10:00:00.000Z',
      automatic: false,
    });
    expect(
      messageFromPost(
        { _id: 'p2', type: 'fromGuest', body: 'Hello', createdAt: '2026-10-01T10:00:00Z' },
        'booking_com',
      ),
    ).toMatchObject({
      direction: 'in',
      via: 'booking_com',
    });
    expect(
      messageFromPost(
        { _id: 'p3', module: 'log', body: 'Status changed', createdAt: '2026-10-01T10:00:00Z' },
        'email',
      ),
    ).toBeNull();
    expect(
      messageFromPost(
        { _id: 'p4', module: 'sms', type: 'fromGuest', body: '   ', createdAt: '2026-10-01T10:00:00Z' },
        'email',
      ),
    ).toBeNull();
  });

  it('maps channels, countries, property types and booking statuses', () => {
    expect(channelOf('airbnb2')).toBe('airbnb');
    expect(channelOf('bookingCom')).toBe('booking_com');
    expect(channelOf('homeaway')).toBe('vrbo');
    expect(channelOf('manual')).toBeNull();
    expect(countryCodeOf('United Kingdom')).toBe('GB');
    expect(countryCodeOf('gb')).toBe('GB');
    expect(countryCodeOf('Narnia')).toBeNull();
    expect(propertyTypeOf('Serviced apartment')).toBe('serviced_apartment');
    expect(propertyTypeOf('Condominium')).toBe('flat');
    expect(propertyTypeOf('Yurt')).toBe('unusual');
    expect(reservationStatusOf('closed')).toBe('confirmed');
    expect(reservationStatusOf('reserved')).toBe('request');
    expect(reservationStatusOf('declined')).toBe('cancelled');
    expect(reservationStatusOf('weird')).toBeNull();
  });

  it('matches amenity names and reports the rest', () => {
    expect(amenityCodes(['Wireless Internet', 'Hot tub', 'Washer', 'Teleporter'])).toEqual({
      codes: ['hot_tub', 'washing_machine', 'wifi'],
      unknown: ['Teleporter'],
    });
  });

  it('builds a property with prices in pence, a cut title and the warnings to look at', () => {
    const mapped = propertyFromListing(HARBOUR, ORG);
    expect(mapped.values).toMatchObject({
      name: 'Harbour House',
      title: 'Harbourside house with sea views and a hot tub, sl',
      countryCode: 'GB',
      propertyType: 'house',
      spaceType: 'entire_place',
      bathrooms: 2.5,
      maxGuests: 6,
      checkInTime: '16:00',
      minNights: 2,
      maxNights: 21,
      basePriceMinor: 15_000,
      weekendPriceMinor: 18_000,
      cleaningFeeMinor: 6_000,
      extraGuestFeeMinor: 2_000,
      extraGuestFrom: 5,
      securityDepositMinor: 25_000,
      petsAllowed: true,
      tags: ['harbour', 'hot tub'],
    });
    expect(mapped.amenities).toEqual(['free_parking', 'hot_tub', 'kitchen', 'washing_machine', 'wifi']);
    expect(mapped.photos).toHaveLength(2);
    expect(mapped.warnings).toEqual([
      'Amenities without a match: Teleporter.',
      'The listing title was cut to 50 characters.',
    ]);
  });

  it('builds a booking with the channel code as its reference', () => {
    const r = reservationFrom(RESERVATIONS[0] as GuestyReservation, ORG);
    expect(r).toMatchObject({
      ok: true,
      value: {
        status: 'confirmed',
        channel: 'airbnb',
        channelReference: 'HMGUESTY01',
        adults: 2,
        children: 1,
        totalMinor: 54_000,
        payoutMinor: 50_000,
        checkInTime: '17:00',
        guest: { fullName: 'Hannah Lee', email: 'hannah@guest.example' },
      },
    });
    expect(
      reservationFrom(
        {
          _id: 'x',
          status: 'confirmed',
          checkInDateLocalized: '2026-01-02',
          checkOutDateLocalized: '2026-01-01',
        },
        ORG,
      ),
    ).toMatchObject({ ok: false });
  });

  it('reads blocks and own prices from a calendar, and leaves booked nights to the bookings', () => {
    const { blocks, nights } = calendarChanges(
      [
        {
          date: '2026-11-02',
          status: 'unavailable',
          blocks: { m: true },
          note: 'Owner',
          price: 150,
          isBasePrice: true,
        },
        {
          date: '2026-11-03',
          status: 'unavailable',
          blocks: { m: true },
          note: 'Owner',
          price: 150,
          isBasePrice: true,
        },
        { date: '2026-11-04', status: 'booked', blocks: { b: true }, price: 150, isBasePrice: true },
        {
          date: '2026-11-05',
          status: 'available',
          price: 199,
          isBasePrice: false,
          minNights: 3,
          isBaseMinNights: false,
          ctd: true,
        },
      ],
      { basePriceMinor: 15_000, weekendPriceMinor: null, minNights: 2 },
      'GBP',
    );
    expect(blocks).toEqual([{ startsOn: '2026-11-02', endsOn: '2026-11-04', reason: 'Owner' }]);
    expect(nights).toEqual([
      {
        night: '2026-11-05',
        priceMinor: 19_900,
        minNights: 3,
        closedToArrival: false,
        closedToDeparture: true,
      },
    ]);
  });
});

describe('importing an account', () => {
  let t: TestDatabase;
  let worker: WorkerDatabase;
  let op: { orgId: string; userId: string };
  const box = new SecretBox('test-field-secret-key-with-32-chars-at-least');
  const deps = () => ({ db: worker, log: silentLogger });
  const now = new Date(`${TODAY}T09:00:00Z`);

  async function owner<T extends pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> {
    const client = new pg.Client({ connectionString: t.ownerUrl });
    await client.connect();
    try {
      return (await client.query<T>(text, values)).rows;
    } finally {
      await client.end();
    }
  }

  beforeAll(async () => {
    t = await createTestDatabase();
    op = await seedOperator(t.ownerUrl, {
      name: 'Vivistays',
      slug: 'vivistays',
      userEmail: 'ops@example.test',
    });
    worker = new WorkerDatabase(t.workerUrl);
  });

  afterAll(async () => {
    await worker?.close();
    await t?.drop();
  });

  it('starts every workspace with the standard custom fields', async () => {
    const fields = await owner<{ name: string; kind: string }>(
      'select name, kind from app.custom_fields where organisation_id = $1 order by position',
      [op.orgId],
    );
    expect(fields).toEqual([
      { name: 'Top lock code', kind: 'secret' },
      { name: 'Bottom lock code', kind: 'secret' },
      { name: 'Wi-Fi name', kind: 'text' },
      { name: 'Wi-Fi password', kind: 'secret' },
      { name: 'Check-in instructions', kind: 'link' },
    ]);
  });

  it('adds any standard field that is missing, and leaves the team\u2019s own fields alone', async () => {
    await owner(
      "delete from app.custom_fields where organisation_id = $1 and name in ('Wi-Fi name', 'Wi-Fi password')",
      [op.orgId],
    );
    await owner(
      "insert into app.custom_fields (organisation_id, name, kind, position) values ($1, 'Parking', 'text', 9)",
      [op.orgId],
    );
    const [added] = await owner<{ n: number }>('select app.standard_custom_fields($1) as n', [op.orgId]);
    expect(added?.n).toBe(2);
    const names = await owner<{ name: string }>(
      'select name from app.custom_fields where organisation_id = $1 order by position, name',
      [op.orgId],
    );
    expect(names.map((f) => f.name)).toEqual([
      'Top lock code',
      'Bottom lock code',
      'Check-in instructions',
      'Parking',
      'Wi-Fi name',
      'Wi-Fi password',
    ]);
    await owner("delete from app.custom_fields where organisation_id = $1 and name = 'Parking'", [op.orgId]);
  });

  it('rehearses without keeping anything', async () => {
    const { client } = stubGuesty();
    const summary = await importFromGuesty(deps(), {
      orgId: op.orgId,
      guesty: client,
      box,
      dryRun: true,
      now,
    });
    expect(summary.listings).toMatchObject({ seen: 3, created: 2, archived: 1 });
    expect(summary.listings.skipped).toEqual(['The Mews (all units): multi-unit parent']);
    expect(await owner('select id from app.properties where organisation_id = $1', [op.orgId])).toEqual([]);
    expect(await owner('select id from app.guesty_imports where organisation_id = $1', [op.orgId])).toEqual(
      [],
    );
  });

  it('brings the listings in as properties Guesty still runs, with everything on them', async () => {
    const { client } = stubGuesty();
    const summary = await importFromGuesty(deps(), { orgId: op.orgId, guesty: client, box, now });
    expect(summary.listings).toMatchObject({ seen: 3, created: 2, updated: 0, archived: 1 });
    expect(summary.tokensRemainingToday).toBe(4);

    const props = await owner<Record<string, unknown>>(
      `select name, managed_by, archived_at is not null as archived, base_price_minor, max_guests, country_code,
              check_in_time::text as check_in, tags, pets_allowed
         from app.properties where organisation_id = $1 order by name`,
      [op.orgId],
    );
    expect(props).toEqual([
      expect.objectContaining({
        name: 'Harbour House',
        managed_by: 'guesty',
        archived: false,
        base_price_minor: 15000,
        max_guests: 6,
        country_code: 'GB',
        check_in: '16:00:00',
        tags: ['harbour', 'hot tub'],
        pets_allowed: true,
      }),
      expect.objectContaining({
        name: 'Mill Street Flat',
        managed_by: 'guesty',
        archived: true,
        base_price_minor: 9000,
        max_guests: 2,
      }),
    ]);

    const [amenities] = await owner<{ codes: string[] }>(
      `select array_agg(a.code order by a.code) as codes from app.property_amenities a
         join app.properties p on p.id = a.property_id where p.name = 'Harbour House'`,
    );
    expect(amenities?.codes).toEqual(['free_parking', 'hot_tub', 'kitchen', 'washing_machine', 'wifi']);
    const photos = await owner<{ storage_path: string; url: string; position: number }>(
      `select ph.storage_path, ph.url, ph.position from app.property_photos ph
         join app.properties p on p.id = ph.property_id where p.name = 'Harbour House' order by position`,
    );
    expect(photos).toEqual([
      { storage_path: 'guesty/L1/p1', url: 'https://cdn.guesty.test/l1/1.jpg', position: 0 },
      { storage_path: 'guesty/L1/p2', url: 'https://cdn.guesty.test/l1/2.jpg', position: 1 },
    ]);
  });

  it('fills the standard custom fields, seals the lock code, and adds a field for what Guesty has besides', async () => {
    const values = await owner<{ name: string; kind: string; value: string | null; secret: Buffer | null }>(
      `select f.name, f.kind, v.value, v.secret from app.property_field_values v
         join app.custom_fields f on f.id = v.field_id
         join app.properties p on p.id = v.property_id
        where p.name = 'Harbour House' order by f.position`,
    );
    expect(values.map((v) => [v.name, v.kind, v.value])).toEqual([
      ['Top lock code', 'secret', null],
      ['Wi-Fi name', 'text', 'HarbourNet'],
      ['Bin day', 'text', 'Thursday'],
    ]);
    expect(box.open(values[0]?.secret as Buffer)).toBe('4321');
  });

  it('keeps the account map: one V-01 channel account per account Guesty’s listings sit on', async () => {
    const accounts = await owner<{ label: string; channel: string; status: string; key: string }>(
      `select a.label, a.channel, a.status, g.account_key as key from app.guesty_accounts g
         join app.channel_accounts a on a.id = g.channel_account_id where g.organisation_id = $1 order by a.label`,
      [op.orgId],
    );
    expect(accounts).toEqual([
      { label: 'Airbnb A', channel: 'airbnb', status: 'disconnected', key: 'host-a' },
      { label: 'Airbnb B', channel: 'airbnb', status: 'disconnected', key: 'host-b' },
      { label: 'Booking.com A', channel: 'booking_com', status: 'disconnected', key: 'bc-1' },
    ]);
    const listings = await owner<{ name: string; channel: string; external_listing_id: string }>(
      `select p.name, l.channel, l.external_listing_id from app.guesty_channel_listings l
         join app.properties p on p.id = l.property_id order by p.name, l.channel`,
    );
    expect(listings).toEqual([
      { name: 'Harbour House', channel: 'airbnb', external_listing_id: '5550001' },
      { name: 'Harbour House', channel: 'booking_com', external_listing_id: '7731204' },
      { name: 'Mill Street Flat', channel: 'airbnb', external_listing_id: '5550002' },
    ]);
  });

  it('brings the calendar: hand-made blocks and nights with their own price or rules', async () => {
    const blocks = await owner<{ starts_on: string; ends_on: string; reason: string }>(
      `select b.starts_on::text, b.ends_on::text, b.reason from app.blocks b
         join app.properties p on p.id = b.property_id where p.name = 'Harbour House' order by starts_on`,
    );
    expect(blocks).toEqual([{ starts_on: day(3), ends_on: day(5), reason: 'Blocked in Guesty: Owner stay' }]);
    const nights = await owner<{
      night: string;
      price_minor: number | null;
      min_nights: number | null;
      cta: boolean;
    }>(
      `select d.night::text, d.price_minor, d.min_nights, d.closed_to_arrival as cta from app.calendar_days d
         join app.properties p on p.id = d.property_id where p.name = 'Harbour House' order by night`,
    );
    expect(nights).toEqual([
      { night: day(6), price_minor: 21_000, min_nights: null, cta: false },
      { night: day(7), price_minor: null, min_nights: 4, cta: false },
      { night: day(8), price_minor: null, min_nights: null, cta: true },
    ]);
  });

  it('brings the bookings with their guests, keeps an overlap as a conflict, and skips what it can’t place', async () => {
    const rows = await owner<Record<string, unknown>>(
      `select r.status, r.channel, r.channel_reference as ref, r.check_in::text, g.full_name as guest, g.email,
              r.total_minor::int as total_minor, r.check_in_time::text as arrival
         from app.reservations r left join app.guests g on g.id = r.guest_id
        where r.organisation_id = $1 order by r.check_in`,
      [op.orgId],
    );
    expect(rows).toEqual([
      expect.objectContaining({
        status: 'confirmed',
        channel: 'airbnb',
        ref: 'HMGUESTY01',
        guest: 'Hannah Lee',
        email: 'hannah@guest.example',
        total_minor: 54000,
        arrival: '17:00:00',
      }),
      expect.objectContaining({
        status: 'conflict',
        channel: 'direct',
        ref: 'guesty:R3',
        guest: 'Hannah Lee',
      }),
      expect.objectContaining({
        status: 'cancelled',
        channel: 'booking_com',
        ref: '4311850297',
        guest: 'Owen Price',
      }),
      expect.objectContaining({ status: 'inquiry', channel: 'direct', ref: 'guesty:R5' }),
    ]);
    // Ravi shares Hannah's email, so he is the same guest record, not a second one.
    expect(await owner('select id from app.guests where organisation_id = $1', [op.orgId])).toHaveLength(2);
    const [run] = await owner<{ summary: { reservations: { skipped: string[]; conflicts: number } } }>(
      'select summary from app.guesty_imports where organisation_id = $1 and not dry_run order by started_at desc limit 1',
      [op.orgId],
    );
    expect(run?.summary.reservations).toMatchObject({
      conflicts: 1,
      skipped: ["R4: its listing wasn't imported"],
    });
  });

  it('brings each booking’s guest conversation into its Inbox thread, read and not waiting', async () => {
    const rows = await owner<{ ref: string; direction: string; via: string; body: string; status: string }>(
      `select r.channel_reference as ref, m.direction, m.via, m.body, m.status
         from app.messages m join app.message_threads th on th.id = m.thread_id
         join app.reservations r on r.id = th.reservation_id
        where m.organisation_id = $1 order by m.created_at`,
      [op.orgId],
    );
    expect(rows).toEqual([
      {
        ref: 'HMGUESTY01',
        direction: 'in',
        via: 'airbnb',
        body: 'Hi! Can we arrive at 2?',
        status: 'received',
      },
      { ref: 'HMGUESTY01', direction: 'out', via: 'airbnb', body: 'Of course & welcome!', status: 'sent' },
      { ref: 'guesty:R3', direction: 'in', via: 'email', body: 'Is there parking?', status: 'received' },
    ]);
    const threads = await owner<{ unread_count: number; awaiting: boolean }>(
      `select unread_count, awaiting_since is not null as awaiting from app.message_threads th
         join app.messages m on m.thread_id = th.id where th.organisation_id = $1 group by th.id`,
      [op.orgId],
    );
    expect(threads.every((t) => t.unread_count === 0 && !t.awaiting)).toBe(true);
    const [run] = await owner<{ summary: { messages: unknown } }>(
      'select summary from app.guesty_imports where organisation_id = $1 and not dry_run order by started_at desc limit 1',
      [op.orgId],
    );
    expect(run?.summary.messages).toEqual({ conversations: 2, imported: 3, skipped: 1, failed: 0 });
  });

  it('run again, updates rather than doubles, and follows a listing going inactive', async () => {
    const { client } = stubGuesty({
      listings: [{ ...HARBOUR, nickname: 'Harbour House (renamed)', active: false }, MILL, PARENT],
      reservations: [
        { ...(RESERVATIONS[0] as GuestyReservation), money: { currency: 'GBP', totalPrice: 600 } },
      ],
    });
    const summary = await importFromGuesty(deps(), { orgId: op.orgId, guesty: client, box, now });
    expect(summary.listings).toMatchObject({ created: 0, updated: 2, archived: 2 });
    expect(summary.reservations).toMatchObject({ created: 0, updated: 1 });
    const props = await owner<{ name: string; archived: boolean }>(
      'select name, archived_at is not null as archived from app.properties where organisation_id = $1 order by name',
      [op.orgId],
    );
    expect(props).toEqual([
      { name: 'Harbour House (renamed)', archived: true },
      { name: 'Mill Street Flat', archived: true },
    ]);
    const [booking] = await owner<{ total_minor: number }>(
      "select total_minor::int as total_minor from app.reservations where channel_reference = 'HMGUESTY01'",
    );
    expect(booking?.total_minor).toBe(60_000);
    expect(
      await owner('select id from app.channel_accounts where organisation_id = $1', [op.orgId]),
    ).toHaveLength(3);
    expect(
      await owner("select id from app.property_photos where storage_path like 'guesty/L1/%'"),
    ).toHaveLength(2);
    expect(await owner('select id from app.messages where organisation_id = $1', [op.orgId])).toHaveLength(3);
  });
});

describe('reading Guesty before saving', () => {
  it('reads everything once, and gives back each refusal exactly as Guesty made it', async () => {
    const { client, paths } = stubGuesty();
    const snap = await GuestySnapshot.take(client, {
      today: TODAY,
      calendarDaysAhead: 30,
      bookingsFrom: day(-365),
      messagesFrom: day(-90),
    });
    const before = paths.length;
    const listed = [];
    for await (const l of snap.listings()) listed.push(l._id);
    expect(listed).toEqual(['L1', 'L2', 'L3']);
    expect((await snap.calendar('L1', TODAY, day(29))).length).toBe(30);
    // L2's calendar isn't in the stand-in, so Guesty refused it; the snapshot keeps the refusal.
    await expect(snap.calendar('L2', TODAY, day(29))).rejects.toThrow(/404/);
    const posts = [];
    for await (const p of snap.posts('C1')) posts.push(p._id);
    expect(posts).toEqual(['P1', 'P2', 'P3']);
    // Nothing more is asked of Guesty once the snapshot is taken.
    expect(paths.length).toBe(before);
  });
});
