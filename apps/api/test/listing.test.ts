import { ApiDatabase } from '@v01/db';
import { createTestDatabase, seedOperator, type TestDatabase } from '@v01/db/testing';
import type { FastifyInstance } from 'fastify';
import { SignJWT } from 'jose';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { createTokenVerifier } from '../src/auth.ts';
import { loadEnv } from '../src/env.ts';
import { MemoryPhotoStore } from '../src/photos.ts';

/** The whole listing: rooms and beds, amenities, photos, descriptions, rules and fees. */

const JWT_SECRET = 'test-only-jwt-secret-with-enough-length';

let t: TestDatabase;
let db: ApiDatabase;
let app: FastifyInstance;
let storage: MemoryPhotoStore;
let a: { orgId: string; userId: string };
let b: { orgId: string; userId: string };
let propertyId: string;

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
type Who = { userId: string; email: string; orgId: string };

async function call(
  method: Method,
  url: string,
  options: { as: Who; body?: unknown; on?: FastifyInstance },
  // biome-ignore lint/suspicious/noExplicitAny: tests read response bodies loosely; the API's schemas type the real ones
): Promise<{ status: number; body: Record<string, any> }> {
  const jwt = await new SignJWT({ email: options.as.email, role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(options.as.userId)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const response = await (options.on ?? app).inject({
    method,
    url,
    headers: { authorization: `Bearer ${jwt}`, 'x-org-id': options.as.orgId },
    payload: options.body as never,
  });
  return { status: response.statusCode, body: response.json() };
}

async function ownerRows<T extends pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> {
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
const FIELD_SECRET_KEY = 'test-only-field-secret-key-with-enough-length';
const env = () =>
  loadEnv({ NODE_ENV: 'test', DATABASE_URL: t.apiUrl, SUPABASE_JWT_SECRET: JWT_SECRET, FIELD_SECRET_KEY });

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
  storage = new MemoryPhotoStore();
  app = await buildApp({
    env: env(),
    db,
    verifyToken: createTokenVerifier({ jwtSecret: JWT_SECRET }),
    photos: storage,
  });
});

afterAll(async () => {
  await app?.close();
  await db?.close();
  await t?.drop();
});

describe('adding a property with its listing', () => {
  it('keeps the title, description, amenities and prices from the add panel', async () => {
    const { status, body } = await call('POST', '/v1/properties', {
      as: asA(),
      body: {
        name: '3 Carnoustie Drive',
        countryCode: 'GB',
        maxGuests: 6,
        propertyType: 'house',
        title: 'Seaside house with a garden and hot tub',
        summary: 'A bright family home two minutes from the beach.',
        amenities: ['hot_tub', 'wifi', 'garden', 'wifi'],
        basePriceMinor: 18_000,
        cleaningFeeMinor: 6_000,
      },
    });
    expect(status).toBe(201);
    expect(body).toMatchObject({
      title: 'Seaside house with a garden and hot tub',
      summary: 'A bright family home two minutes from the beach.',
      amenities: ['garden', 'hot_tub', 'wifi'],
      basePriceMinor: 18_000,
      cleaningFeeMinor: 6_000,
      managedBy: 'none',
      minNights: 1,
      instantBook: true,
      cancellationPolicy: 'moderate',
      rooms: [],
      photos: [],
      photoCount: 0,
      coverPhotoUrl: null,
    });
    propertyId = body.id;
  });

  it('refuses an amenity that is not on the list, and a title too long for Airbnb', async () => {
    const odd = await call('POST', '/v1/properties', {
      as: asA(),
      body: { name: 'Odd', countryCode: 'GB', maxGuests: 2, amenities: ['moat'] },
    });
    expect(odd.status).toBe(400);
    const long = await call('POST', '/v1/properties', {
      as: asA(),
      body: { name: 'Long', countryCode: 'GB', maxGuests: 2, title: 'x'.repeat(51) },
    });
    expect(long.status).toBe(400);
  });
});

describe('editing a property after it is added', () => {
  it('changes any part of the listing, and clears a field sent empty', async () => {
    const { status, body } = await call('PATCH', `/v1/properties/${propertyId}`, {
      as: asA(),
      body: {
        theSpace: 'Three bedrooms upstairs; open-plan kitchen and lounge downstairs.',
        neighbourhood: 'Port Seton harbour is a short walk away.',
        checkInMethod: 'keypad',
        petsAllowed: true,
        quietHoursStart: '22:00',
        quietHoursEnd: '08:00',
        minNights: 2,
        maxNights: 28,
        preparationDays: 1,
        cancellationPolicy: 'firm',
        weekendPriceMinor: 21_000,
        extraGuestFeeMinor: 1_500,
        extraGuestFrom: 5,
        licenceNumber: 'EL00123F',
        summary: '',
      },
    });
    expect(status).toBe(200);
    expect(body).toMatchObject({
      theSpace: 'Three bedrooms upstairs; open-plan kitchen and lounge downstairs.',
      checkInMethod: 'keypad',
      petsAllowed: true,
      quietHoursStart: '22:00',
      quietHoursEnd: '08:00',
      minNights: 2,
      maxNights: 28,
      cancellationPolicy: 'firm',
      licenceNumber: 'EL00123F',
      summary: null,
      title: 'Seaside house with a garden and hot tub',
    });
  });

  it('explains a change that would contradict what is already saved', async () => {
    const stays = await call('PATCH', `/v1/properties/${propertyId}`, { as: asA(), body: { minNights: 30 } });
    expect(stays).toMatchObject({
      status: 400,
      body: { error: { message: 'The shortest stay is longer than the longest.' } },
    });
    const quiet = await call('PATCH', `/v1/properties/${propertyId}`, {
      as: asA(),
      body: { quietHoursEnd: null },
    });
    expect(quiet.body.error.message).toBe('Give quiet hours a start and an end.');
  });

  it('never moves a property to V-01 from here', async () => {
    const { body } = await call('PATCH', `/v1/properties/${propertyId}`, {
      as: asA(),
      body: { managedBy: 'v01', otherNotes: 'Bins go out on Thursday.' },
    });
    expect(body).toMatchObject({ managedBy: 'none', otherNotes: 'Bins go out on Thursday.' });
  });

  it("keeps another operator's hands off", async () => {
    const { status } = await call('PATCH', `/v1/properties/${propertyId}`, {
      as: asB(),
      body: { title: 'Mine now' },
    });
    expect(status).toBe(404);
  });
});

describe('rooms and beds', () => {
  let bedroomId: string;

  it('sets the sleeping arrangements and counts bedrooms and beds from them', async () => {
    const { status, body } = await call('PUT', `/v1/properties/${propertyId}/rooms`, {
      as: asA(),
      body: {
        rooms: [
          {
            kind: 'bedroom',
            name: 'Main bedroom',
            beds: [{ type: 'king', count: 1 }],
            privateBathroom: true,
          },
          { kind: 'bedroom', beds: [{ type: 'single', count: 2 }] },
          {
            kind: 'bedroom',
            beds: [
              { type: 'bunk_bed', count: 1 },
              { type: 'cot', count: 1 },
            ],
          },
          { kind: 'living_room', beds: [{ type: 'sofa_bed', count: 1 }] },
        ],
      },
    });
    expect(status).toBe(200);
    expect(body).toMatchObject({ bedrooms: 3, beds: 5 });
    expect(body.rooms).toHaveLength(4);
    expect(body.rooms[0]).toMatchObject({ kind: 'bedroom', name: 'Main bedroom', privateBathroom: true });
    bedroomId = body.rooms[0].id;
  });

  it('keeps a room when it is edited, so its photos stay with it', async () => {
    const { body } = await call('PUT', `/v1/properties/${propertyId}/rooms`, {
      as: asA(),
      body: {
        rooms: [
          {
            id: bedroomId,
            kind: 'bedroom',
            name: 'Sea-view bedroom',
            beds: [{ type: 'super_king', count: 1 }],
          },
          { kind: 'bedroom', beds: [{ type: 'double', count: 1 }] },
        ],
      },
    });
    expect(body.rooms[0]).toMatchObject({ id: bedroomId, name: 'Sea-view bedroom' });
    expect(body).toMatchObject({ bedrooms: 2, beds: 2 });
  });
});

describe('amenities', () => {
  it('replaces the set, and refuses one that is not on the list', async () => {
    const { body } = await call('PUT', `/v1/properties/${propertyId}/amenities`, {
      as: asA(),
      body: { amenities: ['sea_view', 'wifi', 'log_burner', 'dishwasher'] },
    });
    expect(body.amenities).toEqual(['dishwasher', 'log_burner', 'sea_view', 'wifi']);
    const odd = await call('PUT', `/v1/properties/${propertyId}/amenities`, {
      as: asA(),
      body: { amenities: ['wifi', 'drawbridge'] },
    });
    expect(odd.status).toBe(400);
  });
});

describe('photos', () => {
  const upload = async (who: Who, id = propertyId) => {
    const ticket = await call('POST', `/v1/properties/${id}/photos/uploads`, {
      as: who,
      body: { contentType: 'image/jpeg', bytes: 400_000 },
    });
    return ticket.body as { path: string; uploadUrl: string };
  };

  it("hands out an upload ticket under the property's own folder", async () => {
    const ticket = await upload(asA());
    expect(ticket.path.startsWith(`${a.orgId}/${propertyId}/`)).toBe(true);
    expect(ticket.path.endsWith('.jpg')).toBe(true);
  });

  it('only registers a photo once its file has arrived', async () => {
    const { path } = await upload(asA());
    const early = await call('POST', `/v1/properties/${propertyId}/photos`, {
      as: asA(),
      body: { path, width: 2400, height: 1600 },
    });
    expect(early.status).toBe(409);
    storage.files.add(path);
    const { status, body } = await call('POST', `/v1/properties/${propertyId}/photos`, {
      as: asA(),
      body: { path, width: 2400, height: 1600, caption: 'The garden' },
    });
    expect(status).toBe(201);
    expect(body.photos).toEqual([
      expect.objectContaining({ url: `https://photos.test/${path}`, caption: 'The garden', position: 0 }),
    ]);
    expect(body).toMatchObject({ photoCount: 1, coverPhotoUrl: `https://photos.test/${path}` });
  });

  it('orders, captions, tags to a room and removes photos', async () => {
    for (let i = 0; i < 2; i++) {
      const { path } = await upload(asA());
      storage.files.add(path);
      await call('POST', `/v1/properties/${propertyId}/photos`, {
        as: asA(),
        body: { path, width: 1600, height: 1200 },
      });
    }
    const before = (await call('GET', `/v1/properties/${propertyId}`, { as: asA() })).body;
    const ids = before.photos.map((p: { id: string }) => p.id) as string[];
    expect(ids).toHaveLength(3);

    const reordered = await call('PUT', `/v1/properties/${propertyId}/photos/order`, {
      as: asA(),
      body: { photoIds: [ids[2], ids[0], ids[1]] },
    });
    expect(reordered.body.photos.map((p: { id: string }) => p.id)).toEqual([ids[2], ids[0], ids[1]]);
    expect(reordered.body.coverPhotoUrl).toBe(reordered.body.photos[0].url);

    const stale = await call('PUT', `/v1/properties/${propertyId}/photos/order`, {
      as: asA(),
      body: { photoIds: [ids[0], ids[1]] },
    });
    expect(stale.status).toBe(409);

    const room = before.rooms[0].id as string;
    const tagged = await call('PATCH', `/v1/properties/${propertyId}/photos/${ids[0]}`, {
      as: asA(),
      body: { caption: 'Sea-view bedroom', roomId: room },
    });
    expect(tagged.body.photos.find((p: { id: string }) => p.id === ids[0])).toMatchObject({
      caption: 'Sea-view bedroom',
      roomId: room,
    });

    const removedPath = before.photos[0].url.replace('https://photos.test/', '');
    const after = await call('DELETE', `/v1/properties/${propertyId}/photos/${ids[0]}`, { as: asA() });
    expect(after.body.photos.map((p: { position: number }) => p.position)).toEqual([0, 1]);
    expect(storage.files.has(removedPath)).toBe(false);
  });

  it('lists each property with its cover photo and photo count', async () => {
    const { body } = await call('GET', '/v1/properties', { as: asA() });
    const listed = body.properties.find((p: { id: string }) => p.id === propertyId);
    expect(listed).toMatchObject({ photoCount: 2 });
    expect(listed.coverPhotoUrl).toMatch(/^https:\/\/photos\.test\//);
  });

  it("refuses a file uploaded for another property, and another operator's photos", async () => {
    const other = await call('POST', '/v1/properties', {
      as: asA(),
      body: { name: 'Harbour Flat', countryCode: 'GB', maxGuests: 2 },
    });
    const { path } = await upload(asA(), other.body.id);
    storage.files.add(path);
    const misplaced = await call('POST', `/v1/properties/${propertyId}/photos`, {
      as: asA(),
      body: { path, width: 1600, height: 1200 },
    });
    expect(misplaced.status).toBe(400);
    const theirs = await call('POST', `/v1/properties/${propertyId}/photos/uploads`, {
      as: asB(),
      body: { contentType: 'image/jpeg', bytes: 1000 },
    });
    expect(theirs.status).toBe(404);
  });

  it('says so plainly while photo storage is not set up', async () => {
    const bare = await buildApp({
      env: env(),
      db,
      verifyToken: createTokenVerifier({ jwtSecret: JWT_SECRET }),
    });
    try {
      const { status, body } = await call('POST', `/v1/properties/${propertyId}/photos/uploads`, {
        as: asA(),
        body: { contentType: 'image/jpeg', bytes: 1000 },
        on: bare,
      });
      expect(status).toBe(503);
      expect(body.error.code).toBe('photo_storage_not_ready');
    } finally {
      await bare.close();
    }
  });
});

describe('connecting to the channel manager', () => {
  const connect = (id: string, who: Who = asA()) => call('POST', `/v1/properties/${id}/channex`, { as: who });
  const detail = async (id: string) => (await call('GET', `/v1/properties/${id}`, { as: asA() })).body;
  let cabin: string;

  beforeAll(async () => {
    const { body } = await call('POST', '/v1/properties', {
      as: asA(),
      body: { name: 'Dune Cabin', countryCode: 'GB', maxGuests: 2 },
    });
    cabin = body.id;
  });

  it('starts not connected, and queues a request for the worker when asked', async () => {
    expect((await detail(cabin)).channex).toEqual({
      status: 'not_connected',
      channexPropertyId: null,
      requestedBy: null,
      requestedAt: null,
      finishedAt: null,
      error: null,
      attempts: 0,
      autoClose: null,
      autoCloseCheckedAt: null,
    });
    const { status, body } = await connect(cabin);
    expect(status).toBe(200);
    expect(body).toMatchObject({
      status: 'connecting',
      requestedBy: 'admin-a@example.test',
      attempts: 0,
      error: null,
    });
    expect(Date.now() - Date.parse(body.requestedAt)).toBeLessThan(60_000);
    expect((await detail(cabin)).channex).toEqual(body);
    // Asking again while it is queued changes nothing.
    expect((await connect(cabin)).body).toEqual(body);
  });

  it('is for admins only, and never another operator', async () => {
    const [ops] = await ownerRows<{ id: string }>(
      `insert into app.app_users (id, email) values (gen_random_uuid(), 'ops-a@example.test') returning id`,
    );
    await ownerRows(
      `insert into app.memberships (organisation_id, user_id, role) values ($1, $2, 'operations')`,
      [a.orgId, ops!.id],
    );
    expect(
      (await connect(cabin, { orgId: a.orgId, userId: ops!.id, email: 'ops-a@example.test' })).status,
    ).toBe(403);
    expect((await connect(cabin, asB())).status).toBe(404);
  });

  it('shows a failure with its reason, starts over when asked again, and refuses once connected', async () => {
    await ownerRows(
      `update app.channex_setups set status = 'failed', attempts = 3, last_error = 'Title is too long', finished_at = now()
        where property_id = $1`,
      [cabin],
    );
    expect((await detail(cabin)).channex).toMatchObject({
      status: 'failed',
      attempts: 3,
      error: 'Title is too long',
    });
    expect((await connect(cabin)).body).toMatchObject({
      status: 'connecting',
      attempts: 0,
      error: null,
      finishedAt: null,
    });
    // The worker made it.
    await ownerRows(
      `insert into app.channex_mappings (organisation_id, property_id, channex_property_id, channex_room_type_id, channex_rate_plan_id)
       values ($1, $2, 'cx-dune', 'cx-dune-room', 'cx-dune-rate')`,
      [a.orgId, cabin],
    );
    await ownerRows(
      `update app.channex_setups set status = 'done', finished_at = now() where property_id = $1`,
      [cabin],
    );
    expect((await detail(cabin)).channex).toMatchObject({
      status: 'connected',
      channexPropertyId: 'cx-dune',
      error: null,
    });
    expect(await connect(cabin)).toMatchObject({
      status: 409,
      body: { error: { code: 'already_connected' } },
    });
  });
});

describe('the property page’s summary and archiving', () => {
  it('shows cleaning and the listings taking bookings, and archiving hides the property everywhere', async () => {
    const { body: made } = await call('POST', '/v1/properties', {
      as: asA(),
      body: { name: 'Marsh House', countryCode: 'GB', maxGuests: 4 },
    });
    expect(made.cleaning).toEqual({ status: 'clean', changedAt: null, changedBy: null });
    expect(made.listings).toEqual([]);
    const [account] = await ownerRows<{ id: string }>(
      `insert into app.channel_accounts (organisation_id, channel, label) values ($1, 'airbnb', 'Airbnb B') returning id`,
      [a.orgId],
    );
    await ownerRows(
      `insert into app.channel_listings (organisation_id, property_id, channel_account_id, channel, external_listing_id)
       values ($1, $2, $3, 'airbnb', '123456')`,
      [a.orgId, made.id, account!.id],
    );
    await call('PUT', `/v1/properties/${made.id}/cleaning`, { as: asA(), body: { status: 'dirty' } });
    const { body } = await call('GET', `/v1/properties/${made.id}`, { as: asA() });
    expect(body.listings).toEqual([{ channel: 'airbnb', account: 'Airbnb B', externalListingId: '123456' }]);
    expect(body.cleaning).toMatchObject({ status: 'dirty', changedBy: 'admin-a@example.test' });

    expect((await call('POST', `/v1/properties/${made.id}/archive`, { as: asB() })).status).toBe(404);
    const archived = await call('POST', `/v1/properties/${made.id}/archive`, { as: asA() });
    expect(archived.status).toBe(200);
    expect(Date.now() - Date.parse(archived.body.archivedAt)).toBeLessThan(60_000);
    expect((await call('GET', `/v1/properties/${made.id}`, { as: asA() })).status).toBe(404);
    const list = await call('GET', '/v1/properties', { as: asA() });
    expect((list.body.properties as { id: string }[]).some((p) => p.id === made.id)).toBe(false);
    expect((await call('POST', `/v1/properties/${made.id}/archive`, { as: asA() })).status).toBe(404);
  });
});

describe('custom fields', () => {
  const fieldsOf = async (id: string, who: Who = asA()) =>
    (await call('GET', `/v1/properties/${id}`, { as: who })).body.fields as Record<string, unknown>[];
  let accounts: Who;
  let operations: Who;
  let cottage: string;
  let link: string;
  let code: string;
  let note: string;

  beforeAll(async () => {
    const [acct] = await ownerRows<{ id: string }>(
      `insert into app.app_users (id, email) values (gen_random_uuid(), 'books@example.test') returning id`,
    );
    const [ops] = await ownerRows<{ id: string }>(
      `insert into app.app_users (id, email) values (gen_random_uuid(), 'ops@example.test') returning id`,
    );
    await ownerRows(
      `insert into app.memberships (organisation_id, user_id, role) values ($1, $2, 'accounts'), ($1, $3, 'operations')`,
      [a.orgId, acct?.id, ops?.id],
    );
    accounts = { userId: acct?.id as string, email: 'books@example.test', orgId: a.orgId };
    operations = { userId: ops?.id as string, email: 'ops@example.test', orgId: a.orgId };
    const { body } = await call('POST', '/v1/properties', {
      as: asA(),
      body: { name: 'Field Cottage', countryCode: 'GB', maxGuests: 4 },
    });
    cottage = body.id;
  });

  it('lets an admin define fields for the workspace, in order', async () => {
    // One after another, as a person would: positions follow the order of adding.
    const made: Record<string, unknown>[] = [];
    for (const [name, kind] of [
      ['Check-in instructions', 'link'],
      ['Lock code', 'secret'],
      ['Note for the team', 'long_text'],
    ] as const) {
      const { status, body } = await call('POST', '/v1/custom-fields', { as: asA(), body: { name, kind } });
      expect(status).toBe(201);
      made.push(body);
    }
    [link, code, note] = made.map((f) => f.id as string) as [string, string, string];
    const { body } = await call('GET', '/v1/custom-fields', { as: accounts });
    expect((body.fields as { name: string }[]).map((f) => f.name)).toEqual([
      'Check-in instructions',
      'Lock code',
      'Note for the team',
    ]);
    const again = await call('POST', '/v1/custom-fields', {
      as: asA(),
      body: { name: 'lock code', kind: 'text' },
    });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('field_exists');
  });

  it('only admins define them', async () => {
    const { status } = await call('POST', '/v1/custom-fields', {
      as: operations,
      body: { name: 'Parking', kind: 'text' },
    });
    expect(status).toBe(403);
  });

  it('shows every field on a property, empty until filled', async () => {
    expect(await fieldsOf(cottage)).toEqual([
      expect.objectContaining({ id: link, kind: 'link', value: null, hidden: false }),
      expect.objectContaining({ id: code, kind: 'secret', value: null, hidden: false }),
      expect.objectContaining({ id: note, kind: 'long_text', value: null, hidden: false }),
    ]);
  });

  it('saves values, checks links, and clears with an empty string', async () => {
    const bad = await call('PUT', `/v1/properties/${cottage}/fields`, {
      as: operations,
      body: { values: { [link]: 'see the shared doc' } },
    });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('not_a_link');

    const { status, body } = await call('PUT', `/v1/properties/${cottage}/fields`, {
      as: operations,
      body: { values: { [link]: 'https://docs.example.test/arrival', [note]: 'Bins go out Tuesday.' } },
    });
    expect(status).toBe(200);
    expect(body.fields).toEqual([
      expect.objectContaining({ id: link, value: 'https://docs.example.test/arrival' }),
      expect.objectContaining({ id: code, value: null }),
      expect.objectContaining({ id: note, value: 'Bins go out Tuesday.' }),
    ]);

    const cleared = await call('PUT', `/v1/properties/${cottage}/fields`, {
      as: operations,
      body: { values: { [note]: '' } },
    });
    expect(cleared.body.fields).toEqual([
      expect.objectContaining({ id: link, value: 'https://docs.example.test/arrival' }),
      expect.objectContaining({ id: code, value: null }),
      expect.objectContaining({ id: note, value: null }),
    ]);
  });

  it('keeps secrets encrypted in the database and shows them only to roles that may see them', async () => {
    const { status, body } = await call('PUT', `/v1/properties/${cottage}/fields`, {
      as: operations,
      body: { values: { [code]: 'zq1357#' } },
    });
    expect(status).toBe(200);
    expect(body.fields).toContainEqual(
      expect.objectContaining({ id: code, value: 'zq1357#', hidden: false }),
    );

    // Operations and admins see it; accounts see that there is one, and nothing else.
    expect(await fieldsOf(cottage, operations)).toContainEqual(
      expect.objectContaining({ id: code, value: 'zq1357#' }),
    );
    const books = await fieldsOf(cottage, accounts);
    expect(books).toContainEqual(expect.objectContaining({ id: code, value: null, hidden: true }));
    expect(JSON.stringify(books)).not.toContain('zq1357');

    // The table and the audit log hold sealed bytes, never the code.
    const [stored] = await ownerRows<{ value: string | null; secret: Buffer | null }>(
      `select value, secret from app.property_field_values where property_id = $1 and field_id = $2`,
      [cottage, code],
    );
    expect(stored?.value).toBeNull();
    expect(stored?.secret?.toString('utf8')).not.toContain('zq1357');
    const audit = await ownerRows<{ after: Record<string, unknown> }>(
      `select after from app.audit_log where entity_type = 'property_field_values' and entity_id = (
         select id from app.property_field_values where property_id = $1 and field_id = $2)`,
      [cottage, code],
    );
    expect(audit.length).toBeGreaterThan(0);
    expect(JSON.stringify(audit)).not.toContain('zq1357');

    // Accounts can't set one either.
    const { status: refused } = await call('PUT', `/v1/properties/${cottage}/fields`, {
      as: accounts,
      body: { values: { [code]: '0000' } },
    });
    expect(refused).toBe(403);
  });

  it('refuses secrets when the API has no key, instead of storing them plain', async () => {
    const bare = await buildApp({
      env: loadEnv({ NODE_ENV: 'test', DATABASE_URL: t.apiUrl, SUPABASE_JWT_SECRET: JWT_SECRET }),
      db,
      verifyToken: createTokenVerifier({ jwtSecret: JWT_SECRET }),
      photos: storage,
    });
    try {
      const { status, body } = await call('PUT', `/v1/properties/${cottage}/fields`, {
        as: asA(),
        body: { values: { [code]: '9999' } },
        on: bare,
      });
      expect(status).toBe(503);
      expect(body.error.code).toBe('secrets_unavailable');
      // What is already stored stays hidden rather than unreadable noise.
      expect(await fieldsOf(cottage, asA())).toContainEqual(
        expect.objectContaining({ id: code, value: 'zq1357#' }),
      );
      const { body: seen } = await call('GET', `/v1/properties/${cottage}`, { as: asA(), on: bare });
      expect(seen.fields).toContainEqual(expect.objectContaining({ id: code, value: null, hidden: true }));
    } finally {
      await bare.close();
    }
  });

  it('renames and reorders fields, and deleting one removes its values everywhere', async () => {
    const renamed = await call('PATCH', `/v1/custom-fields/${note}`, {
      as: asA(),
      body: { name: 'Internal note', position: 0 },
    });
    expect(renamed.status).toBe(200);
    expect(renamed.body).toMatchObject({ name: 'Internal note', position: 0 });
    expect((await fieldsOf(cottage)).map((f) => f.name)).toEqual([
      'Internal note',
      'Check-in instructions',
      'Lock code',
    ]);

    const gone = await call('DELETE', `/v1/custom-fields/${code}`, { as: asA() });
    expect(gone.status).toBe(200);
    expect((await fieldsOf(cottage)).map((f) => f.name)).toEqual(['Internal note', 'Check-in instructions']);
    const [left] = await ownerRows<{ n: number }>(
      `select count(*)::int as n from app.property_field_values where field_id = $1`,
      [code],
    );
    expect(left?.n).toBe(0);
  });

  it("keeps one operator's fields out of another's workspace", async () => {
    expect((await call('GET', '/v1/custom-fields', { as: asB() })).body.fields).toEqual([]);
    const { status } = await call('PATCH', `/v1/custom-fields/${link}`, {
      as: asB(),
      body: { name: 'Mine' },
    });
    expect(status).toBe(404);
    const { status: setStatus } = await call('PUT', `/v1/properties/${cottage}/fields`, {
      as: asB(),
      body: { values: { [link]: 'https://b.example.test' } },
    });
    expect(setStatus).toBe(404);
  });
});

describe('channel accounts and listing links', () => {
  let cottage: string;
  let airbnbA: string;
  let bookingA: string;
  let operations: Who;

  beforeAll(async () => {
    const { body } = await call('POST', '/v1/properties', {
      as: asA(),
      body: { name: 'Link Cottage', countryCode: 'GB', maxGuests: 4 },
    });
    cottage = body.id;
    const [ops] = await ownerRows<{ id: string }>(
      `insert into app.app_users (id, email) values (gen_random_uuid(), 'ops-links@example.test') returning id`,
    );
    await ownerRows(
      `insert into app.memberships (organisation_id, user_id, role) values ($1, $2, 'operations')`,
      [a.orgId, ops?.id],
    );
    operations = { userId: ops?.id as string, email: 'ops-links@example.test', orgId: a.orgId };
  });

  it('lets an admin add accounts, each named once', async () => {
    const made = await call('POST', '/v1/channel-accounts', {
      as: asA(),
      body: { channel: 'airbnb', label: 'Airbnb A', loginHolder: 'Alpha' },
    });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({
      channel: 'airbnb',
      label: 'Airbnb A',
      status: 'disconnected',
      loginHolder: 'Alpha',
      connection: null,
      listingsSeen: 0,
      listingsLinked: 0,
    });
    airbnbA = made.body.id;
    const booking = await call('POST', '/v1/channel-accounts', {
      as: asA(),
      body: { channel: 'booking_com', label: 'Booking.com A' },
    });
    bookingA = booking.body.id;
    const again = await call('POST', '/v1/channel-accounts', {
      as: asA(),
      body: { channel: 'airbnb', label: 'Airbnb A' },
    });
    expect(again.status).toBe(409);
    expect(
      (
        await call('POST', '/v1/channel-accounts', {
          as: operations,
          body: { channel: 'vrbo', label: 'Vrbo' },
        })
      ).status,
    ).toBe(403);
    const list = await call('GET', '/v1/channel-accounts', { as: operations });
    expect((list.body.accounts as { label: string }[]).map((x) => x.label)).toEqual(
      expect.arrayContaining(['Airbnb A', 'Booking.com A']),
    );
  });

  it('asks the worker to connect, once a property is in Channex, and Booking.com with its hotel id', async () => {
    await ownerRows(
      `insert into app.channex_mappings (organisation_id, property_id, channex_property_id, channex_room_type_id, channex_rate_plan_id)
       values ($1, $2, 'cx-link', 'cx-link-room', 'cx-link-rate')`,
      [a.orgId, cottage],
    );
    const asked = await call('POST', `/v1/channel-accounts/${airbnbA}/connect`, { as: asA(), body: {} });
    expect(asked.status).toBe(200);
    expect(asked.body).toMatchObject({
      status: 'pending',
      connection: { channexChannelId: null, active: false },
    });

    const noHotel = await call('POST', `/v1/channel-accounts/${bookingA}/connect`, { as: asA(), body: {} });
    expect(noHotel.status).toBe(422);
    const withHotel = await call('POST', `/v1/channel-accounts/${bookingA}/connect`, {
      as: asA(),
      body: { hotelId: '7654321' },
    });
    expect(withHotel.body).toMatchObject({ status: 'pending', connection: { externalAccountId: '7654321' } });
  });

  it('shows the connection and the listings the worker cached, and links one to a property', async () => {
    // The worker made the connection and the owner authorised it.
    await ownerRows(
      `insert into app.channex_channels (organisation_id, channel_account_id, channex_channel_id, connect_url, active)
       values ($1, $2, 'cx-chan-airbnb-a', 'https://connect.example.test/airbnb-a', true)`,
      [a.orgId, airbnbA],
    );
    await ownerRows(
      `update app.channel_accounts set status = 'connected', external_account_id = 'host-1' where id = $1`,
      [airbnbA],
    );
    await ownerRows(
      `insert into app.channel_account_listings (organisation_id, channel_account_id, external_listing_id, title)
       values ($1, $2, '55512345', 'Link Cottage · garden'), ($1, $2, '55598765', 'Somewhere else')`,
      [a.orgId, airbnbA],
    );
    const listings = await call('GET', `/v1/channel-accounts/${airbnbA}/listings`, { as: operations });
    expect(listings.body.listings).toEqual([
      expect.objectContaining({
        externalListingId: '55512345',
        title: 'Link Cottage · garden',
        url: 'https://www.airbnb.com/rooms/55512345',
        linkedPropertyId: null,
      }),
      expect.objectContaining({ externalListingId: '55598765', linkedPropertyId: null }),
    ]);

    const linked = await call('POST', `/v1/properties/${cottage}/links`, {
      as: operations,
      body: { channelAccountId: airbnbA, externalListingId: '55512345' },
    });
    expect(linked.status, JSON.stringify(linked.body)).toBe(201);
    expect(linked.body.links).toEqual([
      expect.objectContaining({
        channel: 'airbnb',
        account: 'Airbnb A',
        externalListingId: '55512345',
        title: 'Link Cottage · garden',
        status: 'linking',
        requestedBy: 'ops-links@example.test',
      }),
    ]);
    const detail = await call('GET', `/v1/properties/${cottage}`, { as: asA() });
    expect(detail.body.links).toHaveLength(1);
    const after = await call('GET', `/v1/channel-accounts/${airbnbA}/listings`, { as: asA() });
    expect(after.body.listings[0]).toMatchObject({
      linkedPropertyId: cottage,
      linkedPropertyName: 'Link Cottage',
    });
    expect((await call('GET', '/v1/channel-accounts', { as: asA() })).body.accounts[0]).toMatchObject({
      label: 'Airbnb A',
      listingsSeen: 2,
      listingsLinked: 1,
    });
  });

  it('refuses a listing that is taken, a second live listing on the same channel, and an unconnected account', async () => {
    const { body: other } = await call('POST', '/v1/properties', {
      as: asA(),
      body: { name: 'Other Cottage', countryCode: 'GB', maxGuests: 2 },
    });
    await ownerRows(
      `insert into app.channex_mappings (organisation_id, property_id, channex_property_id, channex_room_type_id, channex_rate_plan_id)
       values ($1, $2, 'cx-other', 'cx-other-room', 'cx-other-rate')`,
      [a.orgId, other.id],
    );
    const taken = await call('POST', `/v1/properties/${other.id}/links`, {
      as: asA(),
      body: { channelAccountId: airbnbA, externalListingId: '55512345' },
    });
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe('listing_taken');
    const second = await call('POST', `/v1/properties/${cottage}/links`, {
      as: asA(),
      body: { channelAccountId: airbnbA, externalListingId: '55598765' },
    });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('channel_taken');
    const pending = await call('POST', `/v1/properties/${cottage}/links`, {
      as: asA(),
      body: { channelAccountId: bookingA, externalListingId: '1' },
    });
    expect(pending.status).toBe(409);
    expect(pending.body.error.code).toBe('account_not_connected');
  });

  it('unlinks by marking the link closing for the worker', async () => {
    const links = (await call('GET', `/v1/properties/${cottage}/links`, { as: asA() })).body.links as {
      id: string;
    }[];
    const gone = await call('DELETE', `/v1/properties/${cottage}/links/${links[0]?.id}`, { as: operations });
    expect(gone.status).toBe(200);
    expect(gone.body.links).toEqual([expect.objectContaining({ status: 'closing' })]);
    const twice = await call('DELETE', `/v1/properties/${cottage}/links/${links[0]?.id}`, { as: operations });
    expect(twice.status).toBe(404);
  });

  it('shows the workspace its own sync picture', async () => {
    const { status, body } = await call('GET', '/v1/channels/sync', { as: operations });
    expect(status).toBe(200);
    expect(body).toMatchObject({ outboxWaiting: expect.any(Number), outboxFailed: expect.any(Number) });
    expect(Array.isArray(body.recent)).toBe(true);
  });

  it("keeps one operator's accounts out of another's workspace", async () => {
    expect((await call('GET', '/v1/channel-accounts', { as: asB() })).body.accounts).toEqual([]);
    expect((await call('GET', `/v1/channel-accounts/${airbnbA}/listings`, { as: asB() })).status).toBe(404);
  });
});
