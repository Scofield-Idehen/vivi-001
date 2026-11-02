import { ApiDatabase } from '@v01/db';
import { createTestDatabase, seedOperator, type TestDatabase } from '@v01/db/testing';
import { MemoryCardGateway } from '@v01/integrations';
import { addDays, todayIn } from '@v01/shared';
import type { FastifyInstance } from 'fastify';
import { SignJWT } from 'jose';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { createTokenVerifier } from '../src/auth.ts';
import { loadEnv } from '../src/env.ts';

/** The booking website: public homes, prices, and a booking saved only once the card is authorised. */

const JWT_SECRET = 'test-only-jwt-secret-with-enough-length';
let t: TestDatabase;
let db: ApiDatabase;
let app: FastifyInstance;
const gateway = new MemoryCardGateway();
let a: { orgId: string; userId: string };
let home: string;
let guestyHome: string;
const today = todayIn('Europe/London');
// A fortnight ahead, on a Monday, so weekend prices don't move the totals.
const monday = (() => {
  let d = addDays(today, 14);
  while (new Date(`${d}T12:00:00Z`).getUTCDay() !== 1) d = addDays(d, 1);
  return d;
})();

async function call(
  method: 'GET' | 'POST' | 'PATCH',
  url: string,
  options: { body?: unknown; signedIn?: boolean } = {},
  // biome-ignore lint/suspicious/noExplicitAny: tests read response bodies loosely
): Promise<{ status: number; body: Record<string, any> }> {
  const headers: Record<string, string> = {};
  if (options.signedIn) {
    const jwt = await new SignJWT({ email: 'admin-a@example.test', role: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(a.userId)
      .setAudience('authenticated')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(JWT_SECRET));
    headers.authorization = `Bearer ${jwt}`;
    headers['x-org-id'] = a.orgId;
  }
  const response = await app.inject({ method, url, headers, payload: options.body as never });
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

const guest = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'Ada@Example.test',
  phone: '+44 7700 900123',
  request: 'Arriving late',
  acceptTerms: true,
};

beforeAll(async () => {
  t = await createTestDatabase();
  a = await seedOperator(t.ownerUrl, { name: 'A', slug: 'a', userEmail: 'admin-a@example.test' });
  db = new ApiDatabase(t.apiUrl);
  const env = loadEnv({ NODE_ENV: 'test', DATABASE_URL: t.apiUrl, SUPABASE_JWT_SECRET: JWT_SECRET });
  app = await buildApp({
    env,
    db,
    verifyToken: createTokenVerifier({ jwtSecret: JWT_SECRET }),
    cards: gateway,
  });
  home = (
    await call('POST', '/v1/properties', {
      signedIn: true,
      body: { name: 'Harbour View Lodge', countryCode: 'GB', maxGuests: 4 },
    })
  ).body.id;
  const patched = await call('PATCH', `/v1/properties/${home}`, {
    signedIn: true,
    body: {
      basePriceMinor: 10000,
      cleaningFeeMinor: 5000,
      minNights: 2,
      city: 'Edinburgh',
      onBookingSite: true,
    },
  });
  expect(patched.status).toBe(200);
  expect(patched.body.onBookingSite).toBe(true);
  guestyHome = (
    await call('POST', '/v1/properties', {
      signedIn: true,
      body: { name: 'Guesty Cottage', countryCode: 'GB', maxGuests: 4 },
    })
  ).body.id;
  await owner(`update app.properties set managed_by = 'guesty' where id = $1`, [guestyHome]);
});

afterAll(async () => {
  await app?.close();
  await db?.close();
  await t?.drop();
});

describe('booking website', () => {
  it('is not there until the team switches it on', async () => {
    expect((await call('GET', '/v1/site/a')).status).toBe(404);
    const on = await call('PATCH', '/v1/workspace/booking-site', {
      signedIn: true,
      body: { on: true, serviceFeeBp: 150, terms: 'Pay in full when you book.' },
    });
    expect(on.status).toBe(200);
    expect(on.body).toMatchObject({ on: true, slug: 'a', homesOn: 1, canPay: true });
    expect((await call('GET', '/v1/site/nope')).status).toBe(404);
  });

  it('keeps a home Guesty still runs off the site', async () => {
    const r = await call('PATCH', `/v1/properties/${guestyHome}`, {
      signedIn: true,
      body: { onBookingSite: true },
    });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toContain('Guesty');
  });

  it('lists the homes on it, with the price for dates', async () => {
    const site = await call('GET', '/v1/site/a');
    expect(site.status).toBe(200);
    expect(site.body.homes).toHaveLength(1);
    expect(site.body.homes[0]).toMatchObject({
      name: 'Harbour View Lodge',
      place: 'Edinburgh',
      fromMinor: 10000,
    });
    expect(JSON.stringify(site.body)).not.toContain('addressLine');
    const dated = await call('GET', `/v1/site/a?checkIn=${monday}&checkOut=${addDays(monday, 2)}&adults=2`);
    // 2 nights 20,000 + cleaning 5,000 + 1.5% service fee 375
    expect(dated.body.homes[0].stay).toEqual({ totalMinor: 25375, message: null });
    const page = await call('GET', `/v1/site/a/homes/${home}`);
    expect(page.body).toMatchObject({ minNights: 2, terms: 'Pay in full when you book.', testMode: true });
    expect((await call('GET', `/v1/site/a/homes/${guestyHome}`)).status).toBe(404);
    const nights = await call(
      'GET',
      `/v1/site/a/homes/${home}/nights?from=${monday}&to=${addDays(monday, 3)}`,
    );
    expect(nights.body.nights[0]).toMatchObject({ night: monday, free: true, priceMinor: 10000 });
  });

  it('books: the card is authorised, the booking saved, then the money taken', async () => {
    const stay = { homeId: home, checkIn: monday, checkOut: addDays(monday, 2), adults: 2 };
    const quote = await call('POST', '/v1/site/a/quote', { body: stay });
    expect(quote.body).toMatchObject({ ok: true, totalMinor: 25375 });
    const short = await call('POST', '/v1/site/a/quote', { body: { ...stay, checkOut: addDays(monday, 1) } });
    expect(short.body).toMatchObject({ ok: false, reason: 'min_nights' });
    expect(
      (await call('POST', '/v1/site/a/book', { body: { ...stay, ...guest, acceptTerms: false } })).status,
    ).toBe(400);

    const book = await call('POST', '/v1/site/a/book', { body: { ...stay, ...guest } });
    expect(book.status).toBe(201);
    const [row] = await owner<{ session_id: string }>(
      'select session_id from app.site_bookings where id = $1',
      [book.body.bookingId],
    );
    const session = gateway.sessions.get(row!.session_id)!;
    expect(session.input).toMatchObject({ kind: 'booking', amountMinor: 25375, expiresInMinutes: 30 });
    expect(session.input.successUrl).toContain(`/book/a/done/${book.body.bookingId}`);
    const waiting = await call('GET', `/v1/site/a/bookings/${book.body.bookingId}`);
    expect(waiting.body).toMatchObject({ status: 'open', stayPath: null });
    expect(waiting.body.url).toBeTruthy();

    gateway.complete(row!.session_id);
    const done = await call('GET', `/v1/site/a/bookings/${book.body.bookingId}`);
    expect(done.body).toMatchObject({ status: 'booked', totalMinor: 25375, email: 'ada@example.test' });
    expect(done.body.stayPath).toMatch(/^\/stay\/[0-9a-f]{32}$/);
    expect(gateway.sessions.get(row!.session_id)!.state.intent).toBe('succeeded');
    const [r] = await owner<{
      channel: string;
      status: string;
      total_minor: string;
      notes: string;
      paid: string;
    }>(
      `select r.channel, r.status, r.total_minor, r.notes,
              (select sum(amount_minor) from app.reservation_payments p where p.reservation_id = r.id) as paid
         from app.site_bookings s join app.reservations r on r.id = s.reservation_id where s.id = $1`,
      [book.body.bookingId],
    );
    expect(r).toMatchObject({ channel: 'direct', status: 'confirmed', total_minor: '25375', paid: '25375' });
    expect(r!.notes).toContain('Arriving late');
    // The nights are now taken on the site too.
    const again = await call('POST', '/v1/site/a/quote', { body: stay });
    expect(again.body).toMatchObject({ ok: false, reason: 'taken' });
  });

  it('lets the card go when the nights were taken while the guest paid', async () => {
    const checkIn = addDays(monday, 7);
    const stay = { homeId: home, checkIn, checkOut: addDays(checkIn, 3), adults: 1 };
    const book = await call('POST', '/v1/site/a/book', { body: { ...stay, ...guest } });
    expect(book.status).toBe(201);
    // Meanwhile a channel booking takes the same nights.
    await owner(
      `insert into app.reservations (organisation_id, property_id, channel, status, check_in, check_out)
       values ($1, $2, 'airbnb', 'confirmed', $3, $4)`,
      [a.orgId, home, addDays(checkIn, 1), addDays(checkIn, 2)],
    );
    const [row] = await owner<{ session_id: string }>(
      'select session_id from app.site_bookings where id = $1',
      [book.body.bookingId],
    );
    gateway.complete(row!.session_id);
    const done = await call('GET', `/v1/site/a/bookings/${book.body.bookingId}`);
    expect(done.body).toMatchObject({ status: 'refused', stayPath: null });
    expect(gateway.sessions.get(row!.session_id)!.state.intent).toBe('canceled');
    const [n] = await owner<{ n: number }>(
      `select count(*)::int as n from app.reservations where property_id = $1 and channel = 'direct'`,
      [home],
    );
    expect(n!.n).toBe(1);
  });
});
