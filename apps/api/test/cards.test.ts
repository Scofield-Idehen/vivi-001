import { ApiDatabase } from '@v01/db';
import { createTestDatabase, seedOperator, type TestDatabase } from '@v01/db/testing';
import { MemoryCardGateway, signStripeBody } from '@v01/integrations';
import { addDays, todayIn } from '@v01/shared';
import type { FastifyInstance } from 'fastify';
import { SignJWT } from 'jose';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { createTokenVerifier } from '../src/auth.ts';
import { loadEnv } from '../src/env.ts';

/** Card payments and deposits through Stripe, with the stand-in gateway. */

/** Made up, and built in pieces so it never looks like a real key in the repository. */
const fakeKey = (mode: 'live' | 'test') => ['sk', mode, 'x'.repeat(24)].join('_');
const JWT_SECRET = 'test-only-jwt-secret-with-enough-length';
const WEBHOOK_SECRET = 'whsec_test_only_secret_value';

let t: TestDatabase;
let db: ApiDatabase;
let app: FastifyInstance;
let offApp: FastifyInstance;
const gateway = new MemoryCardGateway();
let a: { orgId: string; userId: string };
let b: { orgId: string; userId: string };
let comms: { orgId: string; userId: string };
let stay: string;
const today = todayIn('Europe/London');

type Who = { userId: string; email: string; orgId: string };
const asA = (): Who => ({ ...a, email: 'admin-a@example.test' });
const asB = (): Who => ({ ...b, email: 'admin-b@example.test' });
const asComms = (): Who => ({ ...comms, email: 'comms@example.test' });

async function call(
  method: 'GET' | 'POST',
  url: string,
  options: { as: Who; body?: unknown; on?: FastifyInstance },
  // biome-ignore lint/suspicious/noExplicitAny: tests read response bodies loosely
): Promise<{ status: number; body: Record<string, any> }> {
  const jwt = await new SignJWT({ email: options.as.email, role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(options.as.userId)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const response = await (options.on ?? app).inject({
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

const sessionOf = async (id: string) =>
  (await owner<{ session_id: string }>('select session_id from app.card_requests where id = $1', [id]))[0]!
    .session_id;

beforeAll(async () => {
  t = await createTestDatabase();
  a = await seedOperator(t.ownerUrl, { name: 'A', slug: 'a', userEmail: 'admin-a@example.test' });
  b = await seedOperator(t.ownerUrl, { name: 'B', slug: 'b', userEmail: 'admin-b@example.test' });
  const [u] = await owner<{ id: string }>(
    `insert into app.app_users (id, email) values (gen_random_uuid(), 'comms@example.test') returning id`,
  );
  await owner(`insert into app.memberships (organisation_id, user_id, role) values ($1, $2, 'guest_comms')`, [
    a.orgId,
    u!.id,
  ]);
  comms = { orgId: a.orgId, userId: u!.id };
  db = new ApiDatabase(t.apiUrl);
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: t.apiUrl,
    SUPABASE_JWT_SECRET: JWT_SECRET,
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
  });
  const verifyToken = createTokenVerifier({ jwtSecret: JWT_SECRET });
  app = await buildApp({ env, db, verifyToken, cards: gateway });
  offApp = await buildApp({ env, db, verifyToken, cards: null });
  const home = (
    await call('POST', '/v1/properties', {
      as: asA(),
      body: { name: 'Harbour View Lodge', countryCode: 'GB', maxGuests: 6 },
    })
  ).body.id;
  const [g] = await owner<{ id: string }>(
    `insert into app.guests (organisation_id, full_name, email) values ($1, 'Ada Guest', 'ada@example.test') returning id`,
    [a.orgId],
  );
  const [r] = await owner<{ id: string }>(
    `insert into app.reservations (organisation_id, property_id, channel, status, check_in, check_out,
       adults, children, guest_id, currency, total_minor)
     values ($1, $2, 'direct', 'confirmed', $3, $4, 2, 0, $5, 'GBP', 45000) returning id`,
    [a.orgId, home, addDays(today, 3), addDays(today, 6), g!.id],
  );
  stay = r!.id;
});

afterAll(async () => {
  await app?.close();
  await offApp?.close();
  await db?.close();
  await t?.drop();
});

describe('card payments', () => {
  it('says payments are off until Stripe is set up', async () => {
    const list = await call('GET', `/v1/reservations/${stay}/card-requests`, { as: asA(), on: offApp });
    expect(list.status).toBe(200);
    expect(list.body).toMatchObject({ enabled: false, requests: [] });
    const make = await call('POST', `/v1/reservations/${stay}/card-requests`, {
      as: asA(),
      on: offApp,
      body: { kind: 'payment', amountMinor: 45000 },
    });
    expect(make.status).toBe(503);
  });

  it('makes a link; once paid, the payment lands on the booking once', async () => {
    const made = await call('POST', `/v1/reservations/${stay}/card-requests`, {
      as: asA(),
      body: { kind: 'payment', amountMinor: 45000 },
    });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ enabled: true, testMode: true });
    const req = made.body.requests[0];
    expect(req).toMatchObject({ kind: 'payment', status: 'open', amountMinor: 45000, currency: 'GBP' });
    expect(req.url).toContain('checkout.stripe.test');
    const session = gateway.sessions.get(await sessionOf(req.id))!;
    expect(session.input.customerEmail).toBe('ada@example.test');
    expect(session.input.metadata).toEqual({ v01_org: a.orgId, v01_request: req.id });

    gateway.complete(await sessionOf(req.id));
    const first = await call('GET', `/v1/reservations/${stay}/card-requests`, { as: asA() });
    expect(first.body.requests[0]).toMatchObject({ status: 'paid', url: null });
    await call('GET', `/v1/reservations/${stay}/card-requests`, { as: asA() });
    const booking = await call('GET', `/v1/reservations/${stay}`, { as: asA() });
    expect(booking.body.payments).toHaveLength(1);
    expect(booking.body.payments[0]).toMatchObject({ amountMinor: 45000, method: 'card' });
    expect(booking.body.payments[0].note).toBe('Stripe, test');
    expect(booking.body.balanceMinor).toBe(0);
  });

  it('settles from a signed webhook, and refuses an unsigned one', async () => {
    const made = await call('POST', `/v1/reservations/${stay}/card-requests`, {
      as: asA(),
      body: { kind: 'payment', amountMinor: 1500 },
    });
    const id = made.body.requests[0].id;
    gateway.complete(await sessionOf(id));
    const body = JSON.stringify({
      type: 'checkout.session.completed',
      data: { object: { object: 'checkout.session', metadata: { v01_org: a.orgId, v01_request: id } } },
    });
    const bad = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=00' },
      payload: body,
    });
    expect(bad.statusCode).toBe(401);
    const good = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': signStripeBody(body, WEBHOOK_SECRET),
      },
      payload: body,
    });
    expect(good.statusCode).toBe(200);
    const [row] = await owner<{ status: string; payment_id: string | null }>(
      'select status, payment_id from app.card_requests where id = $1',
      [id],
    );
    expect(row).toMatchObject({ status: 'paid' });
    expect(row!.payment_id).not.toBeNull();
  });

  it('holds a deposit, keeps part of it as a charge and payment, and the balance stays put', async () => {
    const before = (await call('GET', `/v1/reservations/${stay}`, { as: asA() })).body.balanceMinor;
    const made = await call('POST', `/v1/reservations/${stay}/card-requests`, {
      as: asA(),
      body: { kind: 'deposit', amountMinor: 20000 },
    });
    const id = made.body.requests[0].id;
    expect(gateway.sessions.get(await sessionOf(id))!.input.kind).toBe('deposit');
    const early = await call('POST', `/v1/card-requests/${id}/keep`, {
      as: asA(),
      body: { amountMinor: 5000, reason: 'Broken lamp' },
    });
    expect(early.status).toBe(409);
    gateway.complete(await sessionOf(id));
    const held = await call('GET', `/v1/reservations/${stay}/card-requests`, { as: asA() });
    expect(held.body.requests.find((r: { id: string }) => r.id === id).status).toBe('held');
    const tooMuch = await call('POST', `/v1/card-requests/${id}/keep`, {
      as: asA(),
      body: { amountMinor: 25000, reason: 'Broken lamp' },
    });
    expect(tooMuch.status).toBe(400);
    const kept = await call('POST', `/v1/card-requests/${id}/keep`, {
      as: asA(),
      body: { amountMinor: 5000, reason: 'Broken lamp' },
    });
    expect(kept.status).toBe(200);
    expect(kept.body.requests.find((r: { id: string }) => r.id === id)).toMatchObject({
      status: 'kept',
      keptMinor: 5000,
      keptReason: 'Broken lamp',
    });
    const booking = (await call('GET', `/v1/reservations/${stay}`, { as: asA() })).body;
    expect(booking.charges.map((c: { label: string }) => c.label)).toContain('Broken lamp');
    expect(booking.balanceMinor).toBe(before);
  });

  it('releases a held deposit and cancels an open link', async () => {
    const dep = (
      await call('POST', `/v1/reservations/${stay}/card-requests`, {
        as: asA(),
        body: { kind: 'deposit', amountMinor: 10000 },
      })
    ).body.requests[0].id;
    gateway.complete(await sessionOf(dep));
    await call('GET', `/v1/reservations/${stay}/card-requests`, { as: asA() });
    const released = await call('POST', `/v1/card-requests/${dep}/release`, { as: asA() });
    expect(released.body.requests.find((r: { id: string }) => r.id === dep).status).toBe('released');

    const link = (
      await call('POST', `/v1/reservations/${stay}/card-requests`, {
        as: asA(),
        body: { kind: 'payment', amountMinor: 999 },
      })
    ).body.requests[0].id;
    const cancelled = await call('POST', `/v1/card-requests/${link}/cancel`, { as: asA() });
    expect(cancelled.body.requests.find((r: { id: string }) => r.id === link)).toMatchObject({
      status: 'expired',
      url: null,
    });
  });

  it('keeps guest comms and other operators out of the money', async () => {
    const comm = await call('POST', `/v1/reservations/${stay}/card-requests`, {
      as: asComms(),
      body: { kind: 'payment', amountMinor: 100 },
    });
    expect(comm.status).toBe(403);
    const seen = await call('GET', `/v1/reservations/${stay}/card-requests`, { as: asComms() });
    expect(seen.status).toBe(200);
    const other = await call('GET', `/v1/reservations/${stay}/card-requests`, { as: asB() });
    expect(other.status).toBe(404);
    const [{ n }] = (await owner<{ n: string }>('select count(*) as n from app.card_requests')) as [
      { n: string },
    ];
    expect(Number(n)).toBeGreaterThan(0);
  });

  it('refuses a live Stripe key unless told to take real money', () => {
    const base = { NODE_ENV: 'test', DATABASE_URL: 'x', SUPABASE_JWT_SECRET: JWT_SECRET };
    expect(() => loadEnv({ ...base, STRIPE_SECRET_KEY: fakeKey('live') })).toThrow(/live key/);
    expect(loadEnv({ ...base, STRIPE_SECRET_KEY: fakeKey('live'), STRIPE_LIVE: 'true' }).STRIPE_LIVE).toBe(
      true,
    );
    expect(loadEnv({ ...base, STRIPE_SECRET_KEY: fakeKey('test') }).STRIPE_LIVE).toBe(false);
  });
});
