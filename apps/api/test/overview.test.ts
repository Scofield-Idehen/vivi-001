import { ApiDatabase } from '@v01/db';
import { createTestDatabase, seedOperator, type TestDatabase } from '@v01/db/testing';
import type { FastifyInstance } from 'fastify';
import { SignJWT } from 'jose';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { createTokenVerifier } from '../src/auth.ts';
import { loadEnv } from '../src/env.ts';

/** Today's overview: the day's moves, money by month against the month before, and the trend. */

const JWT_SECRET = 'test-only-jwt-secret-with-enough-length';
const NOW = new Date('2026-10-29T09:00:00Z'); // Thursday 29 October, London

let t: TestDatabase;
let db: ApiDatabase;
let app: FastifyInstance;
let a: { orgId: string; userId: string };
let field: { orgId: string; userId: string };
const homes: string[] = [];

type Who = { userId: string; email: string; orgId: string };
const asA = (): Who => ({ ...a, email: 'admin-a@example.test' });

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
  home: number,
  checkIn: string,
  checkOut: string,
  totalMinor: number,
  times?: [string, string],
) {
  await owner(
    `insert into app.reservations (organisation_id, property_id, channel, status, check_in, check_out, adults, currency, total_minor, check_in_time, check_out_time)
     values ($1, $2, 'airbnb', 'confirmed', $3, $4, 2, 'GBP', $5, $6, $7)`,
    [a.orgId, homes[home], checkIn, checkOut, totalMinor, times?.[0] ?? null, times?.[1] ?? null],
  );
}

beforeAll(async () => {
  t = await createTestDatabase();
  a = await seedOperator(t.ownerUrl, {
    name: 'Operator A',
    slug: 'operator-a',
    userEmail: 'admin-a@example.test',
  });
  const [u] = await owner<{ id: string }>(
    `insert into app.app_users (id, email) values (gen_random_uuid(), 'f@example.test') returning id`,
  );
  await owner(`insert into app.memberships (organisation_id, user_id, role) values ($1, $2, 'field')`, [
    a.orgId,
    u!.id,
  ]);
  field = { orgId: a.orgId, userId: u!.id };
  for (const name of ['Lodge', 'Flat', 'Cottage', 'Barn']) {
    const [p] = await owner<{ id: string }>(
      `insert into app.properties (organisation_id, name, country_code, max_guests, check_in_time, check_out_time)
       values ($1, $2, 'GB', 4, '15:00', '10:00') returning id`,
      [a.orgId, name],
    );
    homes.push(p!.id);
  }
  // Lodge: one leaves today at 10:00, the next arrives at 16:00 (a 6-hour turnover).
  await stay(0, '2026-10-26', '2026-10-29', 30000);
  await stay(0, '2026-10-29', '2026-10-31', 24000, ['16:00', '10:00']);
  // Flat: arrives today, but the flat is still dirty.
  await stay(1, '2026-10-29', '2026-11-02', 40000);
  await owner(`update app.properties set cleaning_status = 'dirty' where id = $1`, [homes[1]]);
  // Cottage: staying through, and arrives tomorrow at the barn.
  await stay(2, '2026-10-27', '2026-11-01', 50000);
  await stay(3, '2026-10-30', '2026-11-03', 36000);
  // September money for the comparison: 3 nights at £100.
  await stay(3, '2026-09-10', '2026-09-13', 30000);
  db = new ApiDatabase(t.apiUrl);
  app = await buildApp({
    env: loadEnv({ NODE_ENV: 'test', DATABASE_URL: t.apiUrl, SUPABASE_JWT_SECRET: JWT_SECRET }),
    db,
    verifyToken: createTokenVerifier({ jwtSecret: JWT_SECRET }),
    now: () => NOW,
  });
});

afterAll(async () => {
  await app?.close();
  await db?.close();
  await t?.drop();
});

describe('overview', () => {
  it('counts today: check-ins and how many homes are ready, check-outs, the tightest turnover, who is staying', async () => {
    const r = await call('/v1/overview?range=today', asA());
    expect(r.body).toMatchObject({
      from: '2026-10-29',
      // 09:00 London: nobody is past check-in (15:00, 16:00) and the 10:00 check-out hasn't come.
      checkIns: { total: 2, done: 0, ready: 1 },
      checkOuts: { total: 1, done: 0, cleaned: 0 },
      turnovers: { total: 1, shortestHours: 6 },
      staying: 1,
      needCleaning: 1,
    });
  });

  it('counts a guest as in once their check-in time has passed', async () => {
    const later = await buildApp({
      env: loadEnv({ NODE_ENV: 'test', DATABASE_URL: t.apiUrl, SUPABASE_JWT_SECRET: JWT_SECRET }),
      db,
      verifyToken: createTokenVerifier({ jwtSecret: JWT_SECRET }),
      now: () => new Date('2026-10-29T15:30:00Z'),
    });
    const jwt = await new SignJWT({ email: 'admin-a@example.test', role: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(a.userId)
      .setAudience('authenticated')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(JWT_SECRET));
    const r = await later.inject({
      method: 'GET',
      url: '/v1/overview',
      headers: { authorization: `Bearer ${jwt}`, 'x-org-id': a.orgId },
    });
    // 15:30: the Flat (15:00) is in, the Lodge (16:00) not yet; the 10:00 check-out is done.
    expect(r.json()).toMatchObject({ checkIns: { total: 2, done: 1 }, checkOuts: { total: 1, done: 1 } });
    await later.close();
  });

  it('counts tomorrow and the week without the readiness rings', async () => {
    const tomorrow = await call('/v1/overview?range=tomorrow', asA());
    expect(tomorrow.body).toMatchObject({ from: '2026-10-30', checkIns: { total: 1, ready: null } });
    const week = await call('/v1/overview?range=week', asA());
    expect(week.body).toMatchObject({
      from: '2026-10-29',
      to: '2026-11-04',
      checkIns: { total: 3 },
      checkOuts: { total: 5 },
    });
  });

  it('spreads each booking over its nights for revenue, against the month before', async () => {
    const r = await call('/v1/overview/revenue?month=2026-10', asA());
    // October nights: Lodge 26–28 (3 × 100) + 29–30 (2 × 120); Flat 29–31 (3 × 100); Cottage 27–31 (5 × 100); Barn 30–31 (2 × 90).
    expect(r.body.total.currentMinor).toBe(30000 + 24000 + 30000 + 50000 + 18000);
    expect(r.body.total.previousMinor).toBe(30000);
    expect(r.body.adr.previousMinor).toBe(10000);
    expect(r.body.total.weeks.map((w: { label: string }) => w.label)).toEqual([
      'Oct 1–7',
      'Oct 8–14',
      'Oct 15–21',
      'Oct 22–28',
      'Oct 29–31',
    ]);
    expect(r.body.adr.days).toHaveLength(31);
  });

  it('keeps money from the field team', async () => {
    expect((await call('/v1/overview/revenue', { ...field, email: 'f@example.test' })).status).toBe(403);
  });

  it('gives the next seven days of moves and occupancy', async () => {
    const r = await call('/v1/overview/trends?days=7', asA());
    expect(r.body.days).toHaveLength(7);
    expect(r.body.days[0]).toMatchObject({
      date: '2026-10-29',
      checkIns: 2,
      checkOuts: 1,
      turnovers: 1,
      occupancy: 75,
    });
    expect(r.body.totals).toMatchObject({ checkIns: 3, checkOuts: 5, turnovers: 1 });
  });
});
