import { ApiDatabase } from '@v01/db';
import { createTestDatabase, seedOperator, type TestDatabase } from '@v01/db/testing';
import { addDays, todayIn } from '@v01/shared';
import type { FastifyInstance } from 'fastify';
import { SignJWT } from 'jose';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { createTokenVerifier } from '../src/auth.ts';
import { loadEnv } from '../src/env.ts';
import { MemoryPhotoStore } from '../src/photos.ts';

/** Tasks: the office makes and assigns cleans and jobs; the field team sees theirs and ticks them off. */

const JWT_SECRET = 'test-only-jwt-secret-with-enough-length';

let t: TestDatabase;
let db: ApiDatabase;
let app: FastifyInstance;
let a: { orgId: string; userId: string };
let b: { orgId: string; userId: string };
const photos = new MemoryPhotoStore();
let crew: Who;
let crew2: Who;
let lodge: string;
const today = todayIn('Europe/London');
const day = (n: number) => addDays(today, n);

type Method = 'GET' | 'PATCH' | 'POST' | 'DELETE';
type Who = { userId: string; email: string; orgId: string };

async function call(
  method: Method,
  url: string,
  options: { as: Who; body?: unknown },
  // biome-ignore lint/suspicious/noExplicitAny: tests read response bodies loosely; the API's schemas type the real ones
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

const asA = (): Who => ({ ...a, email: 'admin-a@example.test' });
const asB = (): Who => ({ ...b, email: 'admin-b@example.test' });

async function member(role: string, email: string, name: string): Promise<Who> {
  const [user] = await owner<{ id: string }>(
    `insert into app.app_users (id, email, full_name) values (gen_random_uuid(), $1, $2) returning id`,
    [email, name],
  );
  await owner(`insert into app.memberships (organisation_id, user_id, role) values ($1, $2, $3)`, [
    a.orgId,
    user!.id,
    role,
  ]);
  return { orgId: a.orgId, userId: user!.id, email };
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
  crew = await member('field', 'sam@example.test', 'Sam Cleaner');
  crew2 = await member('field', 'jo@example.test', 'Jo Cleaner');
  db = new ApiDatabase(t.apiUrl);
  app = await buildApp({
    env: loadEnv({ NODE_ENV: 'test', DATABASE_URL: t.apiUrl, SUPABASE_JWT_SECRET: JWT_SECRET }),
    db,
    verifyToken: createTokenVerifier({ jwtSecret: JWT_SECRET }),
    photos,
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

describe('the team list', () => {
  it('names everyone, with emails for the office only', async () => {
    const office = (await call('GET', '/v1/team', { as: asA() })).body.members as {
      name: string;
      email: string;
    }[];
    expect(office.map((m) => m.name)).toEqual(['Jo Cleaner', 'Sam Cleaner', 'admin-a@example.test']);
    expect(office[0]?.email).toBe('jo@example.test');
    const field = (await call('GET', '/v1/team', { as: crew })).body.members as { email: string }[];
    expect(field.every((m) => m.email === '')).toBe(true);
  });
});

describe('making and working tasks', () => {
  let cleanId: string;
  let fixId: string;

  it('starts every workspace with a template per kind, and the clean switched on', async () => {
    const { body } = await call('GET', '/v1/task-templates', { as: asA() });
    expect(body.templates.map((x: { kind: string; automatic: boolean }) => [x.kind, x.automatic])).toEqual([
      ['cleaning', true],
      ['maintenance', false],
      ['inspection', false],
    ]);
    expect(body.templates[0].checklist.length).toBeGreaterThan(3);
  });

  it('lets the office make a task from the template, assigned and due', async () => {
    const made = await call('POST', '/v1/tasks', {
      as: asA(),
      body: { propertyId: lodge, kind: 'cleaning', dueOn: today, dueTime: '15:00', assigneeId: crew.userId },
    });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({
      title: 'Clean after check-out',
      status: 'open',
      dueOn: today,
      dueTime: '15:00',
      assignee: { id: crew.userId, name: 'Sam Cleaner' },
      propertyName: 'Harbour View Lodge',
      source: 'manual',
    });
    expect(made.body.checklist[0]).toEqual({ text: 'Strip and remake every bed', done: false });
    cleanId = made.body.id;

    const fix = await call('POST', '/v1/tasks', {
      as: asA(),
      body: {
        propertyId: lodge,
        kind: 'maintenance',
        title: 'Boiler not heating',
        notes: 'Guest reports no hot water.',
        dueOn: day(2),
        checklist: ['Check the pressure', 'Call the engineer if under 1 bar'],
      },
    });
    expect(fix.status).toBe(201);
    expect(fix.body.assignee).toBeNull();
    fixId = fix.body.id;

    expect(
      (
        await call('POST', '/v1/tasks', {
          as: crew,
          body: { propertyId: lodge, kind: 'cleaning', dueOn: today },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call('POST', '/v1/tasks', {
          as: asA(),
          body: { propertyId: lodge, kind: 'cleaning', dueOn: today, assigneeId: b.userId },
        })
      ).status,
    ).toBe(400);
  });

  it('shows today, upcoming and done, with counts for the tabs', async () => {
    const todayList = await call('GET', '/v1/tasks?view=today', { as: asA() });
    expect(todayList.body.tasks.map((x: { id: string }) => x.id)).toEqual([cleanId]);
    expect(todayList.body.counts).toEqual({ today: 1, upcoming: 1, open: 2 });
    const upcoming = await call('GET', '/v1/tasks?view=upcoming', { as: asA() });
    expect(upcoming.body.tasks.map((x: { id: string }) => x.id)).toEqual([fixId]);
    expect((await call('GET', '/v1/tasks?view=done', { as: asA() })).body.tasks).toEqual([]);
  });

  it('shows the field team their own jobs and the unassigned ones, never a colleague’s', async () => {
    const sam = await call('GET', '/v1/tasks?view=open', { as: crew });
    expect(sam.body.tasks.map((x: { id: string }) => x.id).sort()).toEqual([cleanId, fixId].sort());
    const jo = await call('GET', '/v1/tasks?view=open', { as: crew2 });
    expect(jo.body.tasks.map((x: { id: string }) => x.id)).toEqual([fixId]);
    expect((await call('GET', `/v1/tasks/${cleanId}`, { as: crew2 })).status).toBe(404);
    expect((await call('GET', `/v1/tasks/${cleanId}`, { as: asB() })).status).toBe(404);
  });

  it('lets the crew start, tick off and finish; a finished clean makes the property clean', async () => {
    await owner(`update app.properties set cleaning_status = 'dirty' where id = $1`, [lodge]);
    const started = await call('PATCH', `/v1/tasks/${cleanId}`, {
      as: crew,
      body: { status: 'in_progress' },
    });
    expect(started.status).toBe(200);
    expect(started.body.status).toBe('in_progress');
    const ticked = await call('PATCH', `/v1/tasks/${cleanId}`, {
      as: crew,
      body: {
        checklist: started.body.checklist.map((c: { text: string }, i: number) => ({ ...c, done: i === 0 })),
      },
    });
    expect(ticked.body.checklist[0].done).toBe(true);
    expect(ticked.body.checklist[1].done).toBe(false);
    // Not theirs to move or hand over.
    expect((await call('PATCH', `/v1/tasks/${cleanId}`, { as: crew, body: { dueOn: day(1) } })).status).toBe(
      403,
    );
    expect(
      (await call('PATCH', `/v1/tasks/${cleanId}`, { as: crew, body: { status: 'cancelled' } })).status,
    ).toBe(403);
    const done = await call('PATCH', `/v1/tasks/${cleanId}`, {
      as: crew,
      body: { status: 'done', notes: 'Left the heating on low.' },
    });
    expect(done.body).toMatchObject({
      status: 'done',
      doneBy: 'Sam Cleaner',
      notes: 'Left the heating on low.',
    });
    expect(done.body.doneAt).not.toBeNull();
    expect(done.body.checklist.every((c: { done: boolean }) => c.done)).toBe(true);
    const [property] = await owner<{ cleaning_status: string; by: string }>(
      'select cleaning_status, cleaning_changed_by as by from app.properties where id = $1',
      [lodge],
    );
    expect(property).toEqual({ cleaning_status: 'clean', by: crew.userId });
    expect(
      (await call('GET', '/v1/tasks?view=done', { as: asA() })).body.tasks.map((x: { id: string }) => x.id),
    ).toEqual([cleanId]);
  });

  it('gives an unassigned job to whoever on the crew starts it', async () => {
    const taken = await call('PATCH', `/v1/tasks/${fixId}`, { as: crew2, body: { status: 'in_progress' } });
    expect(taken.body.assignee).toEqual({ id: crew2.userId, name: 'Jo Cleaner' });
    // Sam no longer sees it; Jo does; the office can hand it back.
    expect((await call('GET', `/v1/tasks/${fixId}`, { as: crew })).status).toBe(404);
    const moved = await call('PATCH', `/v1/tasks/${fixId}`, {
      as: asA(),
      body: { assigneeId: crew.userId, dueOn: day(3) },
    });
    expect(moved.body).toMatchObject({ assignee: { name: 'Sam Cleaner' }, dueOn: day(3) });
  });

  it('lets an admin change a kind’s template, and switch the automatic clean off', async () => {
    const changed = await call('PATCH', '/v1/task-templates/cleaning', {
      as: asA(),
      body: { checklist: ['Beds', 'Bathrooms', 'Kitchen', 'Floors'], automatic: false },
    });
    expect(changed.body).toMatchObject({
      kind: 'cleaning',
      automatic: false,
      checklist: ['Beds', 'Bathrooms', 'Kitchen', 'Floors'],
    });
    expect(
      (await call('PATCH', '/v1/task-templates/cleaning', { as: crew, body: { automatic: true } })).status,
    ).toBe(403);
    const next = await call('POST', '/v1/tasks', {
      as: asA(),
      body: { propertyId: lodge, kind: 'cleaning', dueOn: day(1) },
    });
    expect(next.body.checklist.map((c: { text: string }) => c.text)).toEqual([
      'Beds',
      'Bathrooms',
      'Kitchen',
      'Floors',
    ]);
  });

  it('lets the crew add photos to their job, and the office or the taker remove them', async () => {
    // Sam has the job back (the office moved it above). A ticket, the upload, then the register.
    const ticket = await call('POST', `/v1/tasks/${fixId}/photos/uploads`, {
      as: crew,
      body: { contentType: 'image/jpeg', bytes: 120_000 },
    });
    expect(ticket.status).toBe(200);
    expect(ticket.body.path).toMatch(new RegExp(`^${a.orgId}/tasks/${fixId}/`));
    // Registering before the upload lands is refused; after it, the photo is on the task.
    const early = await call('POST', `/v1/tasks/${fixId}/photos`, {
      as: crew,
      body: { path: ticket.body.path, width: 1600, height: 1200 },
    });
    expect(early.status).toBe(409);
    photos.files.add(ticket.body.path);
    const added = await call('POST', `/v1/tasks/${fixId}/photos`, {
      as: crew,
      body: { path: ticket.body.path, width: 1600, height: 1200 },
    });
    expect(added.status).toBe(201);
    expect(added.body.photos).toEqual([
      expect.objectContaining({ width: 1600, height: 1200, takenBy: 'Sam Cleaner' }),
    ]);
    const photoId = added.body.photos[0].id as string;
    // Jo can't see the job, so can't touch its photo; the office can.
    expect((await call('DELETE', `/v1/tasks/${fixId}/photos/${photoId}`, { as: crew2 })).status).toBe(404);
    const removed = await call('DELETE', `/v1/tasks/${fixId}/photos/${photoId}`, { as: asA() });
    expect(removed.status).toBe(200);
    expect(removed.body.photos).toEqual([]);
    expect(photos.files.has(ticket.body.path)).toBe(false);
  });

  it('lets the crew report damage from a job: a maintenance task for the office, on the same property', async () => {
    const report = await call('POST', `/v1/tasks/${fixId}/report`, {
      as: crew,
      body: { what: 'The shower screen is cracked along the bottom edge.' },
    });
    expect(report.status).toBe(201);
    expect(report.body).toMatchObject({
      kind: 'maintenance',
      source: 'report',
      title: 'Damage reported',
      notes: 'The shower screen is cracked along the bottom edge.',
      propertyId: lodge,
      status: 'open',
      assignee: null,
    });
    // It shows in the office's open list, unassigned, for them to give to someone.
    const open = await call('GET', '/v1/tasks?view=open', { as: asA() });
    expect((open.body.tasks as { id: string }[]).some((x) => x.id === report.body.id)).toBe(true);
  });

  it('keeps one operator’s tasks out of another’s workspace', async () => {
    expect((await call('GET', '/v1/tasks?view=open', { as: asB() })).body.tasks).toEqual([]);
    expect((await call('PATCH', `/v1/tasks/${fixId}`, { as: asB(), body: { status: 'done' } })).status).toBe(
      404,
    );
  });
});
