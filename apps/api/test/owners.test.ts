import { ApiDatabase } from '@v01/db';
import { createTestDatabase, seedOperator, type TestDatabase } from '@v01/db/testing';
import type { FastifyInstance } from 'fastify';
import { SignJWT } from 'jose';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { createTokenVerifier } from '../src/auth.ts';
import { loadEnv } from '../src/env.ts';
import { MemoryPhotoStore } from '../src/photos.ts';

/** Owners and expenses: who owns which home, money spent on them, and an owner's month. Fixed dates. */

const JWT_SECRET = 'test-only-jwt-secret-with-enough-length';
const NOW = new Date('2026-10-20T10:00:00Z');

let t: TestDatabase;
let db: ApiDatabase;
let app: FastifyInstance;
let a: { orgId: string; userId: string };
let b: { orgId: string; userId: string };
let lodge: string;
let flat: string;
let guestComms: Who;
const files = new MemoryPhotoStore();

type Who = { userId: string; email: string; orgId: string };
const asA = (): Who => ({ ...a, email: 'admin-a@example.test' });
const asB = (): Who => ({ ...b, email: 'admin-b@example.test' });

async function call(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  url: string,
  as: Who,
  body?: unknown,
) {
  const jwt = await new SignJWT({ email: as.email, role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(as.userId)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const r = await app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${jwt}`, 'x-org-id': as.orgId },
    payload: body as never,
  });
  // biome-ignore lint/suspicious/noExplicitAny: tests read bodies loosely
  return { status: r.statusCode, body: r.body ? (r.json() as any) : null };
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
  guestComms = { orgId: a.orgId, userId: u!.id, email: 'gc@example.test' };
  for (const name of ['Lodge', 'Flat']) {
    const [p] = await owner<{ id: string }>(
      `insert into app.properties (organisation_id, name, country_code, max_guests) values ($1, $2, 'GB', 4) returning id`,
      [a.orgId, name],
    );
    if (name === 'Lodge') lodge = p!.id;
    else flat = p!.id;
  }
  // October at the Lodge: 28 Sep–3 Oct (5 nights, £500: 2 in October = £200) and 10–12 Oct (£300).
  for (const [i, o, total] of [
    ['2026-09-28', '2026-10-03', 50000],
    ['2026-10-10', '2026-10-12', 30000],
  ] as const) {
    await owner(
      `insert into app.reservations (organisation_id, property_id, channel, status, check_in, check_out, adults, currency, total_minor)
       values ($1, $2, 'airbnb', 'confirmed', $3, $4, 2, 'GBP', $5)`,
      [a.orgId, lodge, i, o, total],
    );
  }
  db = new ApiDatabase(t.apiUrl);
  app = await buildApp({
    env: loadEnv({ NODE_ENV: 'test', DATABASE_URL: t.apiUrl, SUPABASE_JWT_SECRET: JWT_SECRET }),
    db,
    verifyToken: createTokenVerifier({ jwtSecret: JWT_SECRET }),
    photos: files,
    now: () => NOW,
  });
});

afterAll(async () => {
  await app?.close();
  await db?.close();
  await t?.drop();
});

describe('owners and expenses', () => {
  let ellis: string;
  let glass: string;

  it('adds an owner with their fee and gives them homes', async () => {
    const made = await call('POST', '/v1/owners', asA(), {
      name: 'Ellis Morgan',
      email: 'ellis@example.test',
      feeBasisPoints: 2000,
      company: '',
    });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ name: 'Ellis Morgan', company: null, feeBasisPoints: 2000, homes: [] });
    ellis = made.body.id;
    const homes = await call('PUT', `/v1/owners/${ellis}/homes`, asA(), { propertyIds: [lodge] });
    expect(homes.body.homes).toEqual([{ id: lodge, name: 'Lodge' }]);
    const list = await call('GET', '/v1/owners', asA());
    expect(list.body.unowned).toEqual([{ id: flat, name: 'Flat' }]);
    const property = await call('GET', `/v1/properties/${lodge}`, asA());
    expect(property.body.owner).toEqual({ id: ellis, name: 'Ellis Morgan' });
    // And from the property's side.
    const moved = await call('PATCH', `/v1/properties/${flat}`, asA(), { ownerId: ellis });
    expect(moved.body.owner).toMatchObject({ id: ellis });
    await call('PATCH', `/v1/properties/${flat}`, asA(), { ownerId: null });
  });

  it('records expenses, charged to the owner or kept by the company', async () => {
    const e1 = await call('POST', '/v1/expenses', asA(), {
      spentOn: '2026-10-12',
      category: 'repairs',
      description: 'Coffee table glass',
      vendor: 'City Glass',
      amountMinor: 9000,
      propertyId: lodge,
    });
    expect(e1.status).toBe(201);
    expect(e1.body).toMatchObject({
      chargeTo: 'owner',
      propertyName: 'Lodge',
      ownerName: 'Ellis Morgan',
      currency: 'GBP',
    });
    glass = e1.body.id;
    await call('POST', '/v1/expenses', asA(), {
      spentOn: '2026-10-14',
      category: 'supplies',
      description: 'Toilet rolls',
      amountMinor: 1500,
      propertyId: lodge,
      chargeTo: 'company',
    });
    // Not for a home: the company's, whatever was asked.
    const general = await call('POST', '/v1/expenses', asA(), {
      spentOn: '2026-10-15',
      category: 'other',
      description: 'Key safe stock',
      amountMinor: 4000,
      chargeTo: 'owner',
    });
    expect(general.body.chargeTo).toBe('company');
    const list = await call('GET', '/v1/expenses?month=2026-10', asA());
    expect(list.body).toMatchObject({ totalMinor: 14500, ownerMinor: 9000, companyMinor: 5500 });
    expect(list.body.byCategory[0]).toEqual({ category: 'repairs', amountMinor: 9000 });
    expect((await call('GET', '/v1/expenses?month=2026-09', asA())).body.expenses).toEqual([]);
  });

  it('keeps a receipt as uploaded, one per expense', async () => {
    const ticket = await call('POST', `/v1/expenses/${glass}/receipt/uploads`, asA(), {
      contentType: 'application/pdf',
      bytes: 50_000,
    });
    expect(ticket.status).toBe(200);
    files.files.add(ticket.body.path);
    const done = await call('PUT', `/v1/expenses/${glass}/receipt`, asA(), {
      path: ticket.body.path,
      fileName: 'glass.pdf',
      contentType: 'application/pdf',
      bytes: 50_000,
    });
    expect(done.body.receipt).toMatchObject({
      fileName: 'glass.pdf',
      url: `https://photos.test/signed/${ticket.body.path}`,
    });
  });

  it("works out the owner's month: earned over the nights, less the fee and their expenses", async () => {
    const r = await call('GET', `/v1/owners/${ellis}/month?month=2026-10`, asA());
    expect(r.status).toBe(200);
    // 2 nights × £100 + 2 nights × £150 = £500; 20% fee £100; £90 glass charged to them.
    expect(r.body).toMatchObject({
      earnedMinor: 50000,
      feeMinor: 10000,
      expensesMinor: 9000,
      netMinor: 31000,
    });
    expect(r.body.homes).toEqual([
      { id: lodge, name: 'Lodge', nights: 4, earnedMinor: 50000, expensesMinor: 9000 },
    ]);
    expect(r.body.expenses).toHaveLength(1);
  });

  it('keeps money from guest comms, and owners and expenses inside their workspace', async () => {
    expect((await call('GET', '/v1/owners', guestComms)).status).toBe(403);
    expect((await call('GET', '/v1/expenses', guestComms)).status).toBe(403);
    expect((await call('GET', `/v1/owners/${ellis}/month`, asB())).status).toBe(404);
    expect((await call('PATCH', `/v1/expenses/${glass}`, asB(), { amountMinor: 1 })).status).toBe(404);
    expect((await call('DELETE', `/v1/expenses/${glass}`, asB())).status).toBe(404);
    // B can't put A's home on its own owner, or A's owner on its own home.
    const theirs = await call('POST', '/v1/owners', asB(), { name: 'Someone' });
    expect(
      (await call('PUT', `/v1/owners/${theirs.body.id}/homes`, asB(), { propertyIds: [lodge] })).status,
    ).toBe(400);
    expect(
      (
        await call('POST', '/v1/expenses', asB(), {
          spentOn: '2026-10-01',
          category: 'other',
          description: 'x',
          amountMinor: 1,
          propertyId: lodge,
        })
      ).status,
    ).toBe(400);
  });

  it('removing an owner leaves their homes with nobody recorded', async () => {
    expect((await call('DELETE', `/v1/owners/${ellis}`, asA())).status).toBe(204);
    expect((await call('GET', `/v1/properties/${lodge}`, asA())).body.owner).toBeNull();
  });
});
