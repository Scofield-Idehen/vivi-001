import { ApiDatabase } from '@v01/db';
import { createTestDatabase, seedOperator, type TestDatabase } from '@v01/db/testing';
import type { FastifyInstance } from 'fastify';
import { SignJWT } from 'jose';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { createTokenVerifier } from '../src/auth.ts';
import { loadEnv } from '../src/env.ts';
import type { InviteMailer } from '../src/invites.ts';

/** The team: invitations become memberships on first sign-in; the last admin stays. */

const JWT_SECRET = 'test-only-jwt-secret-with-enough-length';

let t: TestDatabase;
let db: ApiDatabase;
let app: FastifyInstance;
let a: { orgId: string; userId: string };
let b: { orgId: string; userId: string };
const sent: { email: string; redirectTo: string }[] = [];
const mailer: InviteMailer = {
  async send(email, redirectTo) {
    sent.push({ email, redirectTo });
    return email.startsWith('old') ? 'existing' : 'invited';
  },
};

type Who = { userId: string; email: string; orgId: string };

async function call(
  method: 'GET' | 'PATCH' | 'POST' | 'DELETE',
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
  return { status: response.statusCode, body: response.statusCode === 204 ? {} : response.json() };
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

const asA = (): Who => ({ ...a, email: 'admin-a@example.test' });
const asB = (): Who => ({ ...b, email: 'admin-b@example.test' });

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
  db = new ApiDatabase(t.apiUrl);
  app = await buildApp({
    env: loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: t.apiUrl,
      SUPABASE_JWT_SECRET: JWT_SECRET,
      CORS_ORIGINS: 'https://v01-staging.web.app, http://localhost:5173',
    }),
    db,
    verifyToken: createTokenVerifier({ jwtSecret: JWT_SECRET }),
    mailer,
  });
});

afterAll(async () => {
  await app?.close();
  await db?.close();
  await t?.drop();
});

describe('inviting a colleague', () => {
  let ops: Who;

  it('records the invitation and sends the email to the app’s address', async () => {
    const { status, body } = await call('POST', '/v1/invitations', {
      as: asA(),
      body: { email: 'Sam.Ops@Example.test', name: 'Sam Okoro', role: 'operations' },
    });
    expect(status).toBe(201);
    expect(body.email).toBe('invited');
    expect(body.invitation).toMatchObject({
      email: 'sam.ops@example.test',
      name: 'Sam Okoro',
      role: 'operations',
      invitedBy: 'admin-a@example.test',
    });
    expect(body.invitation.expiresAt).not.toBeNull();
    expect(sent).toEqual([{ email: 'sam.ops@example.test', redirectTo: 'https://v01-staging.web.app/' }]);
    const list = await call('GET', '/v1/invitations', { as: asA() });
    expect(list.body.invitations.map((i: { email: string }) => i.email)).toEqual(['sam.ops@example.test']);
  });

  it('becomes a membership the first time that email signs in', async () => {
    ops = { userId: '7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f', email: 'sam.ops@example.test', orgId: a.orgId };
    const me = await call('GET', '/v1/me', { as: ops });
    expect(me.body.memberships).toEqual([
      { organisationId: a.orgId, organisationName: 'Operator A', role: 'operations' },
    ]);
    expect((await call('GET', '/v1/invitations', { as: asA() })).body.invitations).toEqual([]);
    const team = await call('GET', '/v1/team', { as: asA() });
    // The name the admin gave is theirs from the first sign-in.
    expect(
      team.body.members.map((m: { name: string; email: string; role: string }) => [m.name, m.email, m.role]),
    ).toEqual([
      ['Sam Okoro', 'sam.ops@example.test', 'operations'],
      ['admin-a@example.test', 'admin-a@example.test', 'admin'],
    ]);
    // People name themselves; admins correct a colleague's.
    expect(
      (await call('PATCH', '/v1/me', { as: asA(), body: { fullName: 'Ada Admin' } })).body.fullName,
    ).toBe('Ada Admin');
    const renamed = await call('PATCH', `/v1/members/${ops.userId}`, {
      as: asA(),
      body: { name: 'Samuel Okoro' },
    });
    expect(renamed.body.name).toBe('Samuel Okoro');
    expect(
      (await call('PATCH', `/v1/members/${ops.userId}`, { as: asB(), body: { name: 'Nope' } })).status,
    ).toBe(404);
  });

  it('refuses an email already in the team, and renews an open invitation instead of doubling it', async () => {
    const dup = await call('POST', '/v1/invitations', {
      as: asA(),
      body: { email: 'sam.ops@example.test', name: 'Sam', role: 'admin' },
    });
    expect(dup.status).toBe(409);
    await call('POST', '/v1/invitations', {
      as: asA(),
      body: { email: 'old.hand@example.test', name: 'Old Hand', role: 'accounts' },
    });
    const again = await call('POST', '/v1/invitations', {
      as: asA(),
      body: { email: 'old.hand@example.test', name: 'Old Hand', role: 'field' },
    });
    expect(again.body.email).toBe('existing');
    const list = await call('GET', '/v1/invitations', { as: asA() });
    expect(list.body.invitations.map((i: { email: string; role: string }) => [i.email, i.role])).toEqual([
      ['old.hand@example.test', 'field'],
    ]);
    expect((await call('DELETE', `/v1/invitations/${again.body.invitation.id}`, { as: asA() })).status).toBe(
      204,
    );
    expect((await call('GET', '/v1/invitations', { as: asA() })).body.invitations).toEqual([]);
  });

  it('changes roles and removes people, but never the last admin, and never oneself', async () => {
    const promoted = await call('PATCH', `/v1/members/${ops.userId}`, { as: asA(), body: { role: 'admin' } });
    expect(promoted.body.role).toBe('admin');
    expect(
      (await call('PATCH', `/v1/members/${a.userId}`, { as: asA(), body: { role: 'field' } })).body.error
        .code,
    ).toBe('own_role');
    // Two admins now: Sam may step A down; then A is the only non-admin and Sam the last admin.
    const stepped = await call('PATCH', `/v1/members/${a.userId}`, {
      as: { ...ops, orgId: a.orgId },
      body: { role: 'operations' },
    });
    expect(stepped.body.role).toBe('operations');
    expect(
      (await call('PATCH', `/v1/members/${ops.userId}`, { as: asA(), body: { role: 'field' } })).status,
    ).toBe(403);
    const last = await call('DELETE', `/v1/members/${ops.userId}`, { as: { ...ops }, body: undefined });
    expect(last.body.error.code).toBe('own_membership');
    // Put A back as admin, then Sam can be removed.
    await owner(`update app.memberships set role = 'admin' where organisation_id = $1 and user_id = $2`, [
      a.orgId,
      a.userId,
    ]);
    expect((await call('DELETE', `/v1/members/${ops.userId}`, { as: asA() })).status).toBe(204);
    expect((await call('GET', '/v1/team', { as: asA() })).body.members).toHaveLength(1);
    expect((await call('DELETE', `/v1/members/${a.userId}`, { as: asA() })).body.error.code).toBe(
      'own_membership',
    );
  });

  it('keeps other operators out', async () => {
    expect((await call('GET', '/v1/invitations', { as: asB() })).body.invitations).toEqual([]);
    expect(
      (await call('PATCH', `/v1/members/${a.userId}`, { as: asB(), body: { role: 'field' } })).status,
    ).toBe(404);
  });
});
