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

/**
 * Claims: one per booking, the deadline worked out from the channel, the team's photos from the
 * cleans before and after the stay, files kept as uploaded, and nothing seen across operators.
 * Fixed dates throughout, so the result never depends on the day the tests run.
 */

const JWT_SECRET = 'test-only-jwt-secret-with-enough-length';
const NOW = new Date('2026-10-20T10:00:00Z');

let t: TestDatabase;
let db: ApiDatabase;
let app: FastifyInstance;
let a: { orgId: string; userId: string };
let b: { orgId: string; userId: string };
let lodge: string;
let airbnbStay: string;
let bookingStay: string;
let crew: Who;
const files = new MemoryPhotoStore();

type Who = { userId: string; email: string; orgId: string };
const asA = (): Who => ({ ...a, email: 'admin-a@example.test' });
const asB = (): Who => ({ ...b, email: 'admin-b@example.test' });

async function call(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, as: Who, body?: unknown) {
  const jwt = await new SignJWT({ email: as.email, role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(as.userId)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const r = await app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${jwt}`, 'x-org-id': as.orgId },
    payload: body as never,
  });
  // biome-ignore lint/suspicious/noExplicitAny: tests read bodies loosely
  return { status: r.statusCode, body: r.json() as any };
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

async function stay(channel: string, checkIn: string, checkOut: string, guest: string): Promise<string> {
  const [g] = await owner<{ id: string }>(
    `insert into app.guests (organisation_id, full_name) values ($1, $2) returning id`,
    [a.orgId, guest],
  );
  const [r] = await owner<{ id: string }>(
    `insert into app.reservations (organisation_id, property_id, channel, status, check_in, check_out, adults, currency, total_minor, guest_id)
     values ($1, $2, $3, 'confirmed', $4, $5, 2, 'GBP', 60000, $6) returning id`,
    [a.orgId, lodge, channel, checkIn, checkOut, g!.id],
  );
  return r!.id;
}

async function job(
  dueOn: string,
  opts: { reservationId?: string; source?: string; notes?: string; kind?: string },
) {
  const [row] = await owner<{ id: string }>(
    `insert into app.tasks (organisation_id, property_id, reservation_id, kind, source, title, notes, due_on, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
    [
      a.orgId,
      lodge,
      opts.reservationId ?? null,
      opts.kind ?? 'cleaning',
      opts.source ?? 'manual',
      opts.source === 'report' ? 'Damage reported' : 'Clean',
      opts.notes ?? null,
      dueOn,
      crew.userId,
    ],
  );
  return row!.id;
}

async function photo(taskId: string, stage: string) {
  await owner(
    `insert into app.task_photos (organisation_id, task_id, storage_path, url, stage, taken_by)
     values ($1, $2, $3, 'https://photos.test/x', $4, $5)`,
    [a.orgId, taskId, `${a.orgId}/tasks/${taskId}/${crypto.randomUUID()}.jpg`, stage, crew.userId],
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
  const [u] = await owner<{ id: string }>(
    `insert into app.app_users (id, email, full_name) values (gen_random_uuid(), 'sam@example.test', 'Sam Cleaner') returning id`,
  );
  await owner(`insert into app.memberships (organisation_id, user_id, role) values ($1, $2, 'field')`, [
    a.orgId,
    u!.id,
  ]);
  crew = { orgId: a.orgId, userId: u!.id, email: 'sam@example.test' };
  const [p] = await owner<{ id: string }>(
    `insert into app.properties (organisation_id, name, country_code, max_guests) values ($1, 'Harbour View Lodge', 'GB', 4) returning id`,
    [a.orgId],
  );
  lodge = p!.id;
  db = new ApiDatabase(t.apiUrl);
  app = await buildApp({
    env: loadEnv({ NODE_ENV: 'test', DATABASE_URL: t.apiUrl, SUPABASE_JWT_SECRET: JWT_SECRET }),
    db,
    verifyToken: createTokenVerifier({ jwtSecret: JWT_SECRET }),
    photos: files,
    now: () => NOW,
  });

  // Airbnb guest 10–15 Oct, the next guest arrives 20 Oct: Airbnb's window closes the day before.
  airbnbStay = await stay('airbnb', '2026-10-10', '2026-10-15', 'Pat Breakage');
  await stay('booking_com', '2026-10-20', '2026-10-22', 'Next Guest');
  // Booking.com guest earlier in the month.
  bookingStay = await stay('booking_com', '2026-10-01', '2026-10-05', 'Lee Spill');

  // The clean before Pat arrived (the home as it was), the clean after, and a damage report from it.
  const before = await job('2026-10-10', {});
  await photo(before, 'after');
  const after = await job('2026-10-15', { reservationId: airbnbStay, source: 'check_out' });
  await photo(after, 'before');
  await photo(after, 'found');
  await job('2026-10-15', {
    reservationId: airbnbStay,
    source: 'report',
    kind: 'maintenance',
    notes: 'Coffee table glass cracked.',
  });
});

afterAll(async () => {
  await app?.close();
  await db?.close();
  await t?.drop();
});

describe('claims', () => {
  let claimId: string;

  it('suggests a claim where the team reported damage', async () => {
    const r = await call('GET', '/v1/claims', asA());
    expect(r.status).toBe(200);
    expect(r.body.suggestions).toEqual([
      expect.objectContaining({
        reservationId: airbnbStay,
        guestName: 'Pat Breakage',
        reports: 1,
        deadline: '2026-10-19',
      }),
    ]);
  });

  it('starts one claim per booking, filed where the booking came from, with the deadline worked out', async () => {
    const r = await call('POST', '/v1/claims', asA(), { reservationId: airbnbStay });
    expect(r.status).toBe(201);
    claimId = r.body.id;
    expect(r.body).toMatchObject({
      status: 'open',
      place: 'airbnb',
      // 14 days after 15 Oct is 29 Oct, but the next guest arrives on 20 Oct.
      deadline: '2026-10-19',
      nextCheckIn: '2026-10-20',
      guestName: 'Pat Breakage',
      claimedMinor: 0,
    });
    // Asking again opens the same one.
    const again = await call('POST', '/v1/claims', asA(), { reservationId: airbnbStay });
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(claimId);

    const other = await call('POST', '/v1/claims', asA(), { reservationId: bookingStay });
    expect(other.body).toMatchObject({ place: 'booking_com', deadline: '2026-10-19' });
  });

  it('warns on Today when a claim being got ready is close to its deadline', async () => {
    const r = await call('GET', '/v1/today', asA());
    const items = (r.body.attention as { id: string; title: string; severity: string }[]).filter((x) =>
      x.id.startsWith('claim:'),
    );
    // Both deadlines (19 Oct) are a day behind "now" (20 Oct).
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ severity: 'urgent', title: "A claim's deadline has passed" });
  });

  it('gathers the photos from before and after the stay, and what the team reported', async () => {
    const r = await call('GET', `/v1/claims/${claimId}`, asA());
    expect(r.body.before).toHaveLength(1);
    expect(r.body.before[0]).toMatchObject({ stage: 'after', taskDay: '2026-10-10', takenBy: 'Sam Cleaner' });
    expect(r.body.after).toHaveLength(2);
    expect(r.body.after[0].url).toMatch(/^https:\/\/photos\.test\/signed\//);
    expect(r.body.reports).toEqual([
      expect.objectContaining({ day: '2026-10-15', what: 'Coffee table glass cracked.', by: 'Sam Cleaner' }),
    ]);
  });

  it('adds what was damaged and totals it', async () => {
    await call('POST', `/v1/claims/${claimId}/items`, asA(), {
      description: 'Coffee table glass',
      amountMinor: 18000,
    });
    const r = await call('POST', `/v1/claims/${claimId}/items`, asA(), {
      description: 'Rug cleaning',
      amountMinor: 6500,
    });
    expect(r.status).toBe(201);
    expect(r.body.claimedMinor).toBe(24500);
    const item = r.body.items[1].id;
    const changed = await call('PATCH', `/v1/claims/${claimId}/items/${item}`, asA(), {
      description: 'Rug deep clean',
      amountMinor: 7000,
    });
    expect(changed.body.claimedMinor).toBe(25000);
    const removed = await call('DELETE', `/v1/claims/${claimId}/items/${item}`, asA());
    expect(removed.body.items).toHaveLength(1);
  });

  it('keeps a receipt exactly as uploaded, once it has landed', async () => {
    const ticket = await call('POST', `/v1/claims/${claimId}/files/uploads`, asA(), {
      contentType: 'application/pdf',
      bytes: 240_000,
    });
    expect(ticket.status).toBe(200);
    expect(ticket.body.path).toMatch(new RegExp(`^${a.orgId}/claims/${claimId}/.+\\.pdf$`));
    const body = {
      path: ticket.body.path,
      kind: 'receipt',
      fileName: 'Glass invoice.pdf',
      contentType: 'application/pdf',
      bytes: 240_000,
    };
    expect((await call('POST', `/v1/claims/${claimId}/files`, asA(), body)).status).toBe(409);
    files.files.add(ticket.body.path);
    const added = await call('POST', `/v1/claims/${claimId}/files`, asA(), body);
    expect(added.status).toBe(201);
    expect(added.body.files).toEqual([
      expect.objectContaining({ kind: 'receipt', fileName: 'Glass invoice.pdf', bytes: 240_000 }),
    ]);
    // A path made up for another claim is refused.
    const wrong = await call('POST', `/v1/claims/${claimId}/files`, asA(), {
      ...body,
      path: `${a.orgId}/claims/${crypto.randomUUID()}/${crypto.randomUUID()}.pdf`,
    });
    expect(wrong.status).toBe(400);
  });

  it('records filing and the outcome, and moves it to done when paid', async () => {
    const filed = await call('PATCH', `/v1/claims/${claimId}`, asA(), {
      status: 'filed',
      filedReference: 'HC-4411',
    });
    expect(filed.body).toMatchObject({ status: 'filed', filedOn: '2026-10-20', filedReference: 'HC-4411' });
    const paid = await call('PATCH', `/v1/claims/${claimId}`, asA(), {
      status: 'paid',
      receivedMinor: 18000,
    });
    expect(paid.body).toMatchObject({ status: 'paid', receivedMinor: 18000 });
    const done = await call('GET', '/v1/claims?view=done', asA());
    expect(done.body.claims.map((c: { id: string }) => c.id)).toContain(claimId);
    expect(done.body.counts).toEqual({ active: 1, done: 1 });
  });

  it('lets the field team see none of it, and keeps claims inside their workspace', async () => {
    expect((await call('GET', '/v1/claims', crew)).status).toBe(403);
    expect((await call('GET', `/v1/claims/${claimId}`, asB())).status).toBe(404);
    expect((await call('PATCH', `/v1/claims/${claimId}`, asB(), { status: 'closed' })).status).toBe(404);
    expect((await call('POST', '/v1/claims', asB(), { reservationId: airbnbStay })).status).toBe(404);
    expect((await call('GET', '/v1/claims', asB())).body).toMatchObject({ claims: [], suggestions: [] });
  });
});
