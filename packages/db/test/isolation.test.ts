import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ApiDatabase,
  appUsers,
  memberships,
  organisations,
  properties,
  WorkerDatabase,
} from '../src/index.ts';
import { createTestDatabase, seedOperator, type TestDatabase } from '../src/testing.ts';
import { expectPgError, insertProperty, PG, rawQuery } from './helpers.ts';

/**
 * Playbook, Section 2: "Automated tests sign in as a second test operator and call
 * every route. They must return none of the first operator's data."
 * This file proves it at the database level, where it cannot be bypassed by a code mistake.
 */

let t: TestDatabase;
let api: ApiDatabase;
let a: { orgId: string; userId: string };
let b: { orgId: string; userId: string };
let propertyA: string;

beforeAll(async () => {
  t = await createTestDatabase();
  a = await seedOperator(t.ownerUrl, { name: 'Operator A', slug: 'operator-a', userEmail: 'a@example.test' });
  b = await seedOperator(t.ownerUrl, { name: 'Operator B', slug: 'operator-b', userEmail: 'b@example.test' });
  api = new ApiDatabase(t.apiUrl);
  propertyA = await api.withOrg({ orgId: a.orgId, userId: a.userId }, (tx) =>
    insertProperty(tx, a.orgId, 'Harbour View Lodge'),
  );
});

afterAll(async () => {
  await api?.close();
  await t?.drop();
});

describe('operator isolation', () => {
  it('shows an operator its own properties', async () => {
    const rows = await api.withOrg({ orgId: a.orgId }, (tx) => tx.select().from(properties));
    expect(rows.map((r) => r.id)).toEqual([propertyA]);
  });

  it('shows a second operator none of them, even when asked by id', async () => {
    const all = await api.withOrg({ orgId: b.orgId }, (tx) => tx.select().from(properties));
    const byId = await api.withOrg({ orgId: b.orgId }, (tx) =>
      tx.select().from(properties).where(eq(properties.id, propertyA)),
    );
    expect(all).toEqual([]);
    expect(byId).toEqual([]);
  });

  it('refuses to write a row into another operator', async () => {
    await expectPgError(
      api.withOrg({ orgId: b.orgId }, (tx) => insertProperty(tx, a.orgId, 'Planted listing')),
      PG.rlsViolation,
    );
  });

  it("cannot change another operator's rows", async () => {
    const updated = await api.withOrg({ orgId: b.orgId }, (tx) =>
      tx.update(properties).set({ name: 'Renamed' }).where(eq(properties.id, propertyA)).returning(),
    );
    expect(updated).toEqual([]);
    const [still] = await api.withOrg({ orgId: a.orgId }, (tx) =>
      tx.select().from(properties).where(eq(properties.id, propertyA)),
    );
    expect(still?.name).toBe('Harbour View Lodge');
  });

  it('returns nothing when a query runs outside any operator scope', async () => {
    const rows = await rawQuery<{ n: string }>(t.apiUrl, 'select count(*) as n from app.properties');
    expect(rows[0]?.n).toBe('0');
  });

  it('lets a person see only the operators they belong to', async () => {
    const orgs = await api.withUser(a.userId, (tx) => tx.select().from(organisations));
    const mine = await api.withUser(a.userId, (tx) => tx.select().from(memberships));
    expect(orgs.map((o) => o.id)).toEqual([a.orgId]);
    expect(mine.map((m) => m.organisationId)).toEqual([a.orgId]);
  });

  it('keeps people from other operators out of sight', async () => {
    const people = await api.withOrg({ orgId: b.orgId, userId: b.userId }, (tx) =>
      tx.select().from(appUsers),
    );
    expect(people.map((p) => p.id)).toEqual([b.userId]);
  });
});

describe('privileges', () => {
  it('stops the API role calling worker-only functions', async () => {
    await expectPgError(
      rawQuery(t.apiUrl, 'select * from app.sys_claim_outbox(1)'),
      PG.insufficientPrivilege,
    );
  });

  it('stops the application writing the audit log or calendar holds directly', async () => {
    await expectPgError(
      rawQuery(
        t.apiUrl,
        `insert into app.audit_log (organisation_id, action, entity_type) values ($1, 'insert', 'forged')`,
        [a.orgId],
      ),
      PG.insufficientPrivilege,
    );
    await expectPgError(
      rawQuery(
        t.apiUrl,
        `insert into app.occupancies (organisation_id, property_id, nights, source_type, source_id)
         values ($1, $2, '[2026-11-01,2026-11-03)', 'block', gen_random_uuid())`,
        [a.orgId, propertyA],
      ),
      PG.insufficientPrivilege,
    );
  });

  it('lets the API record webhooks but never read them back', async () => {
    await api.recordWebhook({
      provider: 'channex',
      event: 'booking',
      externalPropertyId: 'cx-1',
      payload: { event: 'booking' },
    });
    await expectPgError(rawQuery(t.apiUrl, 'select * from app.webhook_events'), PG.insufficientPrivilege);
  });

  it("never lets the API or worker hand a property's channels to V-01", async () => {
    const scope = { orgId: a.orgId, userId: a.userId };
    const setManagedBy = (db: ApiDatabase | WorkerDatabase, value: 'v01' | 'guesty' | 'none') =>
      db.withOrg(scope, (tx) =>
        tx
          .update(properties)
          .set({ managedBy: value })
          .where(eq(properties.id, propertyA))
          .returning({ id: properties.id }),
      );
    const worker = new WorkerDatabase(t.workerUrl);
    try {
      // Not on a new property...
      await expectPgError(
        api.withOrg(scope, (tx) =>
          tx.insert(properties).values({
            organisationId: a.orgId,
            name: 'Quay Studio',
            countryCode: 'GB',
            maxGuests: 2,
            managedBy: 'v01',
          }),
        ),
        PG.insufficientPrivilege,
      );
      // ...and not by switching one over.
      await expectPgError(setManagedBy(api, 'v01'), PG.insufficientPrivilege);
      await expectPgError(setManagedBy(worker, 'v01'), PG.insufficientPrivilege);
      // Moving between the states that send nothing is fine.
      expect(await setManagedBy(api, 'none')).toEqual([{ id: propertyA }]);
      expect(await setManagedBy(api, 'guesty')).toEqual([{ id: propertyA }]);
      // The database owner, which the move-over step will act as, can.
      await rawQuery(t.ownerUrl, `update app.properties set managed_by = 'v01' where id = $1`, [propertyA]);
      await rawQuery(t.ownerUrl, `update app.properties set managed_by = 'guesty' where id = $1`, [
        propertyA,
      ]);
    } finally {
      await worker.close();
    }
  });

  it('stops anyone deleting a booking', async () => {
    await expectPgError(
      rawQuery(t.apiUrl, 'delete from app.reservations where id = gen_random_uuid()'),
      PG.insufficientPrivilege,
    );
  });
});
