import { ApiDatabase } from '@v01/db';
import { createTestDatabase, seedOperator, type TestDatabase } from '@v01/db/testing';
import type { FastifyInstance } from 'fastify';
import { SignJWT } from 'jose';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { createTokenVerifier } from '../src/auth.ts';
import { loadEnv } from '../src/env.ts';

/** Insights for October 2026 on two homes, worked out by hand. */

const JWT_SECRET = 'test-only-jwt-secret-with-enough-length';

let t: TestDatabase;
let db: ApiDatabase;
let app: FastifyInstance;
let a: { orgId: string; userId: string };
let b: { orgId: string; userId: string };
let gc: Who;
let lodge: string;
let flat: string;

type Who = { userId: string; email: string; orgId: string };
const asA = (): Who => ({ ...a, email: 'admin-a@example.test' });
const asB = (): Who => ({ ...b, email: 'admin-b@example.test' });

async function call(url: string, as: Who) {
  const jwt = await new SignJWT({ email: as.email, role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(as.userId)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const r = await app.inject({
    method: 'GET',
    url,
    headers: { authorization: `Bearer ${jwt}`, 'x-org-id': as.orgId },
  });
  // biome-ignore lint/suspicious/noExplicitAny: tests read bodies loosely
  return { status: r.statusCode, body: r.json() as any };
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

async function stay(
  home: string,
  channel: string,
  checkIn: string,
  checkOut: string,
  total: number,
  booked: string,
) {
  const [r] = await owner<{ id: string }>(
    `insert into app.reservations (organisation_id, property_id, channel, status, check_in, check_out, adults, currency, total_minor, created_at)
     values ($1, $2, $3, 'confirmed', $4, $5, 2, 'GBP', $6, $7) returning id`,
    [a.orgId, home, channel, checkIn, checkOut, total, booked],
  );
  return r!.id;
}

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
  const [u] = await owner<{ id: string }>(
    `insert into app.app_users (id, email) values (gen_random_uuid(), 'gc@example.test') returning id`,
  );
  await owner(`insert into app.memberships (organisation_id, user_id, role) values ($1, $2, 'guest_comms')`, [
    a.orgId,
    u!.id,
  ]);
  gc = { orgId: a.orgId, userId: u!.id, email: 'gc@example.test' };
  const [o] = await owner<{ id: string }>(
    `insert into app.owners (organisation_id, name, fee_basis_points) values ($1, 'Ellis', 2000) returning id`,
    [a.orgId],
  );
  for (const [name, area, ownerId] of [
    ['Lodge', 'Harbourside', o!.id],
    ['Flat', 'Old Town', null],
  ] as const) {
    const [p] = await owner<{ id: string }>(
      `insert into app.properties (organisation_id, name, country_code, max_guests, area, owner_id) values ($1, $2, 'GB', 4, $3, $4) returning id`,
      [a.orgId, name, area, ownerId],
    );
    if (name === 'Lodge') lodge = p!.id;
    else flat = p!.id;
  }
  // Lodge: 28 Sep–3 Oct (5 nights, £500: 2 nights £200 in October), 10–15 Oct (5 nights, £600), Airbnb.
  await stay(lodge, 'airbnb', '2026-09-28', '2026-10-03', 50000, '2026-09-01T10:00:00Z');
  const claimed = await stay(lodge, 'airbnb', '2026-10-10', '2026-10-15', 60000, '2026-09-30T10:00:00Z');
  // Flat: 20–24 Oct (4 nights, £400), Booking.com; blocked 1–11 Oct (10 nights).
  await stay(flat, 'booking_com', '2026-10-20', '2026-10-24', 40000, '2026-10-18T10:00:00Z');
  await owner(
    `insert into app.blocks (organisation_id, property_id, starts_on, ends_on) values ($1, $2, '2026-10-01', '2026-10-11')`,
    [a.orgId, flat],
  );
  await owner(
    `insert into app.expenses (organisation_id, property_id, spent_on, category, description, amount_minor, currency) values ($1, $2, '2026-10-16', 'repairs', 'Glass', 9000, 'GBP')`,
    [a.orgId, lodge],
  );
  const [c] = await owner<{ id: string }>(
    `insert into app.claims (organisation_id, reservation_id, place, deadline, received_minor) values ($1, $2, 'airbnb', '2026-10-29', 15000) returning id`,
    [a.orgId, claimed],
  );
  await owner(
    `insert into app.claim_items (organisation_id, claim_id, description, amount_minor) values ($1, $2, 'Table', 20000)`,
    [a.orgId, c!.id],
  );
  db = new ApiDatabase(t.apiUrl);
  app = await buildApp({
    env: loadEnv({ NODE_ENV: 'test', DATABASE_URL: t.apiUrl, SUPABASE_JWT_SECRET: JWT_SECRET }),
    db,
    verifyToken: createTokenVerifier({ jwtSecret: JWT_SECRET }),
  });
});

afterAll(async () => {
  await app?.close();
  await db?.close();
  await t?.drop();
});

describe('insights', () => {
  it('works out the month by home, owner, area and channel', async () => {
    const r = await call('/v1/insights?from=2026-10-01&to=2026-10-31', asA());
    expect(r.status).toBe(200);
    // Available: Lodge 31, Flat 31 − 10 blocked = 21; 52 in all. Booked 2 + 5 + 4 = 11.
    expect(r.body.totals).toMatchObject({
      availableNights: 52,
      bookedNights: 11,
      occupancy: 21.2,
      revenueMinor: 20000 + 60000 + 40000,
      adrMinor: Math.round(120000 / 11),
      bookings: 2,
      averageStay: 4.5,
      expensesMinor: 9000,
      claimedMinor: 20000,
      claimReceivedMinor: 15000,
    });
    const lodgeRow = r.body.homes.find((h: { id: string }) => h.id === lodge);
    expect(lodgeRow).toMatchObject({
      sub: 'Ellis',
      bookedNights: 7,
      revenueMinor: 80000,
      occupancy: 22.6,
      adrMinor: 11429,
    });
    expect(r.body.homes.find((h: { id: string }) => h.id === flat)).toMatchObject({
      availableNights: 21,
      occupancy: 19,
    });
    expect(r.body.owners.map((o: { name: string }) => o.name)).toEqual(['Ellis', 'No owner recorded']);
    expect(r.body.areas.map((o: { name: string }) => o.name)).toEqual(['Harbourside', 'Old Town']);
    expect(r.body.channels).toEqual([
      { channel: 'airbnb', bookings: 1, bookedNights: 7, revenueMinor: 80000, adrMinor: 11429, leadDays: 10 },
      {
        channel: 'booking_com',
        bookings: 1,
        bookedNights: 4,
        revenueMinor: 40000,
        adrMinor: 10000,
        leadDays: 2,
      },
    ]);
  });

  it('gives the twelve months to the end of the period', async () => {
    const r = await call('/v1/insights?from=2026-10-01&to=2026-10-31', asA());
    expect(r.body.months).toHaveLength(12);
    expect(r.body.months[0].month).toBe('2025-11');
    expect(r.body.months[11]).toMatchObject({ month: '2026-10', revenueMinor: 120000, occupancy: 21.2 });
    // September: 3 nights of the first stay (£300) over 60 available nights.
    expect(r.body.months[10]).toMatchObject({ month: '2026-09', revenueMinor: 30000, occupancy: 5 });
  });

  it('refuses a backwards or over-long period, keeps money from guest comms, and stays in the workspace', async () => {
    expect((await call('/v1/insights?from=2026-10-31&to=2026-10-01', asA())).status).toBe(400);
    expect((await call('/v1/insights?from=2025-01-01&to=2026-10-31', asA())).status).toBe(400);
    expect((await call('/v1/insights?from=2026-10-01&to=2026-10-31', gc)).status).toBe(403);
    const other = await call('/v1/insights?from=2026-10-01&to=2026-10-31', asB());
    expect(other.body.totals).toMatchObject({ bookedNights: 0, revenueMinor: 0 });
    expect(other.body.homes).toEqual([]);
  });
});
