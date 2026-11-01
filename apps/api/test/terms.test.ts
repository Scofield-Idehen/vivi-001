import { ApiDatabase } from '@v01/db';
import { createTestDatabase, seedOperator, type TestDatabase } from '@v01/db/testing';
import type { FastifyInstance } from 'fastify';
import { SignJWT } from 'jose';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { createTokenVerifier } from '../src/auth.ts';
import { loadEnv } from '../src/env.ts';

/**
 * Each home's terms and an owner's month from the payout (1 Nov 2026), worked out by hand.
 *
 * Lodge, 18% from October: a stay of £600 paid out at £510, with £60 cleaning inside; the cleaning's
 * share of the payout is £51, so the stay brought in £459; a £20 stay refund leaves £439; a £30
 * cleaning refund is the company's. Fee 18% of £439 = £79.02; the owner's part £359.98.
 * Flat, no fee (a board member): a direct £400 stay with no payout recorded: £400 to the owner.
 * Barn, fixed rent £1,300: no stays, still £1,300.
 * A £90 repair at the Lodge charged to the owner, and £150 of claim money for it paid back (up to
 * the £90 they paid). Due: 359.98 + 400 + 1,300 − 90 + 90 = £2,059.98.
 */

const JWT_SECRET = 'test-only-jwt-secret-with-enough-length';

let t: TestDatabase;
let db: ApiDatabase;
let app: FastifyInstance;
let a: { orgId: string; userId: string };
let ops: Who;
let accounts: Who;
let ellis: string;
let lodge: string;
let flat: string;
let barn: string;
let lodgeStay: string;

type Who = { userId: string; email: string; orgId: string };
const admin = (): Who => ({ ...a, email: 'admin-a@example.test' });

async function call(method: string, url: string, as: Who, body?: unknown) {
  const jwt = await new SignJWT({ email: as.email, role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(as.userId)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const r = await app.inject({
    method: method as 'GET',
    url,
    headers: { authorization: `Bearer ${jwt}`, 'x-org-id': as.orgId },
    ...(body === undefined ? {} : { payload: body as object }),
  });
  // biome-ignore lint/suspicious/noExplicitAny: tests read bodies loosely
  return { status: r.statusCode, body: r.body ? (r.json() as any) : null };
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

async function member(email: string, role: string): Promise<Who> {
  const [u] = await owner<{ id: string }>(
    `insert into app.app_users (id, email) values (gen_random_uuid(), $1) returning id`,
    [email],
  );
  await owner(`insert into app.memberships (organisation_id, user_id, role) values ($1, $2, $3)`, [
    a.orgId,
    u!.id,
    role,
  ]);
  return { orgId: a.orgId, userId: u!.id, email };
}

beforeAll(async () => {
  t = await createTestDatabase();
  a = await seedOperator(t.ownerUrl, {
    name: 'Operator A',
    slug: 'operator-a',
    userEmail: 'admin-a@example.test',
  });
  ops = await member('ops@example.test', 'operations');
  accounts = await member('accounts@example.test', 'accounts');
  const [o] = await owner<{ id: string }>(
    `insert into app.owners (organisation_id, name, fee_basis_points) values ($1, 'Ellis', 2000) returning id`,
    [a.orgId],
  );
  ellis = o!.id;
  for (const name of ['Lodge', 'Flat', 'Barn']) {
    const [p] = await owner<{ id: string }>(
      `insert into app.properties (organisation_id, name, country_code, max_guests, owner_id) values ($1, $2, 'GB', 4, $3) returning id`,
      [a.orgId, name, ellis],
    );
    if (name === 'Lodge') lodge = p!.id;
    else if (name === 'Flat') flat = p!.id;
    else barn = p!.id;
  }
  const [r1] = await owner<{ id: string }>(
    `insert into app.reservations (organisation_id, property_id, channel, status, check_in, check_out, adults, currency, total_minor, payout_minor, cleaning_minor)
     values ($1, $2, 'airbnb', 'confirmed', '2026-10-10', '2026-10-15', 2, 'GBP', 60000, 51000, 6000) returning id`,
    [a.orgId, lodge],
  );
  lodgeStay = r1!.id;
  await owner(
    `insert into app.reservations (organisation_id, property_id, channel, status, check_in, check_out, adults, currency, total_minor)
     values ($1, $2, 'direct', 'confirmed', '2026-10-20', '2026-10-24', 2, 'GBP', 40000)`,
    [a.orgId, flat],
  );
  db = new ApiDatabase(t.apiUrl);
  app = await buildApp({
    env: loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: t.apiUrl,
      SUPABASE_JWT_SECRET: JWT_SECRET,
      FIELD_SECRET_KEY: 'test-only-field-secret-key-with-enough-length',
    }),
    db,
    verifyToken: createTokenVerifier({ jwtSecret: JWT_SECRET }),
    now: () => new Date('2026-11-01T10:00:00Z'),
  });
});

afterAll(async () => {
  await app?.close();
  await db?.close();
  await t?.drop();
});

describe('contracts and terms', () => {
  it('starts with nothing set up', async () => {
    const r = await call('GET', `/v1/owners/${ellis}/setup`, admin());
    expect(r.status).toBe(200);
    expect(r.body.missing).toEqual({ contract: true, homesWithoutTerms: 3, homesWithoutPayee: 3 });
    const list = (await call('GET', '/v1/owners', admin())).body.owners[0];
    expect(list.setup).toEqual({ contract: false, homesWithoutTerms: 3 });
  });

  it('keeps a contract and each home’s terms from a month', async () => {
    const c = await call('POST', `/v1/owners/${ellis}/contracts`, admin(), {
      title: 'Management agreement',
      signedOn: '2026-01-05',
      startsOn: '2026-01-05',
      endsOn: '2027-01-04',
    });
    expect(c.status).toBe(201);
    const contractId = c.body.id;
    expect(
      (
        await call('PUT', `/v1/properties/${lodge}/terms`, admin(), {
          from: '2026-10',
          deal: 'percentage',
          feeBasisPoints: 1800,
          maintenanceBy: 'company',
          contractId,
        })
      ).status,
    ).toBe(200);
    // A later change doesn't touch October.
    await call('PUT', `/v1/properties/${lodge}/terms`, admin(), {
      from: '2026-12',
      deal: 'percentage',
      feeBasisPoints: 2500,
      maintenanceBy: 'company',
    });
    await call('PUT', `/v1/properties/${flat}/terms`, admin(), {
      from: '2026-01',
      deal: 'no_fee',
      maintenanceBy: 'owner',
    });
    await call('PUT', `/v1/properties/${barn}/terms`, admin(), {
      from: '2026-01',
      deal: 'fixed_rent',
      rentMinor: 130000,
      maintenanceBy: 'company',
    });
    const bad = await call('PUT', `/v1/properties/${barn}/terms`, admin(), {
      from: '2026-01',
      deal: 'fixed_rent',
      maintenanceBy: 'company',
    });
    expect(bad.status).toBe(400);
    const s = (await call('GET', `/v1/owners/${ellis}/setup`, admin())).body;
    expect(s.missing).toMatchObject({ contract: false, homesWithoutTerms: 0 });
    const lodgeRow = s.homes.find((h: { id: string }) => h.id === lodge);
    expect(lodgeRow.terms).toMatchObject({
      from: '2026-10',
      deal: 'percentage',
      feeBasisPoints: 1800,
      contractId,
    });
    expect(lodgeRow.history.map((h: { from: string }) => h.from)).toEqual(['2026-12', '2026-10']);
  });

  it('keeps bank details sealed, for admins and accounts only', async () => {
    const r = await call('PUT', `/v1/properties/${lodge}/payee`, accounts, {
      payeeName: 'Ellis Holdings',
      sortCode: '12-34-56',
      accountNumber: '12345678',
      reference: 'LODGE',
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      payeeName: 'Ellis Holdings',
      reference: 'LODGE',
      accountHint: '5678',
      hasBank: true,
    });
    const [raw] = await owner<{ sealed: Buffer }>('select bank_sealed as sealed from app.home_payees');
    expect(raw!.sealed.toString('latin1')).not.toContain('12345678');
    expect((await call('GET', `/v1/properties/${lodge}/payee/bank`, accounts)).body).toEqual({
      sortCode: '123456',
      accountNumber: '12345678',
    });
    expect((await call('GET', `/v1/properties/${lodge}/payee/bank`, ops)).status).toBe(403);
    expect((await call('PUT', `/v1/properties/${lodge}/payee`, ops, { payeeName: 'X' })).status).toBe(403);
    const seen = (await call('GET', `/v1/owners/${ellis}/setup`, ops)).body;
    expect(seen.homes.every((h: { payee: unknown }) => h.payee === null)).toBe(true);
    expect(seen.missing.homesWithoutPayee).toBeNull();
  });
});

describe('the owner’s month, from the payout', () => {
  it('asks what a refund was for', async () => {
    const r = await call('POST', `/v1/reservations/${lodgeStay}/payments`, admin(), {
      amountMinor: -2000,
      method: 'channel',
      paidOn: '2026-10-16',
    });
    expect(r.status).toBe(400);
    for (const [amountMinor, refundFor] of [
      [-2000, 'stay'],
      [-3000, 'cleaning'],
    ] as const) {
      expect(
        (
          await call('POST', `/v1/reservations/${lodgeStay}/payments`, admin(), {
            amountMinor,
            method: 'channel',
            paidOn: '2026-10-16',
            refundFor,
          })
        ).status,
      ).toBe(201);
    }
  });

  it('takes off the channel fee, the cleaning and stay refunds, then follows each home’s deal', async () => {
    const [c] = await owner<{ id: string }>(
      `insert into app.claims (organisation_id, reservation_id, place, deadline) values ($1, $2, 'airbnb', '2026-10-29') returning id`,
      [a.orgId, lodgeStay],
    );
    await owner(
      `insert into app.expenses (organisation_id, property_id, claim_id, spent_on, category, description, amount_minor, currency, charge_to)
       values ($1, $2, $3, '2026-10-16', 'repairs', 'Table', 9000, 'GBP', 'owner')`,
      [a.orgId, lodge, c!.id],
    );
    expect(
      (
        await call('PATCH', `/v1/claims/${c!.id}`, admin(), {
          receivedMinor: 15000,
          receivedOn: '2026-10-29',
        })
      ).status,
    ).toBe(200);
    const m = (await call('GET', `/v1/owners/${ellis}/month?month=2026-10`, admin())).body;
    const home = (id: string) => m.homes.find((h: { id: string }) => h.id === id);
    expect(home(lodge)).toMatchObject({
      deal: 'percentage',
      feeBasisPoints: 1800,
      grossMinor: 60000,
      channelFeesMinor: 9000,
      cleaningMinor: 5100,
      refundsMinor: 2000,
      earnedMinor: 43900,
      feeMinor: 7902,
      ownerShareMinor: 35998,
      expensesMinor: 9000,
    });
    expect(home(flat)).toMatchObject({
      deal: 'no_fee',
      earnedMinor: 40000,
      feeMinor: 0,
      ownerShareMinor: 40000,
    });
    expect(home(barn)).toMatchObject({
      deal: 'fixed_rent',
      earnedMinor: 0,
      rentMinor: 130000,
      ownerShareMinor: 130000,
    });
    expect(m).toMatchObject({
      ownerShareMinor: 205998,
      expensesMinor: 9000,
      claimCreditsMinor: 9000,
      netMinor: 205998,
    });
    expect(m.claimCredits).toEqual([
      { claimId: c!.id, propertyName: 'Lodge', receivedOn: '2026-10-29', creditMinor: 9000 },
    ]);
  });

  it('keeps a finalised month as it was', async () => {
    expect((await call('POST', `/v1/owners/${ellis}/statements`, admin(), { month: '2026-10' })).status).toBe(
      201,
    );
    await call('PUT', `/v1/properties/${barn}/terms`, admin(), {
      from: '2026-10',
      deal: 'fixed_rent',
      rentMinor: 150000,
      maintenanceBy: 'company',
    });
    expect((await call('GET', `/v1/owners/${ellis}/month?month=2026-10`, admin())).body.netMinor).toBe(
      205998,
    );
  });
});

describe('what a job cost', () => {
  async function job(home: string, kind: string, title: string) {
    const [k] = await owner<{ id: string }>(
      `insert into app.tasks (organisation_id, property_id, kind, title, due_on) values ($1, $2, $3, $4, '2026-11-01') returning id`,
      [a.orgId, home, kind, title],
    );
    return k!.id;
  }
  const costOf = async (task: string) =>
    owner<{ amount: number; charge_to: string; category: string }>(
      'select amount_minor::int as amount, charge_to, category from app.expenses where task_id = $1',
      [task],
    );

  it('logs a clean at the home’s cleaning cost, as the company’s', async () => {
    expect(
      (await call('PUT', `/v1/properties/${lodge}/cleaning-cost`, admin(), { cleaningCostMinor: 4500 }))
        .status,
    ).toBe(200);
    const k = await job(lodge, 'cleaning', 'Clean after check-out');
    await call('PATCH', `/v1/tasks/${k}`, admin(), { status: 'done' });
    expect(await costOf(k)).toEqual([{ amount: 4500, charge_to: 'company', category: 'cleaning' }]);
  });

  it('charges a repair by the home’s terms, and takes it back off when the job is reopened', async () => {
    const lodgeJob = await job(lodge, 'maintenance', 'Fix the tap');
    expect((await call('PATCH', `/v1/tasks/${lodgeJob}`, admin(), { costMinor: 12000 })).status).toBe(200);
    await call('PATCH', `/v1/tasks/${lodgeJob}`, admin(), { status: 'done' });
    expect(await costOf(lodgeJob)).toEqual([{ amount: 12000, charge_to: 'owner', category: 'repairs' }]);
    await call('PATCH', `/v1/tasks/${lodgeJob}`, admin(), { costMinor: 13000 });
    expect((await costOf(lodgeJob))[0]?.amount).toBe(13000);
    await call('PATCH', `/v1/tasks/${lodgeJob}`, admin(), { status: 'open' });
    expect(await costOf(lodgeJob)).toEqual([]);

    const barnJob = await job(barn, 'maintenance', 'Fix the gate');
    await call('PATCH', `/v1/tasks/${barnJob}`, admin(), { costMinor: 5000, status: 'done' });
    expect(await costOf(barnJob)).toEqual([{ amount: 5000, charge_to: 'company', category: 'repairs' }]);

    const flatJob = await job(flat, 'maintenance', 'Fix the window');
    await call('PATCH', `/v1/tasks/${flatJob}`, admin(), { costMinor: 7000, status: 'done' });
    expect(await costOf(flatJob)).toEqual([]);
  });
});
