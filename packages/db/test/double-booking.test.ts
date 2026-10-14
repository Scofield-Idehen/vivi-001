import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiDatabase, blocks, occupancies, reservations, type Tx } from '../src/index.ts';
import { createTestDatabase, seedOperator, type TestDatabase } from '../src/testing.ts';
import { expectPgError, insertProperty, PG } from './helpers.ts';

/**
 * Playbook, Section 16: "An exclusion constraint on property and date range covers
 * confirmed reservations and blocks. Postgres rejects any overlap, whatever the code does."
 */

let t: TestDatabase;
let api: ApiDatabase;
let op: { orgId: string; userId: string };

beforeAll(async () => {
  t = await createTestDatabase();
  op = await seedOperator(t.ownerUrl, { name: 'Operator', slug: 'operator', userEmail: 'ops@example.test' });
  api = new ApiDatabase(t.apiUrl);
});

afterAll(async () => {
  await api?.close();
  await t?.drop();
});

function inScope<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return api.withOrg({ orgId: op.orgId, userId: op.userId }, fn);
}

function newProperty(name = 'Mill Street Flat'): Promise<string> {
  return inScope((tx) => insertProperty(tx, op.orgId, name));
}

function book(
  propertyId: string,
  checkIn: string,
  checkOut: string,
  status: 'confirmed' | 'cancelled' | 'conflict' = 'confirmed',
): Promise<string> {
  return inScope(async (tx) => {
    const [row] = await tx
      .insert(reservations)
      .values({ organisationId: op.orgId, propertyId, channel: 'direct', status, checkIn, checkOut })
      .returning({ id: reservations.id });
    return row!.id;
  });
}

describe('double-booking guard', () => {
  it('refuses two confirmed stays that share a night', async () => {
    const p = await newProperty();
    await book(p, '2026-11-10', '2026-11-14');
    await expectPgError(book(p, '2026-11-13', '2026-11-16'), PG.exclusionViolation);
  });

  it('allows a departure and an arrival on the same day', async () => {
    const p = await newProperty();
    await book(p, '2026-11-10', '2026-11-14');
    await expect(book(p, '2026-11-14', '2026-11-16')).resolves.toBeTypeOf('string');
  });

  it('ignores cancelled bookings and bookings parked as conflicts', async () => {
    const p = await newProperty();
    await book(p, '2026-12-01', '2026-12-05', 'cancelled');
    await book(p, '2026-12-01', '2026-12-05', 'conflict');
    await expect(book(p, '2026-12-01', '2026-12-05')).resolves.toBeTypeOf('string');
  });

  it('frees the nights when a booking is cancelled', async () => {
    const p = await newProperty();
    const id = await book(p, '2027-01-10', '2027-01-12');
    await inScope((tx) =>
      tx.update(reservations).set({ status: 'cancelled' }).where(eq(reservations.id, id)),
    );
    await expect(book(p, '2027-01-10', '2027-01-12')).resolves.toBeTypeOf('string');
  });

  it('refuses moving a booking onto nights that are taken', async () => {
    const p = await newProperty();
    await book(p, '2027-02-01', '2027-02-05');
    const second = await book(p, '2027-02-10', '2027-02-12');
    await expectPgError(
      inScope((tx) =>
        tx.update(reservations).set({ checkIn: '2027-02-04' }).where(eq(reservations.id, second)),
      ),
      PG.exclusionViolation,
    );
  });

  it('refuses a block over a confirmed stay, and a stay over a block', async () => {
    const p = await newProperty();
    await book(p, '2027-03-01', '2027-03-04');
    await expectPgError(
      inScope((tx) =>
        tx
          .insert(blocks)
          .values({ organisationId: op.orgId, propertyId: p, startsOn: '2027-03-03', endsOn: '2027-03-06' }),
      ),
      PG.exclusionViolation,
    );
    await inScope((tx) =>
      tx
        .insert(blocks)
        .values({ organisationId: op.orgId, propertyId: p, startsOn: '2027-03-10', endsOn: '2027-03-12' }),
    );
    await expectPgError(book(p, '2027-03-11', '2027-03-13'), PG.exclusionViolation);
  });

  it('keeps different properties independent', async () => {
    const p1 = await newProperty('Orchard Cottage');
    const p2 = await newProperty('The Granary');
    await book(p1, '2027-04-01', '2027-04-05');
    await expect(book(p2, '2027-04-01', '2027-04-05')).resolves.toBeTypeOf('string');
  });

  it('keeps the calendar holds in step with bookings and blocks', async () => {
    const p = await newProperty();
    const id = await book(p, '2027-05-01', '2027-05-03');
    const rows = await inScope((tx) => tx.select().from(occupancies).where(eq(occupancies.sourceId, id)));
    expect(rows.map((r) => r.nights)).toEqual(['[2027-05-01,2027-05-03)']);
  });
});
