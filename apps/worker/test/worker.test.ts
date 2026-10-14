import { ChannelError, createChannexRateLimiter, FakeChannelProvider } from '@v01/channels';
import { ApiDatabase, WorkerDatabase } from '@v01/db';
import { createTestDatabase, seedOperator, type TestDatabase } from '@v01/db/testing';
import type { Alert, AlertSink } from '@v01/integrations';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { availabilityRanges } from '../src/availability.ts';
import { processWebhooks } from '../src/bookings.ts';
import { silentLogger, type WorkerDeps } from '../src/deps.ts';
import { enqueueFullSync, FULL_SYNC_DAYS } from '../src/full-sync.ts';
import { startJobs } from '../src/jobs.ts';
import { backoffMs, processOutbox } from '../src/outbox.ts';

class MemoryAlerts implements AlertSink {
  readonly sent: Alert[] = [];
  async send(alert: Alert) {
    this.sent.push(alert);
  }
}

let t: TestDatabase;
let api: ApiDatabase;
let worker: WorkerDatabase;
let op: { orgId: string; userId: string };
let mapped: string;
let onGuesty: string;
let notConnected: string;
let provider: FakeChannelProvider;
let alerts: MemoryAlerts;
let deps: WorkerDeps;

async function owner<T extends pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> {
  const client = new pg.Client({ connectionString: t.ownerUrl });
  await client.connect();
  try {
    return (await client.query<T>(text, values)).rows;
  } finally {
    await client.end();
  }
}

async function addProperty(
  name: string,
  managedBy: 'v01' | 'guesty' | 'none',
  channexId: string,
): Promise<string> {
  const [row] = await owner<{ id: string }>(
    `insert into app.properties (organisation_id, name, country_code, max_guests, managed_by)
     values ($1, $2, 'GB', 4, $3) returning id`,
    [op.orgId, name, managedBy],
  );
  await owner(
    `insert into app.channex_mappings (organisation_id, property_id, channex_property_id, channex_room_type_id, channex_rate_plan_id)
     values ($1, $2, $3, $3 || '-room', $3 || '-rate')`,
    [op.orgId, row!.id, channexId],
  );
  return row!.id;
}

async function queueAvailability(propertyId: string, dateFrom: string, dateTo: string) {
  await owner(
    `insert into app.ari_outbox (organisation_id, property_id, kind, date_from, date_to) values ($1, $2, 'availability', $3, $4)`,
    [op.orgId, propertyId, dateFrom, dateTo],
  );
}

beforeAll(async () => {
  t = await createTestDatabase();
  op = await seedOperator(t.ownerUrl, { name: 'Operator', slug: 'operator', userEmail: 'ops@example.test' });
  api = new ApiDatabase(t.apiUrl);
  worker = new WorkerDatabase(t.workerUrl);
  mapped = await addProperty('Harbour View Lodge', 'v01', 'cx-hvl');
  onGuesty = await addProperty('Mill Street Flat', 'guesty', 'cx-msf');
  notConnected = await addProperty('Quay Studio', 'none', 'cx-qst');
  await owner(
    `insert into app.reservations (organisation_id, property_id, channel, status, check_in, check_out)
     values ($1, $2, 'airbnb', 'confirmed', '2026-11-13', '2026-11-15')`,
    [op.orgId, mapped],
  );
});

beforeEach(() => {
  provider = new FakeChannelProvider();
  alerts = new MemoryAlerts();
  deps = { db: worker, provider, limiter: createChannexRateLimiter(), alerts, log: silentLogger };
});

afterAll(async () => {
  await api?.close();
  await worker?.close();
  await t?.drop();
});

describe('availability ranges', () => {
  it('closes booked nights and merges the rest into runs', () => {
    expect(
      availabilityRanges('2026-11-10', '2026-11-20', [{ start: '2026-11-13', end: '2026-11-15' }]),
    ).toEqual([
      { dateFrom: '2026-11-10', dateTo: '2026-11-12', available: 1 },
      { dateFrom: '2026-11-13', dateTo: '2026-11-14', available: 0 },
      { dateFrom: '2026-11-15', dateTo: '2026-11-20', available: 1 },
    ]);
  });

  it('backs off exponentially, capped at thirty minutes', () => {
    expect(backoffMs(1)).toBe(30_000);
    expect(backoffMs(3)).toBe(120_000);
    expect(backoffMs(20)).toBe(30 * 60_000);
    expect(backoffMs(1, 90_000)).toBe(90_000);
  });
});

describe('outbox sender', () => {
  it('sends one batched call per property, calculated from bookings, and logs the task id', async () => {
    await queueAvailability(mapped, '2026-11-10', '2026-11-16');
    await queueAvailability(mapped, '2026-11-15', '2026-11-20');
    const stats = await processOutbox(deps);
    expect(stats).toEqual({ claimed: 2, sent: 2, deferred: 0, failed: 0 });
    expect(provider.availabilityCalls).toHaveLength(1);
    expect(provider.availabilityCalls[0]?.map((u) => [u.dateFrom, u.dateTo, u.available])).toEqual([
      ['2026-11-10', '2026-11-12', 1],
      ['2026-11-13', '2026-11-14', 0],
      ['2026-11-15', '2026-11-20', 1],
    ]);
    expect(provider.availabilityCalls[0]?.[0]?.ref).toEqual({
      externalPropertyId: 'cx-hvl',
      externalRoomTypeId: 'cx-hvl-room',
      externalRatePlanId: 'cx-hvl-rate',
    });
    const rows = await owner<{ status: string; provider_task_id: string }>(
      `select status, provider_task_id from app.ari_outbox where property_id = $1`,
      [mapped],
    );
    expect(rows.every((r) => r.status === 'sent' && r.provider_task_id === 'fake-task-1')).toBe(true);
    const log = await owner<{ status: string }>(`select status from app.sync_log where property_id = $1`, [
      mapped,
    ]);
    expect(log).toEqual([{ status: 'ok' }]);
  });

  it('retries later when the channel manager is down', async () => {
    await queueAvailability(mapped, '2026-12-01', '2026-12-05');
    provider.failNextCallWith(new ChannelError('Service unavailable', 'server', 503));
    const stats = await processOutbox(deps);
    expect(stats.deferred).toBe(1);
    const [row] = await owner<{ status: string; due_later: boolean; last_error: string }>(
      `select status, next_attempt_at > now() as due_later, last_error from app.ari_outbox
        where property_id = $1 and date_from = '2026-12-01'`,
      [mapped],
    );
    expect(row).toEqual({ status: 'pending', due_later: true, last_error: 'Service unavailable' });
  });

  it('never sends anything for a property still on Guesty', async () => {
    await queueAvailability(onGuesty, '2026-11-01', '2026-11-30');
    await processOutbox(deps);
    expect(provider.availabilityCalls).toEqual([]);
    const [row] = await owner<{ status: string; last_error: string }>(
      `select status, last_error from app.ari_outbox where property_id = $1`,
      [onGuesty],
    );
    expect(row?.status).toBe('failed');
    expect(row?.last_error).toContain('Guesty');
  });

  it('never sends anything for a property added in V-01 and not yet moved over', async () => {
    await queueAvailability(notConnected, '2026-11-01', '2026-11-30');
    await processOutbox(deps);
    expect(provider.availabilityCalls).toEqual([]);
    const [row] = await owner<{ status: string; last_error: string }>(
      `select status, last_error from app.ari_outbox where property_id = $1`,
      [notConnected],
    );
    expect(row).toEqual({
      status: 'failed',
      last_error: "Skipped: this property's listings are not connected to V-01 yet.",
    });
  });
});

describe('full sync', () => {
  it('queues 500 days for properties V-01 manages, and none for any other', async () => {
    await owner(`update app.ari_outbox set status = 'sent'`);
    const queued = await enqueueFullSync(deps, new Date('2026-10-14T12:00:00Z'));
    expect(queued).toBe(1);
    const rows = await owner<{ property_id: string; date_from: string; date_to: string }>(
      `select property_id, date_from::text, date_to::text from app.ari_outbox where status = 'pending'`,
    );
    expect(rows).toEqual([{ property_id: mapped, date_from: '2026-10-14', date_to: '2028-02-25' }]);
    expect(FULL_SYNC_DAYS).toBe(500);
  });
});

describe('booking webhooks', () => {
  it('stores every revision for the property, and acknowledges nothing until the importer saves it', async () => {
    provider.feed = [
      {
        id: 'rev-1',
        bookingId: 'bk-1',
        externalPropertyId: 'cx-hvl',
        status: 'new',
        arrivalDate: '2026-12-20',
        departureDate: '2026-12-23',
        otaName: 'Airbnb',
        otaReservationCode: 'HMABC123',
        amount: '450.00',
        currency: 'GBP',
        raw: { id: 'rev-1' },
      },
    ];
    await api.recordWebhook({
      provider: 'channex',
      event: 'booking_new',
      externalPropertyId: 'cx-hvl',
      payload: {},
    });
    await api.recordWebhook({
      provider: 'channex',
      event: 'booking_new',
      externalPropertyId: 'cx-hvl',
      payload: {},
    });
    expect(await processWebhooks(deps)).toBe(2);

    const stored = await owner<{ external_revision_id: string }>(
      `select external_revision_id from app.reservation_revisions`,
    );
    expect(stored).toEqual([{ external_revision_id: 'rev-1' }]);
    expect(provider.acknowledged).toEqual([]);
  });

  it('alerts once about a booking for a property nobody has mapped', async () => {
    await api.recordWebhook({
      provider: 'channex',
      event: 'booking_new',
      externalPropertyId: 'cx-unknown',
      payload: {},
    });
    await processWebhooks(deps);
    expect(alerts.sent.map((a) => a.title)).toEqual(['Booking received for an unmapped property']);
  });
});

describe('scheduled jobs', () => {
  it('starts pg-boss with its own restricted role and registers the schedules', async () => {
    const boss = await startJobs({
      connectionString: t.jobsUrl,
      log: silentLogger,
      handlers: {
        'booking-feed-sweep': async () => 0,
        'nightly-full-sync': async () => 0,
        'nightly-cross-check': async () => 0,
      },
    });
    const schedules = await boss.getSchedules();
    await boss.stop({ graceful: false });
    expect(schedules.map((s) => s.name).sort()).toEqual([
      'booking-feed-sweep',
      'nightly-cross-check',
      'nightly-full-sync',
    ]);
  });
});
