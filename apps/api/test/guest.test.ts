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

/** The guest's page for their stay: public by its key, with codes only during the stay. */

const JWT_SECRET = 'test-only-jwt-secret-with-enough-length';
const FIELD_SECRET_KEY = 'test-only-field-secret-key-with-enough-length';

let t: TestDatabase;
let db: ApiDatabase;
let app: FastifyInstance;
let a: { orgId: string; userId: string };
let accounts: { orgId: string; userId: string; email: string };
let lodge: string;
let booking: string;
let key: string;
let now = new Date();
const today = todayIn('Europe/London');
const day = (n: number) => addDays(today, n);

type Who = { userId: string; email: string; orgId: string };

async function call(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH',
  url: string,
  options: { as?: Who; body?: unknown } = {},
) {
  const headers: Record<string, string> = {};
  if (options.as) {
    const jwt = await new SignJWT({ email: options.as.email, role: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(options.as.userId)
      .setAudience('authenticated')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(JWT_SECRET));
    headers.authorization = `Bearer ${jwt}`;
    headers['x-org-id'] = options.as.orgId;
  }
  const response = await app.inject({ method, url, headers, payload: options.body as never });
  // biome-ignore lint/suspicious/noExplicitAny: tests read response bodies loosely
  return { status: response.statusCode, body: response.json() as Record<string, any> };
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

beforeAll(async () => {
  t = await createTestDatabase();
  a = await seedOperator(t.ownerUrl, {
    name: 'Operator A',
    slug: 'operator-a',
    userEmail: 'admin-a@example.test',
  });
  const [user] = await owner<{ id: string }>(
    `insert into app.app_users (id, email) values (gen_random_uuid(), 'books@example.test') returning id`,
  );
  await owner(`insert into app.memberships (organisation_id, user_id, role) values ($1, $2, 'accounts')`, [
    a.orgId,
    user!.id,
  ]);
  accounts = { orgId: a.orgId, userId: user!.id, email: 'books@example.test' };
  await owner(
    `update app.organisation_brand set guest_phone = '+44 1631 000000', sender_email = 'hello@operator-a.example' where organisation_id = $1`,
    [a.orgId],
  );
  db = new ApiDatabase(t.apiUrl);
  app = await buildApp({
    env: loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: t.apiUrl,
      SUPABASE_JWT_SECRET: JWT_SECRET,
      FIELD_SECRET_KEY,
    }),
    db,
    verifyToken: createTokenVerifier({ jwtSecret: JWT_SECRET }),
    now: () => now,
  });
  lodge = (
    await call('POST', '/v1/properties', {
      as: asA(),
      body: {
        name: 'Harbour View Lodge',
        countryCode: 'GB',
        maxGuests: 6,
        checkInTime: '16:00',
        checkOutTime: '10:00',
      },
    })
  ).body.id;
  await owner(
    `update app.properties set title = 'Harbourside house with sea views', address_line1 = '4 Quay Lane', city = 'Oban',
       postcode = 'PA34 4AA', check_in_method = 'keypad', house_rules = 'No parties.', pets_allowed = true where id = $1`,
    [lodge],
  );
  // The standard fields: the top lock code and Wi-Fi for guests, the bottom lock for the team.
  const fields = (await call('GET', '/v1/custom-fields', { as: asA() })).body.fields as {
    id: string;
    name: string;
  }[];
  const idOf = (name: string) => fields.find((f) => f.name === name)?.id as string;
  const saved = await call('PUT', `/v1/properties/${lodge}/fields`, {
    as: asA(),
    body: {
      values: {
        [idOf('Top lock code')]: '4921#',
        [idOf('Bottom lock code')]: '7718#',
        [idOf('Wi-Fi name')]: 'HarbourView-Guest',
        [idOf('Wi-Fi password')]: 'seabreeze2026',
        [idOf('Check-in instructions')]: 'https://docs.example.com/harbour-view/arrival',
      },
    },
  });
  expect(saved.status).toBe(200);
  const [guest] = await owner<{ id: string }>(
    `insert into app.guests (organisation_id, full_name, email) values ($1, 'Hannah Lee', 'hannah@guest.example') returning id`,
    [a.orgId],
  );
  const [row] = await owner<{ id: string; guest_key: string }>(
    `insert into app.reservations (organisation_id, property_id, channel, channel_reference, status, check_in, check_out, adults, children, guest_id, check_in_time)
     values ($1, $2, 'airbnb', 'HMGUEST001', 'confirmed', $3, $4, 2, 1, $5, '18:00') returning id, guest_key`,
    [a.orgId, lodge, day(3), day(6), guest!.id],
  );
  booking = row!.id;
  key = row!.guest_key;
});

afterAll(async () => {
  await app?.close();
  await db?.close();
  await t?.drop();
});

describe('the guest’s link', () => {
  it('is made with the booking, 32 hex characters, and the office can read it; accounts can’t', async () => {
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    const link = await call('GET', `/v1/reservations/${booking}/guest-link`, { as: asA() });
    expect(link.status).toBe(200);
    expect(link.body).toEqual({ key, path: `/stay/${key}` });
    expect((await call('GET', `/v1/reservations/${booking}/guest-link`, { as: accounts })).status).toBe(403);
  });
});

describe('the guest’s page', () => {
  it('opens without signing in and shows the home, the dates, the rules and who to call', async () => {
    const { status, body } = await call('GET', `/v1/stay/${key}`);
    expect(status).toBe(200);
    expect(body).toMatchObject({
      guestName: 'Hannah Lee',
      checkIn: day(3),
      checkOut: day(6),
      checkInTime: '18:00',
      checkOutTime: '10:00',
      nights: 3,
      guests: 3,
      phase: 'before',
      codesFrom: day(3),
      property: {
        name: 'Harbour View Lodge',
        title: 'Harbourside house with sea views',
        addressLine1: '4 Quay Lane',
        city: 'Oban',
        postcode: 'PA34 4AA',
        checkInMethod: 'keypad',
        houseRules: 'No parties.',
        petsAllowed: true,
      },
      brand: { displayName: 'Operator A', phone: '+44 1631 000000', email: 'hello@operator-a.example' },
    });
  });

  it('shows only the fields marked for guests, and keeps the codes until the day of arrival', async () => {
    const before = (await call('GET', `/v1/stay/${key}`)).body.fields as {
      name: string;
      value: string | null;
    }[];
    expect(before).toEqual([
      { name: 'Top lock code', kind: 'secret', value: null },
      { name: 'Wi-Fi name', kind: 'text', value: 'HarbourView-Guest' },
      { name: 'Wi-Fi password', kind: 'secret', value: null },
      { name: 'Check-in instructions', kind: 'link', value: 'https://docs.example.com/harbour-view/arrival' },
    ]);
    expect(before.some((f) => f.name === 'Bottom lock code')).toBe(false);

    // The day the guest arrives, the codes appear; the day after they leave, they are gone again.
    now = new Date(`${day(3)}T08:00:00Z`);
    const during = (await call('GET', `/v1/stay/${key}`)).body;
    expect(during.phase).toBe('during');
    expect(during.codesFrom).toBeNull();
    expect(during.fields).toContainEqual({ name: 'Top lock code', kind: 'secret', value: '4921#' });
    expect(during.fields).toContainEqual({ name: 'Wi-Fi password', kind: 'secret', value: 'seabreeze2026' });
    now = new Date(`${day(7)}T08:00:00Z`);
    const after = (await call('GET', `/v1/stay/${key}`)).body;
    expect(after.phase).toBe('after');
    expect(after.fields).toContainEqual({ name: 'Top lock code', kind: 'secret', value: null });
    now = new Date();
  });

  it('lets an admin choose which fields guests see', async () => {
    const fields = (await call('GET', '/v1/custom-fields', { as: asA() })).body.fields as {
      id: string;
      name: string;
      guestVisible: boolean;
    }[];
    expect(fields.find((f) => f.name === 'Bottom lock code')?.guestVisible).toBe(false);
    const wifi = fields.find((f) => f.name === 'Wi-Fi name') as { id: string };
    const changed = await call('PATCH', `/v1/custom-fields/${wifi.id}`, {
      as: asA(),
      body: { guestVisible: false },
    });
    expect(changed.status).toBe(200);
    expect(changed.body.guestVisible).toBe(false);
    const page = (await call('GET', `/v1/stay/${key}`)).body.fields as { name: string }[];
    expect(page.some((f) => f.name === 'Wi-Fi name')).toBe(false);
    await call('PATCH', `/v1/custom-fields/${wifi.id}`, { as: asA(), body: { guestVisible: true } });
  });

  it('is not found for a wrong key, a cancelled booking, or a key that isn’t one', async () => {
    expect((await call('GET', `/v1/stay/${'0'.repeat(32)}`)).status).toBe(404);
    expect((await call('GET', '/v1/stay/not-a-key')).status).toBe(400);
    await owner(`update app.reservations set status = 'cancelled', cancelled_at = now() where id = $1`, [
      booking,
    ]);
    expect((await call('GET', `/v1/stay/${key}`)).status).toBe(404);
    await owner(`update app.reservations set status = 'confirmed', cancelled_at = null where id = $1`, [
      booking,
    ]);
  });
});
