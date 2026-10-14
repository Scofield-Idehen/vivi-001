import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiDatabase, ariOutbox, channexMappings, WorkerDatabase } from '../src/index.ts';
import { createTestDatabase, seedOperator, type TestDatabase } from '../src/testing.ts';
import { insertProperty, rawQuery } from './helpers.ts';

let t: TestDatabase;
let api: ApiDatabase;
let worker: WorkerDatabase;
let a: { orgId: string; userId: string };
let b: { orgId: string; userId: string };
let propertyA: string;
let propertyB: string;

beforeAll(async () => {
  t = await createTestDatabase();
  a = await seedOperator(t.ownerUrl, { name: 'Operator A', slug: 'operator-a', userEmail: 'a@example.test' });
  b = await seedOperator(t.ownerUrl, { name: 'Operator B', slug: 'operator-b', userEmail: 'b@example.test' });
  api = new ApiDatabase(t.apiUrl);
  worker = new WorkerDatabase(t.workerUrl);
  propertyA = await api.withOrg({ orgId: a.orgId }, (tx) => insertProperty(tx, a.orgId, 'A1'));
  propertyB = await api.withOrg({ orgId: b.orgId }, (tx) => insertProperty(tx, b.orgId, 'B1'));
});

afterAll(async () => {
  await api?.close();
  await worker?.close();
  await t?.drop();
});

describe('outbox claiming', () => {
  it('claims due changes across operators, each exactly once', async () => {
    for (const [orgId, propertyId] of [
      [a.orgId, propertyA],
      [b.orgId, propertyB],
    ] as const) {
      await api.withOrg({ orgId }, (tx) =>
        tx.insert(ariOutbox).values({
          organisationId: orgId,
          propertyId,
          kind: 'availability',
          dateFrom: '2026-11-01',
          dateTo: '2026-11-30',
        }),
      );
    }
    const first = await worker.claimOutbox(10);
    expect(new Set(first.map((r) => r.organisationId))).toEqual(new Set([a.orgId, b.orgId]));
    expect(first.every((r) => r.attempts === 1)).toBe(true);
    expect(await worker.claimOutbox(10)).toEqual([]);
  });

  it('reclaims a change left in sending for more than ten minutes', async () => {
    await rawQuery(t.ownerUrl, `update app.ari_outbox set locked_at = now() - interval '11 minutes'`);
    const again = await worker.claimOutbox(10);
    expect(again).toHaveLength(2);
    expect(again.every((r) => r.attempts === 2)).toBe(true);
  });
});

describe('webhook routing', () => {
  it('finds which operator a Channex property belongs to', async () => {
    await api.withOrg({ orgId: b.orgId }, (tx) =>
      tx.insert(channexMappings).values({
        organisationId: b.orgId,
        propertyId: propertyB,
        channexPropertyId: 'cx-prop-b',
      }),
    );
    expect(await worker.resolveChannexProperty('cx-prop-b')).toEqual({
      organisationId: b.orgId,
      propertyId: propertyB,
    });
    expect(await worker.resolveChannexProperty('unknown')).toBeNull();
  });

  it('claims each webhook once, and retries a failed one after its lock expires', async () => {
    await api.recordWebhook({
      provider: 'channex',
      event: 'booking',
      externalPropertyId: 'cx-prop-b',
      payload: {},
    });
    const [event] = await worker.claimWebhookEvents(5);
    expect(event?.event).toBe('booking');
    expect(await worker.claimWebhookEvents(5)).toEqual([]);

    await worker.finishWebhookEvent(event!.id, { organisationId: b.orgId, error: 'temporary failure' });
    expect(await worker.claimWebhookEvents(5)).toEqual([]);
    await rawQuery(t.ownerUrl, `update app.webhook_events set locked_at = now() - interval '6 minutes'`);
    const [retry] = await worker.claimWebhookEvents(5);
    expect(retry?.attempts).toBe(2);

    await worker.finishWebhookEvent(retry!.id, { organisationId: b.orgId });
    const [row] = await rawQuery<{ processed: boolean }>(
      t.ownerUrl,
      'select processed_at is not null as processed from app.webhook_events where id = $1',
      [retry!.id],
    );
    expect(row?.processed).toBe(true);
  });

  it('lists every operator for scheduled work', async () => {
    const orgs = await worker.listOrganisations();
    expect(orgs.map((o) => o.name)).toEqual(['Operator A', 'Operator B']);
  });
});
