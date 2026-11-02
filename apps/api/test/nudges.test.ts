import { ApiDatabase } from '@v01/db';
import { createTestDatabase, seedOperator, type TestDatabase } from '@v01/db/testing';
import { MemorySlack } from '@v01/integrations';
import { addDays, todayIn } from '@v01/shared';
import type { FastifyInstance } from 'fastify';
import { SignJWT } from 'jose';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { createTokenVerifier } from '../src/auth.ts';
import { loadEnv } from '../src/env.ts';

/** Slack messages about jobs: the moment a job is given to someone, once, and never to yourself. */

const JWT_SECRET = 'test-only-jwt-secret-with-enough-length';
let t: TestDatabase;
let db: ApiDatabase;
let app: FastifyInstance;
let offApp: FastifyInstance;
let a: { orgId: string; userId: string };
let home: string;
let cleaner: string;
let other: string;
const slack = new MemorySlack({ 'cleaner@example.test': 'U_CLEAN', 'admin-a@example.test': 'U_ADMIN' });
const today = todayIn('Europe/London');

async function call(
  method: 'GET' | 'POST' | 'PATCH',
  url: string,
  options: { body?: unknown; on?: FastifyInstance } = {},
  // biome-ignore lint/suspicious/noExplicitAny: tests read response bodies loosely
): Promise<{ status: number; body: Record<string, any> }> {
  const jwt = await new SignJWT({ email: 'admin-a@example.test', role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(a.userId)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const response = await (options.on ?? app).inject({
    method,
    url,
    headers: { authorization: `Bearer ${jwt}`, 'x-org-id': a.orgId },
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

/** The message goes after the reply; wait a moment for it. */
async function settled(count: number) {
  for (let i = 0; i < 50 && slack.sent.length < count; i += 1) await new Promise((r) => setTimeout(r, 20));
}

async function fieldMember(email: string): Promise<string> {
  const [u] = await owner<{ id: string }>(
    'insert into app.app_users (id, email) values (gen_random_uuid(), $1) returning id',
    [email],
  );
  await owner(
    `insert into app.memberships (organisation_id, user_id, role, skills) values ($1, $2, 'field', array['cleaning'])`,
    [a.orgId, u!.id],
  );
  return u!.id;
}

beforeAll(async () => {
  t = await createTestDatabase();
  a = await seedOperator(t.ownerUrl, { name: 'A', slug: 'a', userEmail: 'admin-a@example.test' });
  db = new ApiDatabase(t.apiUrl);
  const env = loadEnv({ NODE_ENV: 'test', DATABASE_URL: t.apiUrl, SUPABASE_JWT_SECRET: JWT_SECRET });
  const verifyToken = createTokenVerifier({ jwtSecret: JWT_SECRET });
  app = await buildApp({ env, db, verifyToken, slack });
  offApp = await buildApp({ env, db, verifyToken, slack: null });
  home = (
    await call('POST', '/v1/properties', {
      body: { name: 'Harbour View Lodge', countryCode: 'GB', maxGuests: 4 },
    })
  ).body.id;
  cleaner = await fieldMember('cleaner@example.test');
  other = await fieldMember('nobody-on-slack@example.test');
});

afterAll(async () => {
  await app?.close();
  await offApp?.close();
  await db?.close();
  await t?.drop();
});

describe('Slack messages about jobs', () => {
  it('tells the person a job is given to, once', async () => {
    const made = await call('POST', '/v1/tasks', {
      body: {
        propertyId: home,
        kind: 'cleaning',
        dueOn: addDays(today, 1),
        dueTime: '15:00',
        assigneeId: cleaner,
      },
    });
    expect(made.status).toBe(201);
    await settled(1);
    expect(slack.sent).toHaveLength(1);
    expect(slack.sent[0]).toMatchObject({ userId: 'U_CLEAN' });
    expect(slack.sent[0]!.text).toContain('New job for you. Clean at Harbour View Lodge');
    expect(slack.sent[0]!.text).toContain(`/tasks?task=${made.body.id}`);
    // Saving the job again doesn't send it again.
    await call('PATCH', `/v1/tasks/${made.body.id}`, { body: { notes: 'Key in the safe' } });
    await new Promise((r) => setTimeout(r, 100));
    expect(slack.sent).toHaveLength(1);
    const [n] = await owner<{ kind: string; sent: boolean }>(
      'select kind, sent_at is not null as sent from app.task_nudges where task_id = $1',
      [made.body.id],
    );
    expect(n).toEqual({ kind: 'assigned', sent: true });
  });

  it('records someone not on Slack, and never messages you about your own job', async () => {
    const before = slack.sent.length;
    const made = await call('POST', '/v1/tasks', {
      body: { propertyId: home, kind: 'cleaning', dueOn: addDays(today, 2), assigneeId: other },
    });
    await new Promise((r) => setTimeout(r, 150));
    expect(slack.sent).toHaveLength(before);
    const [n] = await owner<{ error: string | null }>(
      'select error from app.task_nudges where task_id = $1',
      [made.body.id],
    );
    expect(n!.error).toContain('Not found on Slack');
    const mine = await call('POST', '/v1/tasks', {
      body: { propertyId: home, kind: 'inspection', dueOn: addDays(today, 2), assigneeId: a.userId },
    });
    expect(mine.status).toBe(201);
    await new Promise((r) => setTimeout(r, 150));
    expect(slack.sent).toHaveLength(before);
  });

  it('says whether Slack is connected, and sends a test message', async () => {
    expect((await call('GET', '/v1/workspace/slack', { on: offApp })).body).toMatchObject({
      connected: false,
    });
    expect((await call('GET', '/v1/workspace/slack')).body).toMatchObject({
      connected: true,
      team: 'Test Slack',
    });
    const before = slack.sent.length;
    expect((await call('POST', '/v1/workspace/slack/test')).status).toBe(200);
    expect(slack.sent.at(-1)).toMatchObject({ userId: 'U_ADMIN' });
    expect(slack.sent).toHaveLength(before + 1);
  });
});
