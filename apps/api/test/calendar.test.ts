import { ApiDatabase } from '@v01/db';
import { createTestDatabase, seedOperator, type TestDatabase } from '@v01/db/testing';
import { addDays, isoWeekday, nightRules, selectedNights, todayIn } from '@v01/shared';
import type { FastifyInstance } from 'fastify';
import { SignJWT } from 'jose';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { createTokenVerifier } from '../src/auth.ts';
import { loadEnv } from '../src/env.ts';

/** The calendar: nightly prices, minimum stays, closed dates and blocks, across properties. */

const JWT_SECRET = 'test-only-jwt-secret-with-enough-length';

let t: TestDatabase;
let db: ApiDatabase;
let app: FastifyInstance;
let a: { orgId: string; userId: string };
let b: { orgId: string; userId: string };
let lodge: string;
let flat: string;
let reader: { orgId: string; userId: string };
const today = todayIn('Europe/London');
const night = (n: number) => addDays(today, n);

type Method = 'GET' | 'PATCH' | 'POST';
type Who = { userId: string; email: string; orgId: string };

async function call(
  method: Method,
  url: string,
  options: { as: Who; body?: unknown },
  // biome-ignore lint/suspicious/noExplicitAny: tests read response bodies loosely; the API's schemas type the real ones
): Promise<{ status: number; body: Record<string, any> }> {
  const jwt = await new SignJWT({ email: options.as.email, role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(options.as.userId)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const response = await app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${jwt}`, 'x-org-id': options.as.orgId },
    payload: options.body as never,
  });
  return { status: response.statusCode, body: response.json() };
}

async function owner<T extends pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> {
  const client = new pg.Client({ connectionString: t.ownerUrl });
  await client.connect();
  try {
    return (await client.query<T>(text, values)).rows;
  } finally {
    await client.end();
  }
}

const asA = (): Who => ({ ...a, email: 'admin-a@example.test' });
const asB = (): Who => ({ ...b, email: 'admin-b@example.test' });
const asReader = (): Who => ({ ...reader, email: 'comms-a@example.test' });
const read = (from: string, to: string, who: Who = asA()) =>
  call('GET', `/v1/calendar?from=${from}&to=${to}`, { as: who });
const change = (body: Record<string, unknown>, who: Who = asA()) =>
  call('PATCH', '/v1/calendar', { as: who, body });

beforeAll(async () => {
  t = await createTestDatabase();
  a = await seedOperator(t.ownerUrl, {
    name: 'Operator A',
    slug: 'operator-a',
    userEmail: 'admin-a@example.test',
  });
  b = await seedOperator(t.ownerUrl, {
    name: 'Operator B',
    slug: 'operator-b',
    userEmail: 'admin-b@example.test',
  });
  const [comms] = await owner<{ id: string }>(
    `insert into app.app_users (id, email) values (gen_random_uuid(), 'comms-a@example.test') returning id`,
  );
  await owner(`insert into app.memberships (organisation_id, user_id, role) values ($1, $2, 'guest_comms')`, [
    a.orgId,
    comms!.id,
  ]);
  reader = { orgId: a.orgId, userId: comms!.id };
  db = new ApiDatabase(t.apiUrl);
  app = await buildApp({
    env: loadEnv({ NODE_ENV: 'test', DATABASE_URL: t.apiUrl, SUPABASE_JWT_SECRET: JWT_SECRET }),
    db,
    verifyToken: createTokenVerifier({ jwtSecret: JWT_SECRET }),
  });

  const created = await call('POST', '/v1/properties', {
    as: asA(),
    body: {
      name: 'Harbour View Lodge',
      countryCode: 'GB',
      maxGuests: 6,
      basePriceMinor: 15_000,
      minPriceMinor: 9_500,
      maxPriceMinor: 40_000,
    },
  });
  lodge = created.body.id;
  await call('PATCH', `/v1/properties/${lodge}`, {
    as: asA(),
    body: { weekendPriceMinor: 19_000, minNights: 2 },
  });
  flat = (
    await call('POST', '/v1/properties', {
      as: asA(),
      body: { name: 'Mill Street Flat', countryCode: 'GB', maxGuests: 2, basePriceMinor: 9_000 },
    })
  ).body.id;
});

afterAll(async () => {
  await app?.close();
  await db?.close();
  await t?.drop();
});

describe('reading the calendar', () => {
  it('lists every property with its usual rules, and today where the operator is', async () => {
    const { status, body } = await read(night(10), night(16));
    expect(status).toBe(200);
    expect(body).toMatchObject({ from: night(10), to: night(16), today, nights: [], stays: [], blocks: [] });
    expect(body.properties.map((p: { name: string }) => p.name)).toEqual([
      'Harbour View Lodge',
      'Mill Street Flat',
    ]);
    expect(body.properties[0]).toMatchObject({
      id: lodge,
      managedBy: 'none',
      priceOwner: 'v01',
      basePriceMinor: 15_000,
      weekendPriceMinor: 19_000,
      minPriceMinor: 9_500,
      maxPriceMinor: 40_000,
      minNights: 2,
      maxNights: null,
      coverPhotoUrl: null,
    });
  });

  it('reads at most two months at a time', async () => {
    expect((await read(night(0), night(61))).status).toBe(200);
    expect((await read(night(0), night(62))).status).toBe(400);
    expect((await read(night(5), night(4))).status).toBe(400);
  });

  it('shows another operator none of it', async () => {
    const { body } = await read(night(0), night(30), asB());
    expect(body.properties).toEqual([]);
  });
});

describe('changing prices and stay rules', () => {
  it('sets a price on some nights, and leaves the rest on the usual price', async () => {
    const { status, body } = await change({
      propertyIds: [lodge],
      firstNight: night(10),
      lastNight: night(12),
      priceMinor: 18_000,
    });
    expect(status).toBe(200);
    expect(body).toEqual({ changedNights: 3, blockedNights: 0, takenNights: 0, reopenedNights: 0 });

    const calendar = (await read(night(10), night(13))).body;
    expect(calendar.nights).toEqual(
      [10, 11, 12].map((n) => ({
        propertyId: lodge,
        night: night(n),
        priceMinor: 18_000,
        minNights: null,
        closedToArrival: false,
        closedToDeparture: false,
      })),
    );
    const usual = calendar.properties[0];
    expect(nightRules(usual, night(11), calendar.nights[1]).priceMinor).toBe(18_000);
    const nextNight = nightRules(usual, night(13), null);
    expect(nextNight.priceFrom).toBe([5, 6].includes(isoWeekday(night(13))) ? 'weekend' : 'usual');
  });

  it('changes nothing, and logs nothing, when the nights already have that price', async () => {
    const before = await owner<{ n: number }>(
      `select count(*)::int as n from app.audit_log where entity_type = 'calendar_days'`,
    );
    const again = await change({
      propertyIds: [lodge],
      firstNight: night(10),
      lastNight: night(12),
      priceMinor: 18_000,
    });
    expect(again.body.changedNights).toBe(0);
    const after = await owner<{ n: number }>(
      `select count(*)::int as n from app.audit_log where entity_type = 'calendar_days'`,
    );
    expect(after[0]!.n).toBe(before[0]!.n);
  });

  it('records who changed a night, with the price before and after', async () => {
    await change({ propertyIds: [lodge], firstNight: night(10), lastNight: night(10), priceMinor: 21_000 });
    const [entry] = await owner<{ actor: string; before: number; after: number }>(
      `select actor_user_id as actor, (before ->> 'price_minor')::int as before, (after ->> 'price_minor')::int as after
         from app.audit_log
        where entity_type = 'calendar_days' and action = 'update'
        order by id desc limit 1`,
    );
    expect(entry).toEqual({ actor: a.userId, before: 18_000, after: 21_000 });
  });

  it('refuses a price outside the limits, naming the property and the limit', async () => {
    const low = await change({
      propertyIds: [lodge, flat],
      firstNight: night(20),
      lastNight: night(21),
      priceMinor: 9_000,
    });
    expect(low).toMatchObject({
      status: 400,
      body: {
        error: {
          code: 'below_lowest_price',
          message: '£90.00 is below the lowest price for Harbour View Lodge, £95.00.',
        },
      },
    });
    const high = await change({
      propertyIds: [lodge],
      firstNight: night(20),
      lastNight: night(20),
      priceMinor: 45_000,
    });
    expect(high.body.error.code).toBe('above_highest_price');
    // Nothing was saved for either property.
    const calendar = (await read(night(20), night(21))).body;
    expect(calendar.nights).toEqual([]);
  });

  it('sets a minimum stay on chosen days of the week across properties', async () => {
    const weekends = selectedNights(night(0), night(27), [5, 6]);
    const { body } = await change({
      propertyIds: [lodge, flat],
      firstNight: night(0),
      lastNight: night(27),
      daysOfWeek: [5, 6],
      minNights: 3,
    });
    expect(body.changedNights).toBe(weekends.length * 2);
    const calendar = (await read(night(0), night(27))).body;
    const withStay = calendar.nights.filter((n: { minNights: number | null }) => n.minNights === 3);
    expect(withStay).toHaveLength(weekends.length * 2);
    expect(withStay.every((n: { night: string }) => [5, 6].includes(isoWeekday(n.night)))).toBe(true);
  });

  it('closes dates to arrivals and departures', async () => {
    const { body } = await change({
      propertyIds: [flat],
      firstNight: night(30),
      lastNight: night(30),
      closedToArrival: true,
      closedToDeparture: true,
    });
    expect(body.changedNights).toBe(1);
    const calendar = (await read(night(30), night(30))).body;
    expect(calendar.nights).toEqual([
      {
        propertyId: flat,
        night: night(30),
        priceMinor: null,
        minNights: weekendStay(night(30)),
        closedToArrival: true,
        closedToDeparture: true,
      },
    ]);
  });

  it('goes back to the usual price, and keeps no row once a night has nothing of its own', async () => {
    const { body } = await change({
      propertyIds: [lodge],
      firstNight: night(10),
      lastNight: night(12),
      priceMinor: null,
    });
    expect(body.changedNights).toBe(3);
    const calendar = (await read(night(10), night(12))).body;
    const lodgeNights = calendar.nights.filter((n: { propertyId: string }) => n.propertyId === lodge);
    // Only nights with a weekend minimum stay keep a row.
    expect(lodgeNights.every((n: { priceMinor: number | null }) => n.priceMinor === null)).toBe(true);
    expect(lodgeNights).toHaveLength([10, 11, 12].filter((n) => weekendStay(night(n)) !== null).length);
  });

  it('refuses nights that have passed, and nights more than two years ahead', async () => {
    const past = await change({
      propertyIds: [lodge],
      firstNight: night(-1),
      lastNight: night(2),
      minNights: 4,
    });
    expect(past).toMatchObject({ status: 400, body: { error: { code: 'nights_passed' } } });
    const far = await change({
      propertyIds: [lodge],
      firstNight: night(700),
      lastNight: night(740),
      minNights: 4,
    });
    expect(far.body.error.code).toBe('too_far_ahead');
  });

  it('keeps prices that PriceLabs sets out of reach, but lets the stay rules change', async () => {
    await call('PATCH', `/v1/properties/${flat}`, { as: asA(), body: { priceOwner: 'pricelabs' } });
    const price = await change({
      propertyIds: [flat],
      firstNight: night(40),
      lastNight: night(41),
      priceMinor: 12_000,
    });
    expect(price).toMatchObject({
      status: 409,
      body: {
        error: { message: "PriceLabs sets the prices for Mill Street Flat, so they can't be changed here." },
      },
    });
    const stay = await change({
      propertyIds: [flat],
      firstNight: night(40),
      lastNight: night(41),
      minNights: 2,
    });
    expect(stay.status).toBe(200);
    await call('PATCH', `/v1/properties/${flat}`, { as: asA(), body: { priceOwner: 'v01' } });
  });
});

describe('blocking nights', () => {
  it('blocks the free nights and leaves booked ones as they are', async () => {
    const [guest] = await owner<{ id: string }>(
      `insert into app.guests (organisation_id, full_name) values ($1, 'Ada Lovelace') returning id`,
      [a.orgId],
    );
    await owner(
      `insert into app.reservations (organisation_id, property_id, channel, channel_reference, status, check_in, check_out, adults, children, guest_id)
       values ($1, $2, 'airbnb', 'HMABC123', 'confirmed', $3, $4, 2, 1, $5)`,
      [a.orgId, lodge, night(52), night(54), guest!.id],
    );
    const { body } = await change({
      propertyIds: [lodge],
      firstNight: night(50),
      lastNight: night(54),
      blocked: true,
      blockReason: 'Owner staying',
    });
    expect(body).toMatchObject({ blockedNights: 3, takenNights: 2 });

    const calendar = (await read(night(50), night(56))).body;
    expect(
      calendar.blocks.map((x: { startsOn: string; endsOn: string; reason: string }) => [
        x.startsOn,
        x.endsOn,
        x.reason,
      ]),
    ).toEqual([
      [night(50), night(52), 'Owner staying'],
      [night(54), night(55), 'Owner staying'],
    ]);
    expect(calendar.stays).toEqual([
      {
        id: expect.any(String),
        propertyId: lodge,
        checkIn: night(52),
        checkOut: night(54),
        status: 'confirmed',
        channel: 'airbnb',
        channelReference: 'HMABC123',
        guestName: 'Ada Lovelace',
        guests: 3,
      },
    ]);
  });

  it('reopens some nights of a block and keeps the rest blocked', async () => {
    const { body } = await change({
      propertyIds: [lodge],
      firstNight: night(51),
      lastNight: night(54),
      blocked: false,
    });
    expect(body.reopenedNights).toBe(2);
    const calendar = (await read(night(50), night(56))).body;
    expect(
      calendar.blocks.map((x: { startsOn: string; endsOn: string; reason: string }) => [
        x.startsOn,
        x.endsOn,
        x.reason,
      ]),
    ).toEqual([[night(50), night(51), 'Owner staying']]);
  });

  it('blocks only the chosen days of the week', async () => {
    const mondays = selectedNights(night(60), night(80), [1]);
    const { body } = await change({
      propertyIds: [flat],
      firstNight: night(60),
      lastNight: night(80),
      daysOfWeek: [1],
      blocked: true,
    });
    expect(body.blockedNights).toBe(mondays.length);
    const calendar = (await read(night(60), night(80))).body;
    expect(calendar.blocks.map((x: { startsOn: string }) => x.startsOn)).toEqual(mondays);
  });
});

describe('who may change the calendar', () => {
  it('lets guest comms read it but not change it', async () => {
    expect((await read(night(0), night(6), asReader())).status).toBe(200);
    const refused = await change(
      { propertyIds: [lodge], firstNight: night(1), lastNight: night(1), minNights: 5 },
      asReader(),
    );
    expect(refused.status).toBe(403);
  });

  it("never lets one operator change another's nights", async () => {
    // A night no other test touches, so any row there would be operator B's doing.
    const refused = await change(
      { propertyIds: [lodge], firstNight: night(95), lastNight: night(95), priceMinor: 20_000 },
      asB(),
    );
    expect(refused).toMatchObject({ status: 404, body: { error: { code: 'property_not_found' } } });
    const rows = await owner(`select 1 from app.calendar_days where property_id = $1 and night = $2`, [
      lodge,
      night(95),
    ]);
    expect(rows).toEqual([]);
  });

  it('needs something to change', async () => {
    const nothing = await change({ propertyIds: [lodge], firstNight: night(1), lastNight: night(2) });
    expect(nothing.status).toBe(400);
  });
});

describe('finding a property', () => {
  const window = `from=${night(50)}&to=${night(56)}`;
  const names = (body: Record<string, unknown>) => (body.properties as { name: string }[]).map((p) => p.name);

  it('gives the calendar what its filters need, tags included', async () => {
    const tagged = await call('PATCH', `/v1/properties/${lodge}`, {
      as: asA(),
      body: { tags: [' Sea view ', 'sea view', 'Owner: Jones'], area: 'Harbourside' },
    });
    expect(tagged.body.tags).toEqual(['Sea view', 'Owner: Jones']);
    const { body } = await read(night(50), night(56));
    expect(body.propertyCount).toBe(2);
    expect(body.properties[0]).toMatchObject({
      name: 'Harbour View Lodge',
      area: 'Harbourside',
      city: null,
      bedrooms: null,
      maxGuests: 6,
      tags: ['Sea view', 'Owner: Jones'],
    });
    const tooMany = await call('PATCH', `/v1/properties/${lodge}`, {
      as: asA(),
      body: { tags: Array.from({ length: 31 }, (_, i) => `Tag ${i}`) },
    });
    expect(tooMany.status).toBe(400);
  });

  it('lists only properties free for the whole stay, with room for everyone', async () => {
    const free = (query: string) => call('GET', `/v1/calendar?${window}&${query}`, { as: asA() });
    expect(names((await free(`freeFrom=${night(100)}&freeTo=${night(103)}`)).body)).toEqual([
      'Harbour View Lodge',
      'Mill Street Flat',
    ]);
    // The lodge is booked on the 52nd and 53rd nights from today; leaving on the 52nd day is fine.
    const onlyFlat = (await free(`freeFrom=${night(53)}&freeTo=${night(56)}`)).body;
    expect(names(onlyFlat)).toEqual(['Mill Street Flat']);
    // The count is of every property, so the screen can say "1 of 2".
    expect(onlyFlat.propertyCount).toBe(2);
    expect(names((await free(`freeFrom=${night(49)}&freeTo=${night(50)}`)).body)).toEqual([
      'Harbour View Lodge',
      'Mill Street Flat',
    ]);
    // The flat sleeps two.
    expect(names((await free(`freeFrom=${night(100)}&freeTo=${night(103)}&guests=3`)).body)).toEqual([
      'Harbour View Lodge',
    ]);
    expect((await free(`freeFrom=${night(100)}`)).status).toBe(400);
    expect((await free(`freeFrom=${night(103)}&freeTo=${night(100)}`)).status).toBe(400);
  });
});

/** The weekend minimum stay set above lands on Friday and Saturday nights in the first four weeks. */
function weekendStay(date: string): number | null {
  return date <= night(27) && [5, 6].includes(isoWeekday(date)) ? 3 : null;
}
