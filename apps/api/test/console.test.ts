import { ApiDatabase } from '@v01/db';
import { createTestDatabase, seedOperator, seedPlatformStaff, type TestDatabase } from '@v01/db/testing';
import type { FastifyInstance } from 'fastify';
import { SignJWT } from 'jose';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { createTokenVerifier } from '../src/auth.ts';
import { loadEnv } from '../src/env.ts';

/**
 * The console and support access, through the API: who can use them, what they return,
 * and that support access is read-only, logged and ends.
 */

const JWT_SECRET = 'test-only-jwt-secret-with-enough-length';

let t: TestDatabase;
let db: ApiDatabase;
let app: FastifyInstance;
let a: { orgId: string; userId: string };
let b: { orgId: string; userId: string };
const people: Record<
  'adminA' | 'adminB' | 'owner' | 'support' | 'viewer',
  { userId: string; email: string }
> = {
  adminA: { userId: '', email: 'admin-a@example.test' },
  adminB: { userId: '', email: 'admin-b@example.test' },
  owner: { userId: '', email: 'owner@v01.test' },
  support: { userId: '', email: 'support@v01.test' },
  viewer: { userId: '', email: 'viewer@v01.test' },
};

async function owner<T extends pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> {
  const client = new pg.Client({ connectionString: t.ownerUrl });
  await client.connect();
  try {
    return (await client.query<T>(text, values)).rows;
  } finally {
    await client.end();
  }
}

function token(who: { userId: string; email: string }): Promise<string> {
  return new SignJWT({ email: who.email, role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(who.userId)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function call(
  method: 'GET' | 'POST',
  url: string,
  as: keyof typeof people,
  options: { org?: string; body?: unknown } = {},
) {
  const headers: Record<string, string> = { authorization: `Bearer ${await token(people[as])}` };
  if (options.org) headers['x-org-id'] = options.org;
  const response = await app.inject({ method, url, headers, payload: options.body as never });
  return { status: response.statusCode, body: response.json() as Record<string, unknown> };
}

const errorCode = (body: Record<string, unknown>) => (body.error as { code: string }).code;

beforeAll(async () => {
  t = await createTestDatabase();
  a = await seedOperator(t.ownerUrl, {
    name: 'Operator A',
    slug: 'operator-a',
    userEmail: people.adminA.email,
  });
  b = await seedOperator(t.ownerUrl, {
    name: 'Operator B',
    slug: 'operator-b',
    userEmail: 'admin-b@example.test',
  });
  people.adminA.userId = a.userId;
  people.adminB.userId = b.userId;
  // The owner is added by email only, as `pnpm db:staff add` does, and linked on first sign-in.
  people.owner.userId = (
    await seedPlatformStaff(t.ownerUrl, { email: people.owner.email, role: 'owner', linked: false })
  ).userId;
  people.support.userId = (
    await seedPlatformStaff(t.ownerUrl, { email: people.support.email, role: 'support' })
  ).userId;
  people.viewer.userId = (
    await seedPlatformStaff(t.ownerUrl, { email: people.viewer.email, role: 'viewer' })
  ).userId;
  await owner(
    `insert into app.properties (organisation_id, name, country_code, max_guests, managed_by)
     values ($1, 'Harbour View Lodge', 'GB', 6, 'v01'), ($2, 'Orchard Cottage', 'GB', 4, 'guesty')`,
    [a.orgId, b.orgId],
  );

  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: t.apiUrl,
    SUPABASE_JWT_SECRET: JWT_SECRET,
    CHANNEX_WEBHOOK_SECRET: 'test-only-channex-signing-secret',
  });
  db = new ApiDatabase(t.apiUrl);
  app = await buildApp({ env, db, verifyToken: createTokenVerifier({ jwtSecret: JWT_SECRET }) });
});

afterAll(async () => {
  await app?.close();
  await db?.close();
  await t?.drop();
});

describe('who sees the console', () => {
  it('tells the web app an operator admin is not V-01 staff', async () => {
    const { status, body } = await call('GET', '/v1/me', 'adminA');
    expect(status).toBe(200);
    expect(body).toMatchObject({ platformRole: null, supportAccess: [] });
  });

  it('recognises V-01 staff on their first sign-in', async () => {
    const { body } = await call('GET', '/v1/me', 'owner');
    expect(body).toMatchObject({ platformRole: 'owner', memberships: [], supportAccess: [] });
  });

  it('keeps every console route to V-01 staff', async () => {
    for (const url of [
      '/v1/console/overview',
      '/v1/console/operators',
      '/v1/console/sync',
      '/v1/console/support',
    ]) {
      const { status, body } = await call('GET', url, 'adminA');
      expect(status, url).toBe(403);
      expect(errorCode(body)).toBe('not_platform_staff');
    }
  });
});

describe('console reads', () => {
  it('lists every operator with its totals', async () => {
    const { status, body } = await call('GET', '/v1/console/operators', 'viewer');
    expect(status).toBe(200);
    expect(body.operators).toMatchObject([
      { name: 'Operator A', status: 'live', properties: 1, propertiesOnV01: 1, members: 1, channels: [] },
      { name: 'Operator B', status: 'onboarding', properties: 1, propertiesOnV01: 0, members: 1 },
    ]);
  });

  it('adds it all up in the overview', async () => {
    const { body } = await call('GET', '/v1/console/overview', 'viewer');
    expect(body).toMatchObject({
      operators: 2,
      operatorsLive: 1,
      properties: 2,
      propertiesOnV01: 1,
      outboxFailed: 0,
    });
  });

  it("shows an operator's team to support, but not to viewers", async () => {
    const support = await call('GET', `/v1/console/operators/${a.orgId}`, 'support');
    expect(support.status).toBe(200);
    expect(support.body.team).toEqual([
      expect.objectContaining({ email: 'admin-a@example.test', role: 'admin', status: 'active' }),
    ]);
    const viewer = await call('GET', `/v1/console/operators/${a.orgId}`, 'viewer');
    expect(viewer.body).toMatchObject({
      operator: { name: 'Operator A', timeZone: 'Europe/London' },
      team: null,
    });
  });

  it('answers 404 for an operator that does not exist', async () => {
    const { status } = await call(
      'GET',
      '/v1/console/operators/1b2c3d4e-5f60-4718-9a0b-1c2d3e4f5a6b',
      'support',
    );
    expect(status).toBe(404);
  });

  it('reports sync health per operator', async () => {
    const { status, body } = await call('GET', '/v1/console/sync', 'viewer');
    expect(status).toBe(200);
    expect((body.rows as { organisationName: string }[]).map((r) => r.organisationName)).toEqual([
      'Operator A',
      'Operator B',
    ]);
    expect(body.errors).toEqual([]);
  });
});

describe('support access', () => {
  let grantId: string;

  it('is needed before V-01 staff can open a workspace they are not a member of', async () => {
    const { status, body } = await call('GET', '/v1/properties', 'support', { org: a.orgId });
    expect(status).toBe(403);
    expect(errorCode(body)).toBe('not_a_member');
  });

  it('cannot be opened by a viewer or without a real reason', async () => {
    const byViewer = await call('POST', `/v1/console/operators/${a.orgId}/support-access`, 'viewer', {
      body: { reason: 'Checking a booking', minutes: 30 },
    });
    expect(byViewer.status).toBe(403);
    const noReason = await call('POST', `/v1/console/operators/${a.orgId}/support-access`, 'support', {
      body: { reason: 'hi', minutes: 30 },
    });
    expect(noReason.status).toBe(400);
  });

  it('opens for one operator, for a set time, with a reason', async () => {
    const { status, body } = await call(
      'POST',
      `/v1/console/operators/${a.orgId}/support-access`,
      'support',
      {
        body: { reason: 'Ticket 12: guest says the booking is missing', minutes: 30 },
      },
    );
    expect(status).toBe(201);
    expect(body).toMatchObject({
      organisationName: 'Operator A',
      staffEmail: 'support@v01.test',
      active: true,
    });
    grantId = body.id as string;
    const minutes = (Date.parse(body.expiresAt as string) - Date.parse(body.startedAt as string)) / 60_000;
    expect(Math.round(minutes)).toBe(30);
    const me = await call('GET', '/v1/me', 'support');
    expect(me.body.supportAccess).toEqual([
      expect.objectContaining({ grantId, organisationId: a.orgId, organisationName: 'Operator A' }),
    ]);
  });

  it('lets them read that workspace, as V-01 support', async () => {
    const properties = await call('GET', '/v1/properties', 'support', { org: a.orgId });
    expect(properties.status).toBe(200);
    expect((properties.body.properties as { name: string }[]).map((p) => p.name)).toEqual([
      'Harbour View Lodge',
    ]);
    const workspace = await call('GET', '/v1/workspace', 'support', { org: a.orgId });
    expect(workspace.body).toMatchObject({ organisation: { name: 'Operator A' }, role: 'v01_support' });
  });

  it('never lets them change anything', async () => {
    const { status, body } = await call('POST', '/v1/properties', 'support', {
      org: a.orgId,
      body: { name: 'Planted', countryCode: 'GB', maxGuests: 2 },
    });
    expect(status).toBe(403);
    expect(errorCode(body)).toBe('support_read_only');
    const [row] = await owner<{ n: number }>(
      `select count(*)::int as n from app.properties where name = 'Planted'`,
    );
    expect(row?.n).toBe(0);
  });

  it('shows the visit to the operator it opened, and to no other', async () => {
    const mine = await call('GET', '/v1/workspace/support-visits', 'adminA', { org: a.orgId });
    expect(mine.status).toBe(200);
    expect(mine.body.visits).toEqual([
      expect.objectContaining({
        id: grantId,
        staffEmail: 'support@v01.test',
        reason: 'Ticket 12: guest says the booking is missing',
        endedAt: null,
      }),
    ]);
    const theirs = await call('GET', '/v1/workspace/support-visits', 'adminB', { org: b.orgId });
    expect(theirs.body.visits).toEqual([]);
  });

  it('does not open any other operator', async () => {
    const { status } = await call('GET', '/v1/properties', 'support', { org: b.orgId });
    expect(status).toBe(403);
  });

  it('logs every request, including the refused one', async () => {
    const { body } = await call('GET', '/v1/console/support', 'viewer');
    const grant = (body.grants as { id: string; requests: number }[]).find((g) => g.id === grantId);
    expect(grant?.requests).toBe(3);
    const logged = await owner<{ path: string; allowed: boolean }>(
      `select detail->>'path' as path, (detail->>'allowed')::boolean as allowed
         from app.platform_audit where grant_id = $1 and action = 'support.request' order by id`,
      [grantId],
    );
    expect(logged).toEqual([
      { path: '/v1/properties', allowed: true },
      { path: '/v1/workspace', allowed: true },
      { path: '/v1/properties', allowed: false },
    ]);
  });

  it('ends when asked, and the workspace closes again', async () => {
    const ended = await call('POST', `/v1/console/support-access/${grantId}/end`, 'support');
    expect(ended.body).toEqual({ ended: true });
    const { status } = await call('GET', '/v1/properties', 'support', { org: a.orgId });
    expect(status).toBe(403);
    const me = await call('GET', '/v1/me', 'support');
    expect(me.body.supportAccess).toEqual([]);
  });
});
