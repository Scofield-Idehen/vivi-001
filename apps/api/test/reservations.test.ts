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

/** Bookings: the Reservations list, one booking's page, and what the team may change on it. */

const JWT_SECRET = 'test-only-jwt-secret-with-enough-length';

let t: TestDatabase;
let db: ApiDatabase;
let app: FastifyInstance;
let a: { orgId: string; userId: string };
let b: { orgId: string; userId: string };
const members: Record<'comms' | 'accounts' | 'field', { orgId: string; userId: string }> = {} as never;
const ids: Record<'staying' | 'coming' | 'past' | 'cancelled' | 'overlap' | 'other', string> = {} as never;
let lodge: string;
const today = todayIn('Europe/London');
const day = (n: number) => addDays(today, n);

type Method = 'GET' | 'PATCH' | 'POST';
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
const as = (role: keyof typeof members): Who => ({ ...members[role], email: `${role}@example.test` });

async function member(role: 'guest_comms' | 'accounts' | 'field', email: string) {
  const [user] = await owner<{ id: string }>(
    `insert into app.app_users (id, email) values (gen_random_uuid(), $1) returning id`,
    [email],
  );
  await owner(`insert into app.memberships (organisation_id, user_id, role) values ($1, $2, $3)`, [
    a.orgId,
    user!.id,
    role,
  ]);
  return { orgId: a.orgId, userId: user!.id };
}

async function booking(
  orgId: string,
  propertyId: string,
  stay: {
    channel: string;
    reference: string | null;
    status: string;
    from: number;
    to: number;
    guest?: { name: string; email?: string };
  },
): Promise<string> {
  let guestId: string | null = null;
  if (stay.guest) {
    const [guest] = await owner<{ id: string }>(
      `insert into app.guests (organisation_id, full_name, email) values ($1, $2, $3) returning id`,
      [orgId, stay.guest.name, stay.guest.email ?? null],
    );
    guestId = guest!.id;
  }
  const [row] = await owner<{ id: string }>(
    `insert into app.reservations (organisation_id, property_id, channel, channel_reference, status,
       check_in, check_out, adults, children, guest_id, currency, total_minor, cancelled_at)
     values ($1, $2, $3, $4, $5, $6, $7, 2, 1, $8, 'GBP', 45000, case when $9 then now() end)
     returning id`,
    [
      orgId,
      propertyId,
      stay.channel,
      stay.reference,
      stay.status,
      day(stay.from),
      day(stay.to),
      guestId,
      stay.status === 'cancelled',
    ],
  );
  return row!.id;
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
  members.comms = await member('guest_comms', 'comms@example.test');
  members.accounts = await member('accounts', 'accounts@example.test');
  members.field = await member('field', 'field@example.test');
  db = new ApiDatabase(t.apiUrl);
  app = await buildApp({
    env: loadEnv({ NODE_ENV: 'test', DATABASE_URL: t.apiUrl, SUPABASE_JWT_SECRET: JWT_SECRET }),
    db,
    verifyToken: createTokenVerifier({ jwtSecret: JWT_SECRET }),
  });

  lodge = (
    await call('POST', '/v1/properties', {
      as: asA(),
      body: { name: 'Harbour View Lodge', countryCode: 'GB', maxGuests: 6, checkInTime: '16:00' },
    })
  ).body.id;
  const theirs = (
    await call('POST', '/v1/properties', {
      as: asB(),
      body: { name: 'Their Cottage', countryCode: 'GB', maxGuests: 4 },
    })
  ).body.id;

  ids.staying = await booking(a.orgId, lodge, {
    channel: 'airbnb',
    reference: 'HMSTAY0001',
    status: 'confirmed',
    from: -1,
    to: 2,
    guest: { name: 'Hannah Lee' },
  });
  ids.coming = await booking(a.orgId, lodge, {
    channel: 'booking_com',
    reference: '4311850297',
    status: 'confirmed',
    from: 10,
    to: 13,
    guest: { name: 'Ravi Kumar', email: 'ravi@guest.example' },
  });
  ids.past = await booking(a.orgId, lodge, {
    channel: 'direct',
    reference: null,
    status: 'confirmed',
    from: -20,
    to: -17,
    guest: { name: 'Owen Price' },
  });
  ids.cancelled = await booking(a.orgId, lodge, {
    channel: 'airbnb',
    reference: 'HMCANC0001',
    status: 'cancelled',
    from: 30,
    to: 32,
    guest: { name: 'Ada 100% Lovelace' },
  });
  ids.overlap = await booking(a.orgId, lodge, {
    channel: 'vrbo',
    reference: 'HA-9921',
    status: 'conflict',
    from: 11,
    to: 12,
  });
  ids.other = await booking(b.orgId, theirs, {
    channel: 'airbnb',
    reference: 'HMOTHER001',
    status: 'confirmed',
    from: 5,
    to: 7,
    guest: { name: 'Brian Other' },
  });
});

afterAll(async () => {
  await app?.close();
  await db?.close();
  await t?.drop();
});

const list = (query: string, who: Who = asA()) => call('GET', `/v1/reservations?${query}`, { as: who });
const names = (body: Record<string, unknown>) =>
  (body.reservations as { guestName: string | null; channelReference: string | null }[]).map(
    (r) => r.guestName ?? r.channelReference,
  );

describe('the Reservations list', () => {
  it('shows who is staying and coming, in order of arrival, with what the list needs', async () => {
    const { status, body } = await list('view=upcoming');
    expect(status).toBe(200);
    expect(body.today).toBe(today);
    expect(names(body)).toEqual(['Hannah Lee', 'Ravi Kumar', 'HA-9921']);
    expect(body.more).toBe(false);
    expect(body.reservations[1]).toMatchObject({
      propertyName: 'Harbour View Lodge',
      status: 'confirmed',
      channel: 'booking_com',
      channelReference: '4311850297',
      checkIn: day(10),
      checkOut: day(13),
      adults: 2,
      children: 1,
      currency: 'GBP',
      totalMinor: 45000,
    });
    // Upcoming is the default.
    expect(names((await list('')).body)).toEqual(['Hannah Lee', 'Ravi Kumar', 'HA-9921']);
  });

  it('keeps stays that have finished, and cancellations, to themselves', async () => {
    expect(names((await list('view=past')).body)).toEqual(['Owen Price']);
    expect(names((await list('view=cancelled')).body)).toEqual(['Ada 100% Lovelace']);
  });

  it('finds a booking by guest, code or property, taking a typed % literally', async () => {
    expect(names((await list('view=upcoming&q=ravi')).body)).toEqual(['Ravi Kumar']);
    expect(names((await list('view=upcoming&q=hmstay')).body)).toEqual(['Hannah Lee']);
    expect(names((await list('view=past&q=harbour')).body)).toEqual(['Owen Price']);
    expect(names((await list('view=cancelled&q=100%25')).body)).toEqual(['Ada 100% Lovelace']);
    expect(names((await list('view=upcoming&q=%25')).body)).toEqual([]);
  });

  it('never shows another operator’s bookings, and not to the field team', async () => {
    expect(names((await list('view=upcoming', asB())).body)).toEqual(['Brian Other']);
    expect((await list('view=upcoming', as('field'))).status).toBe(403);
    expect((await list('view=soon')).status).toBe(400);
  });
});

describe('one booking', () => {
  it('has everything the reservation page shows, with the property’s times', async () => {
    const { status, body } = await call('GET', `/v1/reservations/${ids.coming}`, { as: as('accounts') });
    expect(status).toBe(200);
    expect(body).toMatchObject({
      id: ids.coming,
      propertyId: lodge,
      propertyName: 'Harbour View Lodge',
      guestName: 'Ravi Kumar',
      guestEmail: 'ravi@guest.example',
      guestPhone: null,
      propertyCheckInTime: '16:00',
      propertyCheckOutTime: '10:00',
      checkInTime: null,
      checkOutTime: null,
      notes: null,
      cancelledAt: null,
      today,
    });
    expect(body.createdAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    const cancelled = await call('GET', `/v1/reservations/${ids.cancelled}`, { as: asA() });
    expect(cancelled.body.cancelledAt).toMatch(/^\d{4}-\d\d-\d\dT/);
  });

  it('is not found in another operator’s workspace, or when it doesn’t exist', async () => {
    expect((await call('GET', `/v1/reservations/${ids.other}`, { as: asA() })).status).toBe(404);
    expect((await call('GET', `/v1/reservations/${ids.coming}`, { as: asB() })).status).toBe(404);
    const missing = await call('GET', '/v1/reservations/7d1f0c2a-0c55-4c8e-9a51-1b2c3d4e5f60', { as: asA() });
    expect(missing).toMatchObject({ status: 404, body: { error: { code: 'reservation_not_found' } } });
    expect((await call('GET', '/v1/reservations/not-an-id', { as: asA() })).status).toBe(400);
  });
});

describe('changing a booking', () => {
  const patch = (id: string, body: Record<string, unknown>, who: Who = as('comms')) =>
    call('PATCH', `/v1/reservations/${id}`, { as: who, body });

  it('lets the guest team add contact details, agreed times and notes', async () => {
    const { status, body } = await patch(ids.staying, {
      guestEmail: ' hannah@guest.example ',
      guestPhone: '+44 7700 900123',
      checkOutTime: '12:00',
      notes: 'Late departure agreed with Hannah.',
    });
    expect(status).toBe(200);
    expect(body).toMatchObject({
      guestName: 'Hannah Lee',
      guestEmail: 'hannah@guest.example',
      guestPhone: '+44 7700 900123',
      checkInTime: null,
      checkOutTime: '12:00',
      notes: 'Late departure agreed with Hannah.',
    });
    // Empty clears a detail; null puts the time back to the property's.
    const cleared = await patch(ids.staying, { guestPhone: '', checkOutTime: null, notes: '' });
    expect(cleared.body).toMatchObject({ guestPhone: null, checkOutTime: null, notes: null });
    expect(cleared.body.guestEmail).toBe('hannah@guest.example');
  });

  it('gives a booking without a guest one', async () => {
    const { body } = await patch(ids.overlap, { guestName: 'Sam Rivers', guestPhone: '07700 900456' });
    expect(body).toMatchObject({ guestName: 'Sam Rivers', guestPhone: '07700 900456', guestEmail: null });
    const [row] = await owner<{ organisation_id: string }>(
      `select g.organisation_id from app.reservations r join app.guests g on g.id = r.guest_id where r.id = $1`,
      [ids.overlap],
    );
    expect(row?.organisation_id).toBe(a.orgId);
  });

  it('leaves the dates, party and price to the channel', async () => {
    const { status, body } = await patch(ids.coming, {
      notes: 'Arriving by train.',
      checkIn: day(40),
      adults: 6,
      totalMinor: 1,
      status: 'cancelled',
    });
    expect(status).toBe(200);
    expect(body).toMatchObject({ checkIn: day(10), adults: 2, totalMinor: 45000, status: 'confirmed' });
  });

  it('refuses what isn’t an email, a phone number or a time, and an empty change', async () => {
    const bad = await patch(ids.coming, { guestEmail: 'ravi at home' });
    expect(bad).toMatchObject({ status: 400, body: { error: { code: 'invalid_request' } } });
    expect(bad.body.error.message).toMatch(/email address/);
    expect((await patch(ids.coming, { guestPhone: 'call him' })).status).toBe(400);
    expect((await patch(ids.coming, { checkInTime: '4pm' })).status).toBe(400);
    expect((await patch(ids.coming, {})).status).toBe(400);
  });

  it('is for admins, operations and the guest team; not accounts, and never another operator', async () => {
    expect((await patch(ids.coming, { notes: 'x' }, as('accounts'))).status).toBe(403);
    expect((await patch(ids.coming, { notes: 'x' }, as('field'))).status).toBe(403);
    expect((await patch(ids.coming, { notes: 'x' }, asB())).status).toBe(404);
    expect((await patch(ids.other, { notes: 'x' }, asA())).status).toBe(404);
    expect((await patch(ids.coming, { notes: 'Seen by the admin.' }, asA())).status).toBe(200);
  });

  it('records each change in the audit trail, with who made it', async () => {
    const rows = await owner<{ actor: string | null }>(
      `select actor_user_id as actor from app.audit_log
        where entity_type = 'reservations' and entity_id = $1 and action = 'update'`,
      [ids.staying],
    );
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.every((r) => r.actor === members.comms.userId)).toBe(true);
    // The guest's own details are edited on their row, so those changes are recorded too.
    const guest = await owner<{
      actor: string | null;
      before: { phone: string | null };
      after: { phone: string | null };
    }>(
      `select a.actor_user_id as actor, a.before, a.after from app.audit_log a
         join app.reservations r on r.guest_id = a.entity_id
        where a.entity_type = 'guests' and a.action = 'update' and r.id = $1
        order by a.created_at`,
      [ids.staying],
    );
    expect(guest.length).toBeGreaterThanOrEqual(2);
    expect(guest.every((g) => g.actor === members.comms.userId)).toBe(true);
    expect(guest.at(-1)).toMatchObject({ before: { phone: '+44 7700 900123' }, after: { phone: null } });
  });
});

describe('Today', () => {
  let flat: string;

  beforeAll(async () => {
    flat = (
      await call('POST', '/v1/properties', {
        as: asA(),
        body: { name: 'Mill Street Flat', countryCode: 'GB', maxGuests: 4, checkOutTime: '10:00' },
      })
    ).body.id;
    await booking(a.orgId, flat, {
      channel: 'airbnb',
      reference: 'HMTODAY001',
      status: 'confirmed',
      from: 0,
      to: 3,
      guest: { name: 'Mia Arrives' },
    });
    await booking(a.orgId, flat, {
      channel: 'direct',
      reference: null,
      status: 'confirmed',
      from: -2,
      to: 0,
      guest: { name: 'Tom Leaves' },
    });
    await owner(
      `update app.properties set cleaning_status = 'dirty', cleaning_changed_at = now() where id = $1`,
      [flat],
    );
    // The channel manager side: one change Channex refused, and last night's check found drift.
    await owner(
      `insert into app.channex_mappings (organisation_id, property_id, channex_property_id, channex_room_type_id, channex_rate_plan_id,
         cross_checked_at, cross_check_differences)
       values ($1, $2, 'cx-lodge', 'cx-lodge-room', 'cx-lodge-rate', now(), 3)`,
      [a.orgId, lodge],
    );
    await owner(`update app.properties set managed_by = 'v01' where id = $1`, [lodge]);
    await owner(
      `insert into app.ari_outbox (organisation_id, property_id, kind, date_from, date_to, status, last_error)
       values ($1, $2, 'availability', $3, $3, 'failed', 'Channex said no')`,
      [a.orgId, lodge, day(1)],
    );
    await owner(`delete from app.ari_outbox where status = 'pending'`);
  });

  it('shows arrivals, departures, who is staying and the cleans due', async () => {
    const { status, body } = await call('GET', '/v1/today', { as: asA() });
    expect(status).toBe(200);
    expect(body.date).toBe(today);
    expect(body.arrivals).toEqual([
      expect.objectContaining({
        propertyName: 'Mill Street Flat',
        guestName: 'Mia Arrives',
        channel: 'airbnb',
        nights: 3,
        guests: 3,
        time: null,
      }),
    ]);
    expect(body.departures).toEqual([
      expect.objectContaining({ propertyName: 'Mill Street Flat', guestName: 'Tom Leaves', time: null }),
    ]);
    // Hannah Lee (until day 2) and Mia (arriving) are in tonight; Tom is leaving.
    expect(body.staying).toBe(2);
    expect(body.cleansDue).toEqual([expect.objectContaining({ propertyName: 'Mill Street Flat' })]);
  });

  it('puts what needs a person first: the clash, the refused change, then last night’s drift', async () => {
    const { body } = await call('GET', '/v1/today', { as: asA() });
    const ids = (body.attention as { id: string; severity: string; to: string }[]).map((i) => [
      i.id,
      i.severity,
    ]);
    expect(ids).toEqual([
      [`conflict:${idsOf().overlap}`, 'urgent'],
      ['outbox-failed', 'urgent'],
      [`cross-check:${lodge}`, 'warning'],
    ]);
    expect(body.attention[0]).toMatchObject({
      title: 'Two bookings overlap at Harbour View Lodge',
      to: `/reservations/${idsOf().overlap}`,
    });
    expect(body.attention[1].title).toBe('1 change didn’t reach the channels');
    expect(body.attention[2]).toMatchObject({
      title: 'Channex didn’t match Harbour View Lodge',
      to: `/properties/${lodge}`,
    });
    expect(body.workerSeenAt).toBeNull();
  });

  it('shows each role what it may see: no guest names for the field team, no channel problems for accounts', async () => {
    const field = (await call('GET', '/v1/today', { as: as('field') })).body;
    expect(field.arrivals[0].guestName).toBeNull();
    expect(field.cleansDue).toEqual([]);
    expect(field.attention).toEqual([]);
    const accounts = (await call('GET', '/v1/today', { as: as('accounts') })).body;
    expect(accounts.arrivals[0].guestName).toBe('Mia Arrives');
    expect(accounts.attention.map((i: { id: string }) => i.id)).toEqual([
      `conflict:${idsOf().overlap}`,
      'outbox-failed',
      `cross-check:${lodge}`,
    ]);
    const theirs = (await call('GET', '/v1/today', { as: asB() })).body;
    expect(theirs.arrivals).toEqual([]);
    expect(theirs.attention).toEqual([]);
  });
});

const idsOf = () => ids;

describe('a booking made by the team', () => {
  it('holds the nights, makes the guest, and comes back as a confirmed direct booking', async () => {
    const { status, body } = await call('POST', '/v1/reservations', {
      as: as('comms'),
      body: {
        propertyId: lodge,
        checkIn: day(40),
        checkOut: day(43),
        guestName: 'Mia Direct',
        guestEmail: 'Mia@Guest.Example',
        guestPhone: '+44 7700 900900',
        adults: 2,
        children: 1,
        totalMinor: 45000,
        checkInTime: '17:00',
        notes: 'Repeat guest; knows the house.',
      },
    });
    expect(status).toBe(201);
    expect(body).toMatchObject({
      status: 'confirmed',
      channel: 'direct',
      channelReference: null,
      guestName: 'Mia Direct',
      guestEmail: 'mia@guest.example',
      guestPhone: '+44 7700 900900',
      checkIn: day(40),
      checkOut: day(43),
      adults: 2,
      children: 1,
      totalMinor: 45000,
      currency: 'GBP',
      checkInTime: '17:00',
      notes: 'Repeat guest; knows the house.',
    });
    // The nights are held: a second booking over them is refused, and nothing is made.
    const clash = await call('POST', '/v1/reservations', {
      as: asA(),
      body: { propertyId: lodge, checkIn: day(42), checkOut: day(45), guestName: 'Someone Else' },
    });
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe('nights_taken');
    expect(await owner('select id from app.guests where full_name = $1', ['Someone Else'])).toEqual([]);
  });

  it('checks the dates and who may make one', async () => {
    const backwards = await call('POST', '/v1/reservations', {
      as: asA(),
      body: { propertyId: lodge, checkIn: day(50), checkOut: day(50), guestName: 'No Nights' },
    });
    expect(backwards.status).toBe(400);
    expect(
      (
        await call('POST', '/v1/reservations', {
          as: as('accounts'),
          body: { propertyId: lodge, checkIn: day(60), checkOut: day(62), guestName: 'Not Allowed' },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call('POST', '/v1/reservations', {
          as: asB(),
          body: { propertyId: lodge, checkIn: day(60), checkOut: day(62), guestName: 'Other Operator' },
        })
      ).status,
    ).toBe(404);
  });
});
