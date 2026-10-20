import { WorkerDatabase } from '@v01/db';
import { createTestDatabase, seedOperator, type TestDatabase } from '@v01/db/testing';
import { MemoryEmailSender } from '@v01/integrations';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { silentLogger } from '../src/deps.ts';
import { makeAutomaticMessages, sendQueuedMessages } from '../src/inbox.ts';

/**
 * The Inbox's worker side: automatic messages at their moment, once each; sending by email for
 * direct guests, and waiting, with the reason kept, for everything there is nothing to send with yet.
 */

let t: TestDatabase;
let worker: WorkerDatabase;
let op: { orgId: string; userId: string };
let lodge: string;

async function owner<T extends pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> {
  const client = new pg.Client({ connectionString: t.ownerUrl });
  await client.connect();
  try {
    return (await client.query<T>(text, values)).rows;
  } finally {
    await client.end();
  }
}

const at = (iso: string) => ({ db: worker, log: silentLogger, now: () => new Date(iso) });

async function booking(
  channel: string,
  checkIn: string,
  checkOut: string,
  guest: { name: string; email?: string; phone?: string },
) {
  const [g] = await owner<{ id: string }>(
    `insert into app.guests (organisation_id, full_name, email, phone) values ($1, $2, $3, $4) returning id`,
    [op.orgId, guest.name, guest.email ?? null, guest.phone ?? null],
  );
  const [r] = await owner<{ id: string; guest_key: string }>(
    `insert into app.reservations (organisation_id, property_id, channel, status, check_in, check_out, guest_id, adults, check_in_time, created_at)
     values ($1, $2, $3, 'confirmed', $4, $5, $6, 2, '16:00', '2026-10-20T08:00:00Z') returning id, guest_key`,
    [op.orgId, lodge, channel, checkIn, checkOut, g!.id],
  );
  return r!;
}

const messagesOf = (reservationId: string) =>
  owner<{
    via: string;
    status: string;
    note: string | null;
    body: string;
    automatic: boolean;
    external_id: string | null;
  }>(
    `select m.via, m.status, m.note, m.body, m.automatic, m.external_id
       from app.messages m join app.message_threads th on th.id = m.thread_id
      where th.reservation_id = $1 order by m.created_at, m.id`,
    [reservationId],
  );

beforeAll(async () => {
  t = await createTestDatabase();
  op = await seedOperator(t.ownerUrl, {
    name: 'Northwind Stays',
    slug: 'northwind',
    userEmail: 'ops@example.test',
  });
  worker = new WorkerDatabase(t.workerUrl);
  await owner(
    `update app.organisation_brand set sender_email = 'hello@northwind.example' where organisation_id = $1`,
    [op.orgId],
  );
  const [p] = await owner<{ id: string }>(
    `insert into app.properties (organisation_id, name, country_code, max_guests, managed_by, check_in_time, check_out_time)
     values ($1, 'Harbour View Lodge', 'GB', 4, 'v01', '15:00', '10:00') returning id`,
    [op.orgId],
  );
  lodge = p!.id;
});

afterAll(async () => {
  await worker?.close();
  await t?.drop();
});

describe('automatic messages', () => {
  it('confirms a new direct booking at once, with the guest’s page, and only once', async () => {
    const mia = await booking('direct', '2026-11-05', '2026-11-08', {
      name: 'Mia Direct',
      email: 'mia@guest.example',
    });
    expect(await makeAutomaticMessages(at('2026-10-20T09:00:00Z'), { appUrl: 'https://app.example' })).toBe(
      1,
    );
    const [m] = await messagesOf(mia.id);
    expect(m).toMatchObject({ via: 'email', status: 'queued', automatic: true });
    expect(m?.body).toContain('Hi Mia,');
    expect(m?.body).toContain('Thursday 5 November to Sunday 8 November, 3 nights');
    expect(m?.body).toContain(`https://app.example/stay/${mia.guest_key}`);
    expect(m?.body).toContain('Northwind Stays');
    expect(await makeAutomaticMessages(at('2026-10-20T09:05:00Z'), { appUrl: 'https://app.example' })).toBe(
      0,
    );
  });

  it('writes the day-before and the check-out notes at their time, where the operator is', async () => {
    const noah = await booking('airbnb', '2026-10-21', '2026-10-23', { name: 'Noah Air' });
    // 09:30 in London on the 20th: the confirmation goes (into the Airbnb chat); the 10:00 note waits for its time.
    expect(await makeAutomaticMessages(at('2026-10-20T08:30:00Z'))).toBe(1);
    expect((await messagesOf(noah.id)).map((m) => [m.via, m.status])).toEqual([['airbnb', 'queued']]);
    // 10:15 London: the day-before note is due.
    expect(await makeAutomaticMessages(at('2026-10-20T09:15:00Z'))).toBe(1);
    const second = (await messagesOf(noah.id))[1];
    expect(second?.body).toContain('You arrive tomorrow. Check-in at Harbour View Lodge is from 16:00.');
    // The day of arrival is switched off by default; the check-out note comes the evening before leaving.
    expect(await makeAutomaticMessages(at('2026-10-21T10:00:00Z'))).toBe(0);
    expect(await makeAutomaticMessages(at('2026-10-22T16:30:00Z'))).toBe(1);
    expect((await messagesOf(noah.id))[2]?.body).toContain('check-out tomorrow is by 10:00');
    expect(await makeAutomaticMessages(at('2026-10-22T18:00:00Z'))).toBe(0);
  });

  it('leaves a guest with no way to reach them, and a cancelled booking, alone', async () => {
    const nobody = await booking('direct', '2026-12-01', '2026-12-03', { name: 'No Contact' });
    const gone = await booking('direct', '2026-12-05', '2026-12-07', {
      name: 'Gone Guest',
      email: 'gone@guest.example',
    });
    await owner(`update app.reservations set status = 'cancelled', cancelled_at = now() where id = $1`, [
      gone.id,
    ]);
    expect(await makeAutomaticMessages(at('2026-10-20T12:00:00Z'))).toBe(0);
    expect(await messagesOf(nobody.id)).toEqual([]);
    expect(await messagesOf(gone.id)).toEqual([]);
  });
});

describe('sending', () => {
  it('waits, saying why, when there is nothing to send with; then sends by email once there is', async () => {
    const nothing = await sendQueuedMessages({ db: worker, log: silentLogger }, {});
    expect(nothing).toEqual({ sent: 0, waiting: 4, failed: 0 });
    const [mia] = await owner<{ via: string; status: string; note: string }>(
      `select via, status, note from app.messages where via = 'email' order by created_at limit 1`,
    );
    expect(mia).toEqual({
      via: 'email',
      status: 'waiting',
      note: 'No email sender is set up yet. It goes as soon as one is.',
    });
    const [air] = await owner<{ status: string; note: string }>(
      `select status, note from app.messages where via = 'airbnb' order by created_at limit 1`,
    );
    expect(air).toEqual({
      status: 'waiting',
      note: 'The Airbnb chat is not connected yet; it goes through Channex once it is.',
    });

    const email = new MemoryEmailSender();
    const sent = await sendQueuedMessages(
      { db: worker, log: silentLogger },
      { email, from: 'hello@v01.example' },
    );
    expect(sent).toEqual({ sent: 1, waiting: 3, failed: 0 });
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]).toMatchObject({
      to: 'mia@guest.example',
      from: 'Northwind Stays <hello@v01.example>',
      replyTo: 'hello@northwind.example',
      subject: 'Your stay at Harbour View Lodge',
    });
    const [done] = await owner<{ status: string; note: string | null; external_id: string }>(
      `select status, note, external_id from app.messages where via = 'email' order by created_at limit 1`,
    );
    expect(done).toEqual({ status: 'sent', note: null, external_id: 'mem-1' });
    // Again: nothing goes twice.
    expect(
      (await sendQueuedMessages({ db: worker, log: silentLogger }, { email, from: 'hello@v01.example' }))
        .sent,
    ).toBe(0);
  });

  it('keeps the reason when the email service refuses one', async () => {
    await booking('direct', '2026-12-10', '2026-12-12', { name: 'Bad Address', email: 'bad@guest.example' });
    await makeAutomaticMessages(at('2026-10-20T12:00:00Z'));
    const email = new MemoryEmailSender();
    email.failWith = 'The bad@guest.example address is not valid.';
    const result = await sendQueuedMessages(
      { db: worker, log: silentLogger },
      { email, from: 'hello@v01.example' },
    );
    expect(result.failed).toBe(1);
    const [m] = await owner<{ status: string; note: string }>(
      `select status, note from app.messages where status = 'failed'`,
    );
    expect(m).toEqual({ status: 'failed', note: 'The bad@guest.example address is not valid.' });
  });
});
