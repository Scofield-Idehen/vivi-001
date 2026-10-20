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

/**
 * The Inbox: one thread per booking, made with it; the team's replies queue for the worker; the
 * guest's messages (here written straight into the table, as Channex or the email sender would)
 * count as unread and waiting until someone replies.
 */

const JWT_SECRET = 'test-only-jwt-secret-with-enough-length';

let t: TestDatabase;
let db: ApiDatabase;
let app: FastifyInstance;
let a: { orgId: string; userId: string };
let b: { orgId: string; userId: string };
let accounts: Who;
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

async function member(role: string, email: string): Promise<Who> {
  const [user] = await owner<{ id: string }>(
    `insert into app.app_users (id, email) values (gen_random_uuid(), $1) returning id`,
    [email],
  );
  await owner(`insert into app.memberships (organisation_id, user_id, role) values ($1, $2, $3)`, [
    a.orgId,
    user!.id,
    role,
  ]);
  return { orgId: a.orgId, userId: user!.id, email };
}

/** A message from the guest, as the worker would store one that arrived through Channex. */
async function guestWrote(threadId: string, via: string, body: string) {
  await owner(
    `insert into app.messages (organisation_id, thread_id, direction, via, body, status, external_id)
     values ($1, $2, 'in', $3, $4, 'received', gen_random_uuid()::text)`,
    [a.orgId, threadId, via, body],
  );
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
  accounts = await member('accounts', 'money@example.test');
  db = new ApiDatabase(t.apiUrl);
  app = await buildApp({
    env: loadEnv({ NODE_ENV: 'test', DATABASE_URL: t.apiUrl, SUPABASE_JWT_SECRET: JWT_SECRET }),
    db,
    verifyToken: createTokenVerifier({ jwtSecret: JWT_SECRET }),
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

describe('threads', () => {
  let direct: string;
  let directThread: string;
  let airbnb: string;
  let airbnbThread: string;

  it('exist for every booking from the moment it is made, with the way to reach the guest', async () => {
    direct = (
      await call('POST', '/v1/reservations', {
        as: asA(),
        body: {
          propertyId: lodge,
          checkIn: day(10),
          checkOut: day(13),
          guestName: 'Mia Direct',
          guestEmail: 'mia@guest.example',
          guestPhone: '+44 7700 900900',
        },
      })
    ).body.id;
    const { status, body } = await call('GET', `/v1/reservations/${direct}/thread`, { as: asA() });
    expect(status).toBe(200);
    expect(body.guestName).toBe('Mia Direct');
    expect(body.via).toBe('email');
    expect(body.lastMessage).toBeNull();
    expect(body.unread).toBe(0);
    directThread = body.id;

    // An Airbnb booking, as the booking import makes one: replies go to the Airbnb chat.
    const [g] = await owner<{ id: string }>(
      `insert into app.guests (organisation_id, full_name) values ($1, 'Noah Air') returning id`,
      [a.orgId],
    );
    const [r] = await owner<{ id: string }>(
      `insert into app.reservations (organisation_id, property_id, channel, channel_reference, status, check_in, check_out, guest_id, adults)
       values ($1, $2, 'airbnb', 'HMABC123', 'confirmed', $3, $4, $5, 2) returning id`,
      [a.orgId, lodge, day(20), day(23), g!.id],
    );
    airbnb = r!.id;
    const air = await call('GET', `/v1/reservations/${airbnb}/thread`, { as: asA() });
    expect(air.body.via).toBe('airbnb');
    airbnbThread = air.body.id;
  });

  it('is empty until someone writes; a guest’s message counts as unread and waiting', async () => {
    const quiet = await call('GET', '/v1/inbox/threads', { as: asA() });
    expect(quiet.body.threads).toEqual([]);
    expect(quiet.body.counts).toEqual({ awaiting: 0, open: 0 });

    await guestWrote(airbnbThread, 'airbnb', 'Hi! Is there parking at the lodge?');
    const list = await call('GET', '/v1/inbox/threads', { as: asA() });
    expect(list.body.threads.map((x: { id: string }) => x.id)).toEqual([airbnbThread]);
    const [thread] = list.body.threads;
    expect(thread.unread).toBe(1);
    expect(thread.awaitingSince).not.toBeNull();
    expect(thread.lastMessage).toMatchObject({ direction: 'in', body: 'Hi! Is there parking at the lodge?' });
    expect(list.body.counts).toEqual({ awaiting: 1, open: 1 });
    const awaiting = await call('GET', '/v1/inbox/threads?view=awaiting', { as: asA() });
    expect(awaiting.body.threads).toHaveLength(1);
    // Everyone's threads are in "all", words or none.
    const all = await call('GET', '/v1/inbox/threads?view=all', { as: asA() });
    expect(all.body.threads).toHaveLength(2);
  });

  it('queues a reply for the worker, by the guest’s own chat, and clears the wait', async () => {
    const { status, body } = await call('POST', `/v1/inbox/threads/${airbnbThread}/messages`, {
      as: asA(),
      body: { body: 'Yes, there is a space by the door, free for guests.' },
    });
    expect(status).toBe(201);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[1]).toMatchObject({
      direction: 'out',
      via: 'airbnb',
      status: 'queued',
      sentBy: 'admin-a@example.test',
      automatic: false,
    });
    expect(body.thread.unread).toBe(0);
    expect(body.thread.awaitingSince).toBeNull();
    const counts = (await call('GET', '/v1/inbox/threads', { as: asA() })).body.counts;
    expect(counts).toEqual({ awaiting: 0, open: 1 });
  });

  it('writes to a direct guest by email, or by text when asked and there is a number', async () => {
    const email = await call('POST', `/v1/inbox/threads/${directThread}/messages`, {
      as: asA(),
      body: { body: 'Looking forward to having you.' },
    });
    expect(email.body.messages[0].via).toBe('email');
    const text = await call('POST', `/v1/inbox/threads/${directThread}/messages`, {
      as: asA(),
      body: { body: 'Your code is on your page.', via: 'sms' },
    });
    expect(text.body.messages[1].via).toBe('sms');
  });

  it('refuses to write to a guest with no email or phone', async () => {
    const id = (
      await call('POST', '/v1/reservations', {
        as: asA(),
        body: { propertyId: lodge, checkIn: day(30), checkOut: day(31), guestName: 'No Contact' },
      })
    ).body.id;
    const thread = (await call('GET', `/v1/reservations/${id}/thread`, { as: asA() })).body;
    expect(thread.via).toBeNull();
    const { status, body } = await call('POST', `/v1/inbox/threads/${thread.id}/messages`, {
      as: asA(),
      body: { body: 'Hello?' },
    });
    expect(status).toBe(400);
    expect(body.error.code).toBe('no_way_to_reach');
  });

  it('marks a thread done, and a new word from the guest opens it again', async () => {
    const done = await call('PATCH', `/v1/inbox/threads/${airbnbThread}`, {
      as: asA(),
      body: { status: 'done' },
    });
    expect(done.body.status).toBe('done');
    expect(
      (await call('GET', '/v1/inbox/threads', { as: asA() })).body.threads.map((x: { id: string }) => x.id),
    ).toEqual([directThread]);
    await guestWrote(airbnbThread, 'airbnb', 'One more thing: can we arrive at 13:00?');
    const detail = await call('GET', `/v1/inbox/threads/${airbnbThread}`, { as: asA() });
    expect(detail.body.thread.status).toBe('open');
    expect(detail.body.thread.unread).toBe(1);
    expect(detail.body.messages).toHaveLength(3);
    // Opening it counts the guest's messages as read.
    const read = await call('PATCH', `/v1/inbox/threads/${airbnbThread}`, {
      as: asA(),
      body: { read: true },
    });
    expect(read.body.unread).toBe(0);
    expect(read.body.awaitingSince).not.toBeNull();
  });

  it('finds a thread by the guest, the property or the booking code', async () => {
    const byCode = await call('GET', '/v1/inbox/threads?view=all&q=HMABC', { as: asA() });
    expect(byCode.body.threads.map((x: { guestName: string }) => x.guestName)).toEqual(['Noah Air']);
    const byName = await call('GET', '/v1/inbox/threads?view=all&q=mia', { as: asA() });
    expect(byName.body.threads.map((x: { guestName: string }) => x.guestName)).toEqual(['Mia Direct']);
  });

  it('shows the wait on Today', async () => {
    const { body } = await call('GET', '/v1/today', { as: asA() });
    const item = body.attention.find((x: { id: string }) => x.id === 'inbox:awaiting');
    expect(item).toMatchObject({
      severity: 'warning',
      title: 'A guest is waiting for a reply',
      to: '/inbox',
    });
  });

  it('keeps the guest waiting through an automatic message; only a person’s reply answers', async () => {
    const [tpl] = await owner<{ id: string }>(
      `select id from app.message_templates where organisation_id = $1 and trigger = 'before_arrival'`,
      [a.orgId],
    );
    await owner(
      `insert into app.messages (organisation_id, thread_id, direction, via, body, status, template_id, automatic)
       values ($1, $2, 'out', 'airbnb', 'You arrive tomorrow.', 'queued', $3, true)`,
      [a.orgId, airbnbThread, tpl!.id],
    );
    const still = await call('GET', `/v1/inbox/threads/${airbnbThread}`, { as: asA() });
    expect(still.body.thread.awaitingSince).not.toBeNull();
    expect(still.body.messages.at(-1)).toMatchObject({
      automatic: true,
      templateName: 'The day before arrival',
    });
    await call('POST', `/v1/inbox/threads/${airbnbThread}/messages`, {
      as: asA(),
      body: { body: '13:00 is fine.' },
    });
    const answered = await call('GET', `/v1/inbox/threads/${airbnbThread}`, { as: asA() });
    expect(answered.body.thread.awaitingSince).toBeNull();
  });

  it('keeps accounts reading and other operators out', async () => {
    expect((await call('GET', '/v1/inbox/threads?view=all', { as: accounts })).status).toBe(200);
    const write = await call('POST', `/v1/inbox/threads/${airbnbThread}/messages`, {
      as: accounts,
      body: { body: 'Pay up.' },
    });
    expect(write.status).toBe(403);
    expect((await call('GET', `/v1/inbox/threads/${airbnbThread}`, { as: asB() })).status).toBe(404);
    expect((await call('GET', '/v1/inbox/threads?view=all', { as: asB() })).body.threads).toEqual([]);
  });
});

describe('templates', () => {
  it('starts every workspace with the four automatic messages', async () => {
    const { body } = await call('GET', '/v1/inbox/templates', { as: asA() });
    expect(
      body.templates.map((x: { trigger: string; enabled: boolean; sendTime: string | null }) => [
        x.trigger,
        x.enabled,
        x.sendTime,
      ]),
    ).toEqual([
      ['booking_confirmed', true, null],
      ['before_arrival', true, '10:00'],
      ['arrival_day', false, '09:00'],
      ['before_departure', true, '17:00'],
    ]);
    expect(body.templates[1].body).toContain('{{stay_link}}');
  });

  it('changes the words and the time, switches one off, and never removes an automatic one', async () => {
    const list = (await call('GET', '/v1/inbox/templates', { as: asA() })).body.templates;
    const before = list.find((x: { trigger: string }) => x.trigger === 'before_arrival');
    const changed = await call('PATCH', `/v1/inbox/templates/${before.id}`, {
      as: asA(),
      body: { body: 'See you tomorrow, {{guest_first_name}}.', sendTime: '11:30', enabled: false },
    });
    expect(changed.status).toBe(200);
    expect(changed.body).toMatchObject({
      body: 'See you tomorrow, {{guest_first_name}}.',
      sendTime: '11:30',
      enabled: false,
    });
    const gone = await call('DELETE', `/v1/inbox/templates/${before.id}`, { as: asA() });
    expect(gone.status).toBe(400);
    const moved = await call('PATCH', `/v1/inbox/templates/${before.id}`, {
      as: asA(),
      body: { trigger: 'manual' },
    });
    expect(moved.status).toBe(400);
  });

  it('keeps saved replies, as many as the team wants, and removes them', async () => {
    const made = await call('POST', '/v1/inbox/templates', {
      as: asA(),
      body: { name: 'Parking', trigger: 'manual', body: 'There is a space by the door, free for guests.' },
    });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ trigger: 'manual', sendTime: null, enabled: true, position: 5 });
    const second = await call('POST', '/v1/inbox/templates', {
      as: asA(),
      body: {
        name: 'Early arrival',
        trigger: 'manual',
        body: 'We can usually manage an early arrival; we confirm the day before.',
      },
    });
    expect(second.status).toBe(201);
    const again = await call('POST', '/v1/inbox/templates', {
      as: asA(),
      body: { name: 'Another confirmation', trigger: 'booking_confirmed', body: 'x' },
    });
    expect(again.status).toBe(409);
    expect((await call('DELETE', `/v1/inbox/templates/${made.body.id}`, { as: asA() })).status).toBe(204);
    const names = (await call('GET', '/v1/inbox/templates', { as: asA() })).body.templates.map(
      (x: { name: string }) => x.name,
    );
    expect(names).toContain('Early arrival');
    expect(names).not.toContain('Parking');
    expect(
      (
        await call('POST', '/v1/inbox/templates', {
          as: accounts,
          body: { name: 'x', trigger: 'manual', body: 'x' },
        })
      ).status,
    ).toBe(403);
  });
});
