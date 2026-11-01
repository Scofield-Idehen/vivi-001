import { ApiDatabase } from '@v01/db';
import { createTestDatabase, seedOperator, type TestDatabase } from '@v01/db/testing';
import { todayIn } from '@v01/shared';
import type { FastifyInstance } from 'fastify';
import { SignJWT } from 'jose';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { createTokenVerifier } from '../src/auth.ts';
import { loadEnv } from '../src/env.ts';
import { MemoryUserDirectory } from '../src/invites.ts';

/** Cleaners and maintenance from Guesty, skills, and who may be given which job. */

const JWT_SECRET = 'test-only-jwt-secret-with-enough-length';
let t: TestDatabase;
let db: ApiDatabase;
let app: FastifyInstance;
const directory = new MemoryUserDirectory();
let a: { orgId: string; userId: string };
let ops: { orgId: string; userId: string };
let lodge: string;
let flat: string;
const people: Record<'cleaner' | 'fixer' | 'office' | 'noEmail', string> = {} as never;
const today = todayIn('Europe/London');

type Who = { userId: string; email: string; orgId: string };
const asA = (): Who => ({ ...a, email: 'admin-a@example.test' });
const asOps = (): Who => ({ ...ops, email: 'ops@example.test' });

async function call(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH',
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

async function staged(
  name: string,
  email: string | null,
  tags: string[],
  skills: string[],
  homes: string[] | null,
) {
  const [row] = await owner<{ id: string }>(
    `insert into app.guesty_staff (organisation_id, guesty_user_id, full_name, email, tags, skills, property_ids)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [a.orgId, `g-${name}`, name, email, tags, skills, homes],
  );
  return row!.id;
}

const job = (kind: string, propertyId: string, assigneeId: string) =>
  call('POST', '/v1/tasks', { as: asA(), body: { kind, propertyId, dueOn: today, assigneeId } });

beforeAll(async () => {
  t = await createTestDatabase();
  a = await seedOperator(t.ownerUrl, { name: 'A', slug: 'a', userEmail: 'admin-a@example.test' });
  const [u] = await owner<{ id: string }>(
    `insert into app.app_users (id, email) values (gen_random_uuid(), 'ops@example.test') returning id`,
  );
  await owner(`insert into app.memberships (organisation_id, user_id, role) values ($1, $2, 'operations')`, [
    a.orgId,
    u!.id,
  ]);
  ops = { orgId: a.orgId, userId: u!.id };
  db = new ApiDatabase(t.apiUrl);
  app = await buildApp({
    env: loadEnv({ NODE_ENV: 'test', DATABASE_URL: t.apiUrl, SUPABASE_JWT_SECRET: JWT_SECRET }),
    db,
    verifyToken: createTokenVerifier({ jwtSecret: JWT_SECRET }),
    directory,
  });
  const home = async (name: string) =>
    (await call('POST', '/v1/properties', { as: asA(), body: { name, countryCode: 'GB', maxGuests: 4 } }))
      .body.id as string;
  lodge = await home('Harbour View Lodge');
  flat = await home('Old Town Flat');
  people.cleaner = await staged('Cara Clean', 'cara@example.test', ['cleaners'], ['cleaning'], [lodge]);
  people.fixer = await staged('Max Fix', 'max@example.test', ['Maintainance '], ['maintenance'], null);
  people.office = await staged('Ola Office', 'ops@example.test', [], [], null);
  people.noEmail = await staged('No Mail', null, ['cleaners'], ['cleaning'], null);
});

afterAll(async () => {
  await app?.close();
  await db?.close();
  await t?.drop();
});

describe('people from Guesty', () => {
  it('lists them for admins only, marking who is already here', async () => {
    const list = await call('GET', '/v1/team/guesty', { as: asA() });
    expect(list.status).toBe(200);
    expect(list.body.people).toHaveLength(4);
    const office = list.body.people.find((p: { name: string }) => p.name === 'Ola Office');
    expect(office).toMatchObject({ memberId: ops.userId, memberRole: 'operations' });
    expect((await call('GET', '/v1/team/guesty', { as: asOps() })).status).toBe(403);
  });

  it('adds them as the field team with skills and homes, without email, and skips anyone without one', async () => {
    const added = await call('POST', '/v1/team/guesty', {
      as: asA(),
      body: { ids: [people.cleaner, people.fixer, people.office, people.noEmail] },
    });
    expect(added.status).toBe(200);
    expect(added.body).toMatchObject({ added: 2, updated: 1 });
    expect(added.body.skipped).toEqual([{ name: 'No Mail', reason: 'No email in Guesty.' }]);
    expect(directory.made.size).toBe(2);
    const team = (await call('GET', '/v1/team', { as: asA() })).body.members;
    const cara = team.find((m: { email: string }) => m.email === 'cara@example.test');
    expect(cara).toMatchObject({
      role: 'field',
      skills: ['cleaning'],
      propertyIds: [lodge],
      name: 'Cara Clean',
    });
    const max = team.find((m: { email: string }) => m.email === 'max@example.test');
    expect(max).toMatchObject({ role: 'field', skills: ['maintenance'], propertyIds: null });
    const ola = team.find((m: { email: string }) => m.email === 'ops@example.test');
    expect(ola).toMatchObject({ role: 'operations' });
    // Adding again changes nothing new.
    const again = await call('POST', '/v1/team/guesty', { as: asA(), body: { ids: [people.cleaner] } });
    expect(again.body).toMatchObject({ added: 0, updated: 1 });
    expect(directory.made.size).toBe(2);
  });

  it('gives a clean only to a cleaner on that home, and a repair only to maintenance', async () => {
    const cara = directory.made.get('cara@example.test')!;
    const max = directory.made.get('max@example.test')!;
    expect((await job('cleaning', lodge, cara)).status).toBe(201);
    const otherHome = await job('cleaning', flat, cara);
    expect(otherHome.status).toBe(400);
    expect(otherHome.body.error.code).toBe('not_their_home');
    const wrong = await job('cleaning', lodge, max);
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe('wrong_skill');
    expect((await job('maintenance', flat, max)).status).toBe(201);
    expect((await job('maintenance', lodge, cara)).body.error.code).toBe('wrong_skill');
    expect((await job('inspection', lodge, max)).status).toBe(201);
    // A home's usual cleaner follows the same rule.
    const usual = await call('PATCH', `/v1/properties/${lodge}`, { as: asA(), body: { cleanerUserId: max } });
    expect(usual.status).toBe(400);
    expect(
      (await call('PATCH', `/v1/properties/${lodge}`, { as: asA(), body: { cleanerUserId: cara } })).status,
    ).toBe(200);
  });

  it('lets an admin change skills', async () => {
    const max = directory.made.get('max@example.test')!;
    const changed = await call('PUT', `/v1/members/${max}/skills`, {
      as: asA(),
      body: { skills: ['maintenance', 'cleaning'] },
    });
    expect(changed.status).toBe(200);
    expect(changed.body.skills.sort()).toEqual(['cleaning', 'maintenance']);
    expect((await job('cleaning', lodge, max)).status).toBe(201);
  });

  it('keeps the same person when they later sign in', async () => {
    const cara = directory.made.get('cara@example.test')!;
    const me = await call('GET', '/v1/me', {
      as: { userId: cara, email: 'cara@example.test', orgId: a.orgId },
    });
    expect(me.status).toBe(200);
    expect(me.body.memberships ?? me.body.organisations ?? me.body).toBeTruthy();
    const [m] = await owner<{ role: string; skills: string[] }>(
      'select role::text, skills from app.memberships where user_id = $1',
      [cara],
    );
    expect(m).toEqual({ role: 'field', skills: ['cleaning'] });
  });

  it('carries skills on an invitation into the membership', async () => {
    const invited = await call('POST', '/v1/invitations', {
      as: asA(),
      body: { email: 'new@example.test', name: 'New Cleaner', role: 'field', skills: ['cleaning'] },
    });
    expect(invited.status).toBe(201);
    expect(invited.body.invitation.skills).toEqual(['cleaning']);
    const id = crypto.randomUUID();
    await owner(`insert into app.app_users (id, email) values ($1, 'new@example.test')`, [id]);
    await call('GET', '/v1/me', { as: { userId: id, email: 'new@example.test', orgId: a.orgId } });
    const [m] = await owner<{ skills: string[] }>('select skills from app.memberships where user_id = $1', [
      id,
    ]);
    expect(m?.skills).toEqual(['cleaning']);
  });
});
