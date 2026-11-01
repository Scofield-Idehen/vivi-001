import { ApiDatabase } from '@v01/db';
import { createTestDatabase, seedOperator, type TestDatabase } from '@v01/db/testing';
import type { FastifyInstance } from 'fastify';
import { SignJWT } from 'jose';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { createTokenVerifier } from '../src/auth.ts';
import { loadEnv } from '../src/env.ts';

/**
 * Access by home and the owner log-in (1 Nov 2026): someone limited to some homes, and an owner
 * signed in, see only their homes on every page, because the database says so.
 */

const JWT_SECRET = 'test-only-jwt-secret-with-enough-length';

let t: TestDatabase;
let db: ApiDatabase;
let app: FastifyInstance;
let a: { orgId: string; userId: string };
let ops: Who;
let lodge: string;
let flat: string;
let ellis: string;

type Who = { userId: string; email: string; orgId: string };
const admin = (): Who => ({ ...a, email: 'admin-a@example.test' });

async function token(as: { userId: string; email: string }) {
  return new SignJWT({ email: as.email, role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(as.userId)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function call(method: string, url: string, as: Who, body?: unknown) {
  const r = await app.inject({
    method: method as 'GET',
    url,
    headers: { authorization: `Bearer ${await token(as)}`, 'x-org-id': as.orgId },
    ...(body === undefined ? {} : { payload: body as object }),
  });
  // biome-ignore lint/suspicious/noExplicitAny: tests read bodies loosely
  return { status: r.statusCode, body: r.body ? (r.json() as any) : null };
}

async function signIn(userId: string, email: string) {
  const r = await app.inject({
    method: 'GET',
    url: '/v1/me',
    headers: { authorization: `Bearer ${await token({ userId, email })}` },
  });
  // biome-ignore lint/suspicious/noExplicitAny: tests read bodies loosely
  return r.json() as any;
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

const names = (rows: { name: string }[]) => rows.map((r) => r.name).sort();

beforeAll(async () => {
  t = await createTestDatabase();
  a = await seedOperator(t.ownerUrl, {
    name: 'Operator A',
    slug: 'operator-a',
    userEmail: 'admin-a@example.test',
  });
  const [u] = await owner<{ id: string }>(
    `insert into app.app_users (id, email) values (gen_random_uuid(), 'ops@example.test') returning id`,
  );
  await owner(`insert into app.memberships (organisation_id, user_id, role) values ($1, $2, 'operations')`, [
    a.orgId,
    u!.id,
  ]);
  ops = { orgId: a.orgId, userId: u!.id, email: 'ops@example.test' };
  const [o] = await owner<{ id: string }>(
    `insert into app.owners (organisation_id, name, fee_basis_points, notes) values ($1, 'Ellis', 2000, 'Pays late') returning id`,
    [a.orgId],
  );
  ellis = o!.id;
  for (const [name, ownerId] of [
    ['Lodge', ellis],
    ['Flat', null],
  ] as const) {
    const [p] = await owner<{ id: string }>(
      `insert into app.properties (organisation_id, name, country_code, max_guests, owner_id) values ($1, $2, 'GB', 4, $3) returning id`,
      [a.orgId, name, ownerId],
    );
    if (name === 'Lodge') lodge = p!.id;
    else flat = p!.id;
  }
  for (const [home, guest, checkIn, checkOut] of [
    [lodge, 'Ada Lodger', '2026-10-10', '2026-10-15'],
    [flat, 'Fay Flatter', '2026-10-20', '2026-10-24'],
  ] as const) {
    const [g] = await owner<{ id: string }>(
      `insert into app.guests (organisation_id, full_name, email) values ($1, $2, $3) returning id`,
      [a.orgId, guest, `${guest.split(' ')[0]?.toLowerCase()}@guest.test`],
    );
    await owner(
      `insert into app.reservations (organisation_id, property_id, guest_id, channel, status, check_in, check_out, adults, currency, total_minor)
       values ($1, $2, $3, 'airbnb', 'confirmed', $4, $5, 2, 'GBP', 50000)`,
      [a.orgId, home, g!.id, checkIn, checkOut],
    );
  }
  db = new ApiDatabase(t.apiUrl);
  app = await buildApp({
    env: loadEnv({ NODE_ENV: 'test', DATABASE_URL: t.apiUrl, SUPABASE_JWT_SECRET: JWT_SECRET }),
    db,
    verifyToken: createTokenVerifier({ jwtSecret: JWT_SECRET }),
    now: () => new Date('2026-11-01T10:00:00Z'),
  });
});

afterAll(async () => {
  await app?.close();
  await db?.close();
  await t?.drop();
});

describe('access by home', () => {
  it('sees every home until limited', async () => {
    expect(names((await call('GET', '/v1/properties', ops)).body.properties)).toEqual(['Flat', 'Lodge']);
  });

  it('limits a colleague to some homes, everywhere', async () => {
    const r = await call('PUT', `/v1/members/${ops.userId}/homes`, admin(), { propertyIds: [lodge] });
    expect(r.status).toBe(200);
    expect(r.body.propertyIds).toEqual([lodge]);

    expect(names((await call('GET', '/v1/properties', ops)).body.properties)).toEqual(['Lodge']);
    expect((await call('GET', `/v1/properties/${flat}`, ops)).status).toBe(404);
    const stays = (await call('GET', '/v1/reservations?view=past', ops)).body.reservations;
    expect(stays.map((s: { propertyId: string }) => s.propertyId)).toEqual([lodge]);
    const insights = (await call('GET', '/v1/insights?from=2026-10-01&to=2026-10-31', ops)).body;
    expect(insights.homes.map((h: { name: string }) => h.name)).toEqual(['Lodge']);
    expect(insights.totals.bookedNights).toBe(5);
    // Can't block the other home's nights.
    const block = await call('PATCH', '/v1/calendar', ops, {
      propertyIds: [flat],
      firstNight: '2026-12-01',
      lastNight: '2026-12-02',
      blocked: true,
    });
    expect(block.status).toBeGreaterThanOrEqual(400);
    // The admin still sees both, and the team list says who is limited.
    expect(names((await call('GET', '/v1/properties', admin())).body.properties)).toEqual(['Flat', 'Lodge']);
    const team = (await call('GET', '/v1/team', admin())).body.members;
    expect(team.find((m: { id: string }) => m.id === ops.userId).propertyIds).toEqual([lodge]);
  });

  it('refuses to limit an admin or name a home from elsewhere, and gives every home back', async () => {
    expect(
      (await call('PUT', `/v1/members/${a.userId}/homes`, admin(), { propertyIds: [lodge] })).status,
    ).toBe(400);
    const elsewhere = '00000000-0000-4000-8000-000000000000';
    expect(
      (await call('PUT', `/v1/members/${ops.userId}/homes`, admin(), { propertyIds: [elsewhere] })).status,
    ).toBe(400);
    expect((await call('PUT', `/v1/members/${ops.userId}/homes`, ops, { propertyIds: null })).status).toBe(
      403,
    );
    await call('PUT', `/v1/members/${ops.userId}/homes`, admin(), { propertyIds: null });
    expect(names((await call('GET', '/v1/properties', ops)).body.properties)).toEqual(['Flat', 'Lodge']);
  });

  it('limits someone from their invitation onwards', async () => {
    const r = await call('POST', '/v1/invitations', admin(), {
      email: 'cleaner@example.test',
      name: 'Cleo',
      role: 'guest_comms',
      propertyIds: [flat],
    });
    expect(r.status).toBe(201);
    expect(r.body.invitation.propertyIds).toEqual([flat]);
    const id = '11111111-1111-4111-8111-111111111111';
    const joined = await signIn(id, 'cleaner@example.test');
    expect(joined.memberships).toHaveLength(1);
    const cleo = { orgId: a.orgId, userId: id, email: 'cleaner@example.test' };
    expect(names((await call('GET', '/v1/properties', cleo)).body.properties)).toEqual(['Flat']);
  });
});

describe('the owner log-in', () => {
  const ownerUser = '22222222-2222-4222-8222-222222222222';
  const me = () => ({ orgId: a.orgId, userId: ownerUser, email: 'ellis@owner.test' });

  it('is given from the owner page and joins on first sign-in', async () => {
    const r = await call('POST', `/v1/owners/${ellis}/logins`, admin(), { email: 'Ellis@Owner.test' });
    expect(r.status).toBe(201);
    expect(r.body.invited.map((i: { email: string }) => i.email)).toEqual(['ellis@owner.test']);
    // Not in the team's invitations list.
    expect(
      (await call('GET', '/v1/invitations', admin())).body.invitations.map((i: { role: string }) => i.role),
    ).not.toContain('owner');
    const signed = await signIn(ownerUser, 'ellis@owner.test');
    expect(signed.memberships).toEqual([expect.objectContaining({ organisationId: a.orgId, role: 'owner' })]);
    const after = (await call('GET', '/v1/owners', admin())).body.owners[0];
    expect(after.logins).toEqual([{ userId: ownerUser, name: 'Ellis', email: 'ellis@owner.test' }]);
    expect(after.invited).toEqual([]);
    // Not offered for tasks.
    expect(
      (await call('GET', '/v1/team', admin())).body.members.map((m: { id: string }) => m.id),
    ).not.toContain(ownerUser);
  });

  it('refuses a team member’s address', async () => {
    expect(
      (await call('POST', `/v1/owners/${ellis}/logins`, admin(), { email: 'ops@example.test' })).status,
    ).toBe(409);
  });

  it('shows the owner their own homes and stays, with no guest details', async () => {
    const p = await call('GET', '/v1/portal', me());
    expect(p.status).toBe(200);
    expect(p.body.owner).toEqual({ name: 'Ellis', company: null });
    expect(p.body.homes.map((h: { name: string }) => h.name)).toEqual(['Lodge']);
    expect(p.body.statements).toEqual([]);
    const cal = await call('GET', '/v1/portal/calendar?from=2026-10-01&to=2026-10-31', me());
    expect(cal.body.stays).toEqual([
      {
        id: expect.any(String),
        propertyId: lodge,
        checkIn: '2026-10-10',
        checkOut: '2026-10-15',
        channel: 'airbnb',
      },
    ]);
    expect(JSON.stringify(cal.body)).not.toContain('Ada');
  });

  it('keeps every staff page closed to an owner', async () => {
    for (const url of [
      '/v1/properties',
      '/v1/reservations',
      '/v1/owners',
      '/v1/team',
      '/v1/insights?from=2026-10-01&to=2026-10-31',
    ]) {
      expect((await call('GET', url, me())).status, url).toBe(403);
    }
    expect((await call('GET', '/v1/portal', admin())).status).toBe(403);
  });

  it('shows a statement only once finalised, without the office’s notes', async () => {
    expect((await call('GET', '/v1/portal/statements/2026-10', me())).status).toBe(404);
    expect((await call('POST', `/v1/owners/${ellis}/statements`, admin(), { month: '2026-10' })).status).toBe(
      201,
    );
    const s = await call('GET', '/v1/portal/statements/2026-10', me());
    expect(s.status).toBe(200);
    expect(s.body.earnedMinor).toBe(50000);
    expect(s.body.owner.notes).toBeNull();
    expect(s.body.homes.map((h: { name: string }) => h.name)).toEqual(['Lodge']);
    expect((await call('GET', '/v1/portal', me())).body.statements).toMatchObject([
      { month: '2026-10', status: 'final', earnedMinor: 50000, feeMinor: 10000, netMinor: 40000 },
    ]);
  });

  it('follows the homes the owner owns, and ends when the log-in is removed', async () => {
    await owner('update app.properties set owner_id = $1 where id = $2', [ellis, flat]);
    expect((await call('GET', '/v1/portal', me())).body.homes.map((h: { name: string }) => h.name)).toEqual([
      'Flat',
      'Lodge',
    ]);
    const r = await call('DELETE', `/v1/owners/${ellis}/logins/${ownerUser}`, admin());
    expect(r.status).toBe(200);
    expect(r.body.logins).toEqual([]);
    expect((await call('GET', '/v1/portal', me())).status).toBe(403);
  });

  it('invites several owners at once, at the email on their record', async () => {
    const [none] = await owner<{ id: string }>(
      `insert into app.owners (organisation_id, name) values ($1, 'No Email') returning id`,
      [a.orgId],
    );
    await owner(`update app.owners set email = 'ellis@owner.test' where id = $1`, [ellis]);
    const r = await call('POST', '/v1/owner-logins', admin(), { ownerIds: [ellis, none!.id] });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      invited: 1,
      skipped: [{ name: 'No Email', reason: 'No email on their record.' }],
    });
    const again = await call('POST', '/v1/owner-logins', admin(), { ownerIds: [ellis] });
    expect(again.body).toEqual({ invited: 0, skipped: [{ name: 'Ellis', reason: 'Already invited.' }] });
  });
});
