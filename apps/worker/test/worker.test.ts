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

/** The tests' today, so trimming to the nights ahead gives the same answer whenever they run. */
const TODAY = '2026-10-15';

async function queue(
  kind: 'availability' | 'restrictions',
  propertyId: string,
  dateFrom: string,
  dateTo: string,
) {
  await owner(
    `insert into app.ari_outbox (organisation_id, property_id, kind, date_from, date_to) values ($1, $2, $3, $4, $5)`,
    [op.orgId, propertyId, kind, dateFrom, dateTo],
  );
}

const queueAvailability = (propertyId: string, dateFrom: string, dateTo: string) =>
  queue('availability', propertyId, dateFrom, dateTo);

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
  // The booking queued its own nights (migration 0012); each test queues what it sends.
  await owner('delete from app.ari_outbox');
});

beforeEach(() => {
  provider = new FakeChannelProvider();
  alerts = new MemoryAlerts();
  deps = {
    db: worker,
    provider,
    limiter: createChannexRateLimiter(),
    alerts,
    log: silentLogger,
    now: () => new Date(`${TODAY}T12:00:00Z`),
  };
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

describe('nights that have passed', () => {
  it('sends only the nights from today, and marks a range already past as done', async () => {
    await owner(`update app.ari_outbox set status = 'sent'`);
    await queueAvailability(mapped, '2026-10-01', '2026-10-10');
    await queueAvailability(mapped, '2026-10-13', '2026-10-17');
    expect(await processOutbox(deps)).toMatchObject({ claimed: 2, sent: 2 });
    expect(provider.availabilityCalls).toHaveLength(1);
    expect(provider.availabilityCalls[0]?.map((u) => [u.dateFrom, u.dateTo])).toEqual([
      [TODAY, '2026-10-17'],
    ]);
  });
});

describe('prices and stay rules', () => {
  beforeEach(async () => {
    await owner(`update app.ari_outbox set status = 'sent'`);
  });

  async function setUsual(changes: string, values: unknown[] = []) {
    await owner(`update app.properties set ${changes} where id = $1`, [mapped, ...values]);
    // Changing the usual rules queues the whole horizon; these tests queue only what they check.
    await owner(`delete from app.ari_outbox where status = 'pending'`);
  }

  it('sends the usual, weekend and nightly prices in runs, with the stay rules', async () => {
    await setUsual(
      'base_price_minor = 15000, weekend_price_minor = 19000, min_nights = 2, max_nights = 14, min_price_minor = 9500, max_price_minor = 40000',
    );
    await owner(
      `insert into app.calendar_days (organisation_id, property_id, night, price_minor, min_nights, closed_to_arrival)
       values ($1, $2, '2026-11-18', 21000, 3, true)`,
      [op.orgId, mapped],
    );
    // The night's own price queued itself. Add Monday 16 to Sunday 22 November 2026: one call for both.
    await queue('restrictions', mapped, '2026-11-16', '2026-11-22');
    expect(await processOutbox(deps)).toMatchObject({ claimed: 2, sent: 2 });
    const ref = {
      externalPropertyId: 'cx-hvl',
      externalRoomTypeId: 'cx-hvl-room',
      externalRatePlanId: 'cx-hvl-rate',
    };
    const rules = { maxStay: 14, closedToArrival: false, closedToDeparture: false };
    expect(provider.restrictionCalls).toEqual([
      [
        { ref, dateFrom: '2026-11-16', dateTo: '2026-11-17', rateMinor: 15_000, minStayArrival: 2, ...rules },
        {
          ref,
          dateFrom: '2026-11-18',
          dateTo: '2026-11-18',
          rateMinor: 21_000,
          minStayArrival: 3,
          ...rules,
          closedToArrival: true,
        },
        { ref, dateFrom: '2026-11-19', dateTo: '2026-11-19', rateMinor: 15_000, minStayArrival: 2, ...rules },
        { ref, dateFrom: '2026-11-20', dateTo: '2026-11-21', rateMinor: 19_000, minStayArrival: 2, ...rules },
        { ref, dateFrom: '2026-11-22', dateTo: '2026-11-22', rateMinor: 15_000, minStayArrival: 2, ...rules },
      ],
    ]);
    const [log] = await owner<{
      kind: string;
      status: string;
      detail: { ranges: number; heldAtLimit: number };
    }>(`select kind, status, detail from app.sync_log where kind = 'restrictions' order by id desc limit 1`);
    expect(log).toMatchObject({ kind: 'restrictions', status: 'ok', detail: { ranges: 5, heldAtLimit: 0 } });
  });

  it('never sends a price outside the limits', async () => {
    await setUsual('base_price_minor = 8000, weekend_price_minor = null, max_nights = null');
    await queue('restrictions', mapped, '2026-11-23', '2026-11-24');
    await processOutbox(deps);
    expect(provider.restrictionCalls[0]).toEqual([
      expect.objectContaining({
        dateFrom: '2026-11-23',
        dateTo: '2026-11-24',
        rateMinor: 9_500,
        maxStay: null,
      }),
    ]);
    const [log] = await owner<{ detail: { heldAtLimit: number } }>(
      `select detail from app.sync_log where kind = 'restrictions' order by id desc limit 1`,
    );
    expect(log?.detail.heldAtLimit).toBe(2);
  });

  it('leaves prices to PriceLabs when it sets them, and still sends the stay rules', async () => {
    await setUsual(`price_owner = 'pricelabs'`);
    await queue('restrictions', mapped, '2026-11-23', '2026-11-23');
    await processOutbox(deps);
    const [update] = provider.restrictionCalls[0] ?? [];
    expect(update).not.toHaveProperty('rateMinor');
    expect(update).toMatchObject({ minStayArrival: 2, closedToArrival: false });
    await setUsual(`price_owner = 'v01'`);
  });

  it('sends prices and availability as separate calls, each batched for the property', async () => {
    await queue('restrictions', mapped, '2026-11-23', '2026-11-24');
    await queue('restrictions', mapped, '2026-11-26', '2026-11-27');
    await queueAvailability(mapped, '2026-11-23', '2026-11-27');
    expect(await processOutbox(deps)).toMatchObject({ claimed: 3, sent: 3 });
    expect(provider.restrictionCalls).toHaveLength(1);
    expect(provider.availabilityCalls).toHaveLength(1);
    expect(provider.restrictionCalls[0]?.[0]?.dateFrom).toBe('2026-11-23');
    expect(provider.restrictionCalls[0]?.at(-1)?.dateTo).toBe('2026-11-27');
  });
});

describe('full sync', () => {
  it('queues 500 days for properties V-01 manages, and none for any other', async () => {
    await owner(`update app.ari_outbox set status = 'sent'`);
    const queued = await enqueueFullSync(deps, new Date('2026-10-14T12:00:00Z'));
    expect(queued).toBe(1);
    const rows = await owner<{ property_id: string; kind: string; date_from: string; date_to: string }>(
      `select property_id, kind, date_from::text, date_to::text from app.ari_outbox where status = 'pending'
        order by kind`,
    );
    expect(rows).toEqual(
      ['availability', 'restrictions'].map((kind) => ({
        property_id: mapped,
        kind,
        date_from: '2026-10-14',
        date_to: '2028-02-25',
      })),
    );
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
