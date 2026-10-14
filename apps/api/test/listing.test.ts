import { ApiDatabase } from '@v01/db';
import { createTestDatabase, seedOperator, type TestDatabase } from '@v01/db/testing';
import type { FastifyInstance } from 'fastify';
import { SignJWT } from 'jose';
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

const asA = (): Who => ({ ...a, email: 'admin-a@example.test' });
const asB = (): Who => ({ ...b, email: 'admin-b@example.test' });
const env = () => loadEnv({ NODE_ENV: 'test', DATABASE_URL: t.apiUrl, SUPABASE_JWT_SECRET: JWT_SECRET });

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
