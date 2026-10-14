import { signChannexWebhook } from '@v01/channels';
import { ApiDatabase } from '@v01/db';
import { createTestDatabase, seedOperator, type TestDatabase } from '@v01/db/testing';
import type { FastifyInstance } from 'fastify';
import { SignJWT } from 'jose';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { createTokenVerifier } from '../src/auth.ts';
import { loadEnv } from '../src/env.ts';

const JWT_SECRET = 'test-only-jwt-secret-with-enough-length';
const WEBHOOK_SECRET = 'test-only-channex-signing-secret';

let t: TestDatabase;
let db: ApiDatabase;
let app: FastifyInstance;
let a: { orgId: string; userId: string };
let b: { orgId: string; userId: string };
let fieldUserId: string;

async function owner<T extends pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> {
  const client = new pg.Client({ connectionString: t.ownerUrl });
  await client.connect();
  try {
    return (await client.query<T>(text, values)).rows;
  } finally {
    await client.end();
  }
}

function token(userId: string, email: string, secret = JWT_SECRET): Promise<string> {
  return new SignJWT({ email, role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(secret));
}

async function call(
  method: 'GET' | 'POST',
  url: string,
  options: { as?: { userId: string; email: string }; org?: string; body?: unknown } = {},
) {
  const headers: Record<string, string> = {};
  if (options.as) headers.authorization = `Bearer ${await token(options.as.userId, options.as.email)}`;
  if (options.org) headers['x-org-id'] = options.org;
  const response = await app.inject({ method, url, headers, payload: options.body as never });
  return { status: response.statusCode, body: response.json() as Record<string, unknown> };
}

const asA = () => ({ userId: a.userId, email: 'admin-a@example.test' });
const asB = () => ({ userId: b.userId, email: 'admin-b@example.test' });

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
  const [field] = await owner<{ id: string }>(
    `insert into app.app_users (id, email) values (gen_random_uuid(), 'cleaner@example.test') returning id`,
  );
  fieldUserId = field!.id;
  await owner(`insert into app.memberships (organisation_id, user_id, role) values ($1, $2, 'field')`, [
    a.orgId,
    fieldUserId,
  ]);

  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: t.apiUrl,
    SUPABASE_JWT_SECRET: JWT_SECRET,
    CHANNEX_WEBHOOK_SECRET: WEBHOOK_SECRET,
  });
  db = new ApiDatabase(t.apiUrl);
  app = await buildApp({ env, db, verifyToken: createTokenVerifier({ jwtSecret: JWT_SECRET }) });
});

afterAll(async () => {
  await app?.close();
  await db?.close();
  await t?.drop();
});

describe('health and brand', () => {
  it('reports a healthy database', async () => {
    expect(await call('GET', '/health')).toEqual({ status: 200, body: { status: 'ok', database: 'ok' } });
  });

  it('serves the app brand publicly (Vivistays for now)', async () => {
    const { status, body } = await call('GET', '/v1/app-brand');
    expect(status).toBe(200);
    expect(body.name).toBe('Vivistays');
  });
});

describe('sign-in', () => {
  it('refuses requests without a token', async () => {
    const { status, body } = await call('GET', '/v1/me');
    expect(status).toBe(401);
    expect((body.error as { code: string }).code).toBe('not_signed_in');
  });

  it('refuses a token signed with the wrong key', async () => {
    const forged = await token(a.userId, 'admin-a@example.test', 'some-other-secret-of-sufficient-length');
    const response = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${forged}` },
    });
    expect(response.statusCode).toBe(401);
  });

  it('lists the operators a person belongs to', async () => {
    const { status, body } = await call('GET', '/v1/me', { as: asA() });
    expect(status).toBe(200);
    expect(body.memberships).toEqual([
      { organisationId: a.orgId, organisationName: 'Operator A', role: 'admin' },
    ]);
  });

  it('turns an invitation into a membership on first sign-in', async () => {
    await owner(
      `insert into app.invitations (organisation_id, email, role) values ($1, 'new.ops@example.test', 'operations')`,
      [b.orgId],
    );
    const newcomer = { userId: '5b7e2f1a-9c3d-4e8f-a1b2-c3d4e5f60718', email: 'New.Ops@example.test' };
    const { status, body } = await call('GET', '/v1/me', { as: newcomer });
    expect(status).toBe(200);
    expect(body.memberships).toEqual([
      { organisationId: b.orgId, organisationName: 'Operator B', role: 'operations' },
    ]);
  });
});

describe('properties', () => {
  let propertyA: string;

  it('creates a property and records who did it', async () => {
    const { status, body } = await call('POST', '/v1/properties', {
      as: asA(),
      org: a.orgId,
      body: { name: 'Harbour View Lodge', internalCode: 'HVL', countryCode: 'gb', maxGuests: 6, bedrooms: 3 },
    });
    expect(status).toBe(201);
    expect(body).toMatchObject({
      name: 'Harbour View Lodge',
      countryCode: 'GB',
      checkInTime: '15:00',
      managedBy: 'guesty',
    });
    propertyA = body.id as string;
    const audit = await owner<{ actor_user_id: string }>(
      `select actor_user_id from app.audit_log where entity_id = $1 and action = 'insert'`,
      [propertyA],
    );
    expect(audit).toEqual([{ actor_user_id: a.userId }]);
  });

  it('rejects invalid input with a readable message', async () => {
    const { status, body } = await call('POST', '/v1/properties', {
      as: asA(),
      org: a.orgId,
      body: { name: '', countryCode: 'GB', maxGuests: 0 },
    });
    expect(status).toBe(400);
    expect((body.error as { code: string }).code).toBe('invalid_request');
  });

  it('refuses a duplicate property code', async () => {
    const { status } = await call('POST', '/v1/properties', {
      as: asA(),
      org: a.orgId,
      body: { name: 'Another', internalCode: 'HVL', countryCode: 'GB', maxGuests: 2 },
    });
    expect(status).toBe(409);
  });

  it("lists only the operator's own properties", async () => {
    const mine = await call('GET', '/v1/properties', { as: asA(), org: a.orgId });
    expect((mine.body.properties as { id: string }[]).map((p) => p.id)).toEqual([propertyA]);
    const theirs = await call('GET', '/v1/properties', { as: asB(), org: b.orgId });
    expect(theirs.body.properties).toEqual([]);
  });

  it("does not let a second operator open the first operator's property by id", async () => {
    const { status } = await call('GET', `/v1/properties/${propertyA}`, { as: asB(), org: b.orgId });
    expect(status).toBe(404);
  });

  it("refuses a workspace the person doesn't belong to", async () => {
    const { status, body } = await call('GET', '/v1/properties', { as: asB(), org: a.orgId });
    expect(status).toBe(403);
    expect((body.error as { code: string }).code).toBe('not_a_member');
  });

  it('stops the field team reading the property list (they see their own jobs instead)', async () => {
    const { status, body } = await call('GET', '/v1/properties', {
      as: { userId: fieldUserId, email: 'cleaner@example.test' },
      org: a.orgId,
    });
    expect(status).toBe(403);
    expect((body.error as { code: string }).code).toBe('not_allowed');
  });

  it('asks for a workspace when none is chosen', async () => {
    const { status } = await call('GET', '/v1/properties', { as: asA() });
    expect(status).toBe(400);
  });

  it('stores what kind of place it is, and its rooms, for the channels', async () => {
    const { status, body } = await call('POST', '/v1/properties', {
      as: asA(),
      org: a.orgId,
      body: {
        name: 'Quay House',
        countryCode: 'GB',
        maxGuests: 6,
        propertyType: 'cottage',
        spaceType: 'entire_place',
        bedrooms: 3,
        beds: 4,
        bathrooms: 1.5,
        priceOwner: 'pricelabs',
      },
    });
    expect(status).toBe(201);
    expect(body).toMatchObject({
      propertyType: 'cottage',
      spaceType: 'entire_place',
      bedrooms: 3,
      beds: 4,
      bathrooms: 1.5,
      priceOwner: 'pricelabs',
    });
    const plain = await call('POST', '/v1/properties', {
      as: asA(),
      org: a.orgId,
      body: { name: 'Plain Flat', countryCode: 'GB', maxGuests: 2 },
    });
    expect(plain.body).toMatchObject({
      propertyType: null,
      spaceType: 'entire_place',
      beds: null,
      bathrooms: null,
    });
  });

  it('refuses bathrooms that are not whole or half', async () => {
    const { status } = await call('POST', '/v1/properties', {
      as: asA(),
      org: a.orgId,
      body: { name: 'Odd Baths', countryCode: 'GB', maxGuests: 2, bathrooms: 1.3 },
    });
    expect(status).toBe(400);
  });
});

describe('workspace', () => {
  it('returns the operator, its settings, its brand and the role', async () => {
    const { status, body } = await call('GET', '/v1/workspace', { as: asA(), org: a.orgId });
    expect(status).toBe(200);
    expect(body).toMatchObject({
      organisation: { id: a.orgId, name: 'Operator A' },
      settings: { currency: 'GBP', timeZone: 'Europe/London' },
      brand: { displayName: 'Operator A' },
      role: 'admin',
    });
  });
});

describe('Channex webhooks', () => {
  const payload = JSON.stringify({
    event: 'booking_new',
    property_id: 'cx-prop-1',
    payload: { booking_id: 'bk-1' },
  });

  it('stores a correctly signed webhook', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/channex',
      headers: { 'content-type': 'application/json', ...signChannexWebhook(payload, WEBHOOK_SECRET) },
      payload,
    });
    expect(response.statusCode).toBe(200);
    const rows = await owner<{ event: string; external_property_id: string }>(
      `select event, external_property_id from app.webhook_events`,
    );
    expect(rows).toEqual([{ event: 'booking_new', external_property_id: 'cx-prop-1' }]);
  });

  it('refuses an unsigned or stale webhook', async () => {
    const unsigned = await app.inject({
      method: 'POST',
      url: '/webhooks/channex',
      headers: { 'content-type': 'application/json' },
      payload,
    });
    expect(unsigned.statusCode).toBe(401);
    const stale = await app.inject({
      method: 'POST',
      url: '/webhooks/channex',
      headers: {
        'content-type': 'application/json',
        ...signChannexWebhook(payload, WEBHOOK_SECRET, Math.floor(Date.now() / 1000) - 600),
      },
      payload,
    });
    expect(stale.statusCode).toBe(401);
  });
});
