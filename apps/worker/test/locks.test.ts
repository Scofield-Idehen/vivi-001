import { WorkerDatabase } from '@v01/db';
import { createTestDatabase, seedOperator, type TestDatabase } from '@v01/db/testing';
import { MemoryLockProvider, SecretBox } from '@v01/integrations';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { silentLogger } from '../src/deps.ts';
import { syncDoorCodes } from '../src/locks.ts';

/**
 * Door codes: one per stay on every lock of the home, a day code per job, windows that follow the
 * booking, codes off the lock when a stay is cancelled, and refusals tried again.
 */

let t: TestDatabase;
let worker: WorkerDatabase;
let op: { orgId: string; userId: string };
let lodge: string;
let front: string;
let back: string;
const box = new SecretBox('k'.repeat(40));
const ttlock = new MemoryLockProvider();
const deps = { provider: ttlock, box };

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

const codes = () =>
  owner<{
    id: string;
    lock_id: string;
    reservation_id: string | null;
    task_id: string | null;
    status: string;
    starts_at: Date;
    ends_at: Date;
    code_sealed: Buffer;
    provider_code_id: string | null;
    error: string | null;
    attempts: number;
  }>(
    `select id, lock_id, reservation_id, task_id, status, starts_at, ends_at, code_sealed, provider_code_id, error, attempts
       from app.lock_codes order by created_at, lock_id`,
  );

async function stay(checkIn: string, checkOut: string, name = 'Claire Dubois') {
  const [g] = await owner<{ id: string }>(
    `insert into app.guests (organisation_id, full_name) values ($1, $2) returning id`,
    [op.orgId, name],
  );
  const [r] = await owner<{ id: string }>(
    `insert into app.reservations (organisation_id, property_id, channel, status, check_in, check_out, guest_id, adults, check_in_time)
     values ($1, $2, 'airbnb', 'confirmed', $3, $4, $5, 2, '16:00') returning id`,
    [op.orgId, lodge, checkIn, checkOut, g!.id],
  );
  return r!.id;
}

beforeAll(async () => {
  t = await createTestDatabase();
  op = await seedOperator(t.ownerUrl, {
    name: 'Northwind Stays',
    slug: 'northwind',
    userEmail: 'ops@example.test',
  });
  worker = new WorkerDatabase(t.workerUrl);
  const [p] = await owner<{ id: string }>(
    `insert into app.properties (organisation_id, name, country_code, max_guests, managed_by, check_in_time, check_out_time)
     values ($1, 'Harbour View Lodge', 'GB', 4, 'v01', '15:00', '10:00') returning id`,
    [op.orgId],
  );
  lodge = p!.id;
  const token = { accessToken: 'a', refreshToken: 'r', expiresAt: '2099-01-01T00:00:00Z', uid: '1' };
  const [account] = await owner<{ id: string }>(
    `insert into app.lock_accounts (organisation_id, username, token_sealed, synced_at)
     values ($1, 'locks@northwind.test', $2, now()) returning id`,
    [op.orgId, box.seal(JSON.stringify(token))],
  );
  const made = await owner<{ id: string }>(
    `insert into app.locks (organisation_id, account_id, provider_lock_id, name, property_id, has_gateway, makes_codes)
     values ($1, $2, '1001', 'Front door', $3, true, true), ($1, $2, '1002', 'Back door', $3, true, true)
     returning id`,
    [op.orgId, account!.id, lodge],
  );
  front = made[0]!.id;
  back = made[1]!.id;
});

afterAll(async () => {
  await worker?.close();
  await t?.drop();
});

describe('door codes', () => {
  it('gives a stay one code on every lock of the home, from check-in to just after check-out', async () => {
    const id = await stay('2026-11-05', '2026-11-08');
    const stats = await syncDoorCodes(at('2026-11-01T09:00:00Z'), deps);
    expect(stats).toMatchObject({ added: 2, failed: 0 });
    const rows = (await codes()).filter((c) => c.reservation_id === id);
    expect(rows.map((r) => r.status)).toEqual(['set', 'set']);
    expect(new Set(rows.map((r) => r.lock_id))).toEqual(new Set([front, back]));
    const digits = rows.map((r) => box.open(r.code_sealed));
    expect(digits[0]).toMatch(/^[1-9]\d{5}$/);
    expect(digits[1]).toBe(digits[0]);
    // 16:00 London on 5 Nov (GMT) to 10:30 on 8 Nov.
    expect(rows[0]?.starts_at.toISOString()).toBe('2026-11-05T16:00:00.000Z');
    expect(rows[0]?.ends_at.toISOString()).toBe('2026-11-08T10:30:00.000Z');
    const onLock = [...ttlock.codes.values()].filter((c) => c.code === digits[0]);
    expect(onLock.map((c) => c.lockId).sort()).toEqual(['1001', '1002']);
    expect(onLock[0]?.name).toBe('V-01 · Claire Dubois · 05 Nov');
  });

  it('runs again without sending anything twice', async () => {
    const before = ttlock.calls.length;
    const stats = await syncDoorCodes(at('2026-11-01T09:05:00Z'), deps);
    expect(stats).toMatchObject({ added: 0, changed: 0, removed: 0 });
    expect(ttlock.calls.length).toBe(before);
  });

  it('moves the window when the booking’s dates change, and takes the code off when it is cancelled', async () => {
    const id = await stay('2026-11-10', '2026-11-12', 'Leo Hartmann');
    await syncDoorCodes(at('2026-11-01T10:00:00Z'), deps);
    await owner(`update app.reservations set check_out = '2026-11-13' where id = $1`, [id]);
    expect(await syncDoorCodes(at('2026-11-01T10:05:00Z'), deps)).toMatchObject({ changed: 2 });
    const moved = (await codes()).filter((c) => c.reservation_id === id);
    expect(moved[0]?.ends_at.toISOString()).toBe('2026-11-13T10:30:00.000Z');
    expect(ttlock.codes.get(moved[0]!.provider_code_id!)?.endsAt.toISOString()).toBe(
      '2026-11-13T10:30:00.000Z',
    );

    await owner(`update app.reservations set status = 'cancelled' where id = $1`, [id]);
    expect(await syncDoorCodes(at('2026-11-01T10:10:00Z'), deps)).toMatchObject({ removed: 2 });
    const gone = (await codes()).filter((c) => c.reservation_id === id);
    expect(gone.map((c) => c.status)).toEqual(['removed', 'removed']);
    for (const c of gone) expect(ttlock.codes.has(c.provider_code_id!)).toBe(false);
  });

  it('gives a job a code for its day only', async () => {
    const [task] = await owner<{ id: string }>(
      `insert into app.tasks (organisation_id, property_id, kind, title, due_on) values ($1, $2, 'cleaning', 'Clean', '2026-11-02') returning id`,
      [op.orgId, lodge],
    );
    await syncDoorCodes(at('2026-11-01T11:00:00Z'), deps);
    const job = (await codes()).filter((c) => c.task_id === task!.id);
    expect(job).toHaveLength(2);
    expect(job[0]?.starts_at.toISOString()).toBe('2026-11-02T07:00:00.000Z');
    expect(job[0]?.ends_at.toISOString()).toBe('2026-11-02T22:00:00.000Z');
  });

  it('keeps a refused code, says why, and sends it when the lock answers', async () => {
    const id = await stay('2026-11-20', '2026-11-22', 'Mina Park');
    // Battery and gateways were just listed, so the first command is the new code.
    await owner(`update app.lock_accounts set synced_at = '2026-11-06T08:30:00Z'`);
    ttlock.fail = 'Gateway is offline';
    expect((await syncDoorCodes(at('2026-11-06T09:00:00Z'), deps)).failed).toBe(1);
    const refused = (await codes()).filter((c) => c.reservation_id === id);
    expect(refused.find((c) => c.status === 'failed')?.error).toBe('Gateway is offline');
    await syncDoorCodes(at('2026-11-06T09:05:00Z'), deps);
    expect((await codes()).filter((c) => c.reservation_id === id).map((c) => c.status)).toEqual([
      'set',
      'set',
    ]);
  });

  it('leaves a lock alone until codes are turned on for it', async () => {
    await owner(`update app.locks set makes_codes = false where id = $1`, [back]);
    const id = await stay('2026-11-25', '2026-11-27', 'Ana Silva');
    await syncDoorCodes(at('2026-11-12T09:00:00Z'), deps);
    const rows = (await codes()).filter((c) => c.reservation_id === id);
    expect(rows.map((r) => r.lock_id)).toEqual([front]);
  });

  it('marks the account when TTLock refuses the sign-in', async () => {
    await owner(`update app.lock_accounts set token_sealed = $1`, [Buffer.from('not sealed with this key')]);
    await syncDoorCodes(at('2026-11-12T10:00:00Z'), deps);
    const [account] = await owner<{ status: string; last_error: string }>(
      `select status, last_error from app.lock_accounts`,
    );
    expect(account?.status).toBe('error');
    expect(account?.last_error).toMatch(/Connect the account again/);
  });
});
