import { ApiDatabase } from '@v01/db';
import { createTestDatabase, seedOperator, type TestDatabase } from '@v01/db/testing';
import { MemoryLockProvider, SecretBox } from '@v01/integrations';
import { addDays, todayIn } from '@v01/shared';
import type { FastifyInstance } from 'fastify';
import { SignJWT } from 'jose';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { createTokenVerifier } from '../src/auth.ts';
import { loadEnv } from '../src/env.ts';

/**
 * Door locks: connecting the TTLock app account (the password never kept), placing locks on homes,
 * the rules for turning codes on, who sees the digits, and Today's warnings.
 */

const JWT_SECRET = 'test-only-jwt-secret-with-enough-length';
const KEY = 'k'.repeat(40);
const box = new SecretBox(KEY);

let t: TestDatabase;
let db: ApiDatabase;
let app: FastifyInstance;
let a: { orgId: string; userId: string };
let b: { orgId: string; userId: string };
let accounts: { orgId: string; userId: string };
let lodge: string;
const ttlock = new MemoryLockProvider();

type Who = { userId: string; email: string; orgId: string };
const asA = (): Who => ({ ...a, email: 'admin-a@example.test' });
const asB = (): Who => ({ ...b, email: 'admin-b@example.test' });
const asAccounts = (): Who => ({ ...accounts, email: 'accounts@example.test' });

async function call(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  options: { as: Who; body?: unknown },
  // biome-ignore lint/suspicious/noExplicitAny: tests read response bodies loosely
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
  const [user] = await owner<{ id: string }>(
    `insert into app.app_users (id, email) values (gen_random_uuid(), 'accounts@example.test') returning id`,
  );
  await owner(`insert into app.memberships (organisation_id, user_id, role) values ($1, $2, 'accounts')`, [
    a.orgId,
    user!.id,
  ]);
  accounts = { orgId: a.orgId, userId: user!.id };
  db = new ApiDatabase(t.apiUrl);
  app = await buildApp({
    env: loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: t.apiUrl,
      SUPABASE_JWT_SECRET: JWT_SECRET,
      FIELD_SECRET_KEY: KEY,
    }),
    db,
    verifyToken: createTokenVerifier({ jwtSecret: JWT_SECRET }),
    locks: ttlock,
  });
  lodge = (
    await call('POST', '/v1/properties', {
      as: asA(),
      body: { name: 'Harbour View Lodge', countryCode: 'GB', maxGuests: 6 },
    })
  ).body.id;
});

afterAll(async () => {
  await app?.close();
  await db?.close();
  await t?.drop();
});

describe('door locks', () => {
  it('starts with nothing connected', async () => {
    const r = await call('GET', '/v1/locks', { as: asA() });
    expect(r.body).toEqual({ available: true, account: null, locks: [], failedCodes: 0 });
  });

  it('refuses a wrong TTLock password, and says which account to use', async () => {
    const r = await call('POST', '/v1/locks/connect', {
      as: asA(),
      body: { username: 'me@a.test', password: 'nope' },
    });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/TTLock app’s account/);
  });

  it('connects, keeps only a sealed token, and lists the locks and gateways', async () => {
    const r = await call('POST', '/v1/locks/connect', {
      as: asA(),
      body: { username: 'locks@a.test', password: 'ttlock' },
    });
    expect(r.status).toBe(200);
    expect(r.body.account).toMatchObject({
      username: 'locks@a.test',
      status: 'connected',
      gateways: [{ name: 'Hallway gateway', online: true }],
    });
    expect(r.body.locks.map((l: { name: string }) => l.name).sort()).toEqual(['Back door', 'Front door']);
    const [row] = await owner<{ token_sealed: Buffer }>(`select token_sealed from app.lock_accounts`);
    expect(row!.token_sealed.toString('utf8')).not.toContain('access-locks@a.test');
    expect(JSON.parse(box.open(row!.token_sealed) ?? '{}').accessToken).toBe('access-locks@a.test');
    // Only the token is kept: no column anywhere holds the password, sealed or not.
    const cols = await owner<{ column_name: string }>(
      `select column_name from information_schema.columns where table_schema = 'app' and table_name = 'lock_accounts'`,
    );
    expect(cols.map((c) => c.column_name).filter((c) => c.includes('password'))).toEqual([]);
  });

  it('puts a lock on a home and turns codes on, only with a home and a gateway', async () => {
    const front = (await call('GET', '/v1/locks', { as: asA() })).body.locks.find(
      (l: { name: string }) => l.name === 'Front door',
    );
    const early = await call('PATCH', `/v1/locks/${front.id}`, { as: asA(), body: { makesCodes: true } });
    expect(early.status).toBe(400);
    expect(early.body.error.code).toBe('lock_needs_property');
    const placed = await call('PATCH', `/v1/locks/${front.id}`, {
      as: asA(),
      body: { propertyId: lodge, makesCodes: true },
    });
    expect(placed.status).toBe(200);
    expect(placed.body.locks.find((l: { id: string }) => l.id === front.id)).toMatchObject({
      propertyName: 'Harbour View Lodge',
      makesCodes: true,
    });
    await owner(`update app.locks set has_gateway = false where name = 'Back door'`);
    const back = placed.body.locks.find((l: { name: string }) => l.name === 'Back door');
    const noGateway = await call('PATCH', `/v1/locks/${back.id}`, {
      as: asA(),
      body: { propertyId: lodge, makesCodes: true },
    });
    expect(noGateway.body.error.code).toBe('lock_needs_gateway');
  });

  it('keeps other operators and other roles out', async () => {
    expect((await call('GET', '/v1/locks', { as: asB() })).body.locks).toEqual([]);
    const r = await call('POST', '/v1/locks/refresh', { as: asAccounts() });
    expect(r.status).toBe(403);
  });

  it('shows a booking’s code once the lock has it, digits only to people who may read codes', async () => {
    const today = todayIn('Europe/London');
    const [res] = await owner<{ id: string }>(
      `insert into app.reservations (organisation_id, property_id, channel, status, check_in, check_out, adults)
       values ($1, $2, 'direct', 'confirmed', $3, $4, 2) returning id`,
      [a.orgId, lodge, addDays(today, 3), addDays(today, 5)],
    );
    const [lock] = await owner<{ id: string }>(`select id from app.locks where name = 'Front door'`);
    await owner(
      `insert into app.lock_codes (organisation_id, lock_id, reservation_id, kind, code_sealed, starts_at, ends_at, status)
       values ($1, $2, $3, 'guest', $4, now() + interval '3 days', now() + interval '5 days', 'set')`,
      [a.orgId, lock!.id, res!.id, box.seal('482915')],
    );
    const office = await call('GET', `/v1/reservations/${res!.id}/door-codes`, { as: asA() });
    expect(office.body.codes).toEqual([
      expect.objectContaining({ lockName: 'Front door', code: '482915', status: 'set' }),
    ]);
    const acc = await call('GET', `/v1/reservations/${res!.id}/door-codes`, { as: asAccounts() });
    expect(acc.body.codes[0].code).toBeNull();
  });

  it('warns on Today about a low battery and a lost sign-in', async () => {
    await owner(`update app.locks set battery = 12 where name = 'Front door'`);
    await owner(
      `update app.lock_accounts set status = 'error', last_error = 'TTLock refused V-01’s sign-in'`,
    );
    const today = await call('GET', '/v1/today', { as: asA() });
    const ids = today.body.attention.map((x: { id: string }) => x.id);
    expect(ids).toContain('locks:account');
    expect(ids.some((id: string) => id.startsWith('locks:battery:'))).toBe(true);
  });

  it('disconnects, taking the locks with it', async () => {
    const r = await call('DELETE', '/v1/locks/account', { as: asA() });
    expect(r.body).toMatchObject({ account: null, locks: [] });
  });
});
