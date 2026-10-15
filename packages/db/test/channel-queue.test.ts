import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ApiDatabase, blocks, calendarDays, properties } from '../src/index.ts';
import { createTestDatabase, seedOperator, type TestDatabase } from '../src/testing.ts';
import { expectPgError, insertProperty, PG, rawQuery } from './helpers.ts';

/**
 * Migration 0012: the database queues every change for the channels in the same transaction, and
 * only for properties V-01 runs. A property on Guesty, or not connected yet, never queues anything.
 */

let t: TestDatabase;
let api: ApiDatabase;
let op: { orgId: string; userId: string };
let runs: string;
let onGuesty: string;

interface Queued {
  property_id: string;
  kind: string;
  date_from: string;
  date_to: string;
}

const queued = () =>
  rawQuery<Queued>(
    t.ownerUrl,
    `select property_id, kind, date_from::text, date_to::text from app.ari_outbox order by id`,
  );
const scope = () => ({ orgId: op.orgId, userId: op.userId });

beforeAll(async () => {
  t = await createTestDatabase();
  op = await seedOperator(t.ownerUrl, { name: 'Operator', slug: 'operator', userEmail: 'ops@example.test' });
  api = new ApiDatabase(t.apiUrl);
  runs = await api.withOrg(scope(), (tx) => insertProperty(tx, op.orgId, 'Harbour View Lodge'));
  onGuesty = await api.withOrg(scope(), (tx) => insertProperty(tx, op.orgId, 'Mill Street Flat'));
  // Only the move-over step, acting as the owner, hands a property to V-01.
  await rawQuery(t.ownerUrl, `update app.properties set managed_by = 'v01' where id = $1`, [runs]);
});

beforeEach(async () => {
  await rawQuery(t.ownerUrl, 'delete from app.ari_outbox');
});

afterAll(async () => {
  await api?.close();
  await t?.drop();
});

describe('queueing changes for the channels', () => {
  it('queues availability when a block holds nights, and again when it lets them go', async () => {
    const [block] = await api.withOrg(scope(), (tx) =>
      tx
        .insert(blocks)
        .values({ organisationId: op.orgId, propertyId: runs, startsOn: '2026-12-01', endsOn: '2026-12-04' })
        .returning({ id: blocks.id }),
    );
    expect(await queued()).toEqual([
      { property_id: runs, kind: 'availability', date_from: '2026-12-01', date_to: '2026-12-03' },
    ]);
    await api.withOrg(scope(), (tx) => tx.delete(blocks).where(eq(blocks.id, block!.id)));
    expect((await queued()).at(-1)).toEqual({
      property_id: runs,
      kind: 'availability',
      date_from: '2026-12-01',
      date_to: '2026-12-03',
    });
  });

  it("queues both a stay's old nights and its new ones when its dates change", async () => {
    const [stay] = await rawQuery<{ id: string }>(
      t.ownerUrl,
      `insert into app.reservations (organisation_id, property_id, channel, status, check_in, check_out)
       values ($1, $2, 'airbnb', 'confirmed', '2026-12-10', '2026-12-12') returning id`,
      [op.orgId, runs],
    );
    await rawQuery(t.ownerUrl, `update app.reservations set check_out = '2026-12-14' where id = $1`, [
      stay!.id,
    ]);
    expect((await queued()).map((q) => [q.date_from, q.date_to])).toEqual([
      ['2026-12-10', '2026-12-11'],
      ['2026-12-10', '2026-12-11'],
      ['2026-12-10', '2026-12-13'],
    ]);
    // A cancellation releases the nights, so availability goes again.
    await rawQuery(t.ownerUrl, 'delete from app.ari_outbox');
    await rawQuery(t.ownerUrl, `update app.reservations set status = 'cancelled' where id = $1`, [stay!.id]);
    expect((await queued()).map((q) => [q.kind, q.date_from, q.date_to])).toEqual([
      ['availability', '2026-12-10', '2026-12-13'],
    ]);
  });

  it('queues prices and stay rules once per change, however many nights it covers', async () => {
    const nights = Array.from({ length: 30 }, (_, i) => `2027-01-${String(i + 1).padStart(2, '0')}`);
    await api.withOrg(scope(), (tx) =>
      tx
        .insert(calendarDays)
        .values(
          nights.map((night) => ({ organisationId: op.orgId, propertyId: runs, night, priceMinor: 18_000 })),
        ),
    );
    await api.withOrg(scope(), (tx) =>
      tx
        .update(calendarDays)
        .set({ minNights: 3 })
        .where(and(eq(calendarDays.propertyId, runs), eq(calendarDays.night, '2027-01-15'))),
    );
    await api.withOrg(scope(), (tx) => tx.delete(calendarDays).where(eq(calendarDays.propertyId, runs)));
    expect(await queued()).toEqual([
      { property_id: runs, kind: 'restrictions', date_from: '2027-01-01', date_to: '2027-01-30' },
      { property_id: runs, kind: 'restrictions', date_from: '2027-01-15', date_to: '2027-01-15' },
      { property_id: runs, kind: 'restrictions', date_from: '2027-01-01', date_to: '2027-01-30' },
    ]);
  });

  it('queues the whole horizon when the usual price or stay lengths change, and not for other edits', async () => {
    const edit = (changes: Partial<typeof properties.$inferInsert>) =>
      api.withOrg(scope(), (tx) => tx.update(properties).set(changes).where(eq(properties.id, runs)));
    await edit({ title: 'Seaside house with a hot tub' });
    expect(await queued()).toEqual([]);
    await edit({ basePriceMinor: 15_000 });
    await edit({ minNights: 2 });
    const [clock] = await rawQuery<{ today: string }>(t.ownerUrl, 'select current_date::text as today');
    const today = clock!.today;
    const rows = await queued();
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.kind).toBe('restrictions');
      expect(row.date_from < today && row.date_to > today).toBe(true);
    }
  });

  it('queues nothing for a property still on Guesty', async () => {
    await api.withOrg(scope(), async (tx) => {
      await tx.insert(blocks).values({
        organisationId: op.orgId,
        propertyId: onGuesty,
        startsOn: '2026-12-01',
        endsOn: '2026-12-04',
      });
      await tx
        .insert(calendarDays)
        .values({ organisationId: op.orgId, propertyId: onGuesty, night: '2026-12-24', priceMinor: 30_000 });
      await tx.update(properties).set({ basePriceMinor: 12_000 }).where(eq(properties.id, onGuesty));
    });
    expect(await queued()).toEqual([]);
  });

  it('keeps the queueing function out of the application roles reach', async () => {
    await expectPgError(
      rawQuery(t.apiUrl, `select app.queue_for_channels($1, 'availability', '2026-12-01', '2026-12-02')`, [
        runs,
      ]),
      PG.insufficientPrivilege,
    );
  });
});
