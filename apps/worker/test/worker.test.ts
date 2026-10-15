import {
  type BookingRevision,
  ChannelError,
  createChannexRateLimiter,
  FakeChannelProvider,
  fakeRevision,
} from '@v01/channels';
import { ApiDatabase, WorkerDatabase } from '@v01/db';
import { createTestDatabase, seedOperator, type TestDatabase } from '@v01/db/testing';
import type { Alert, AlertSink } from '@v01/integrations';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { availabilityRanges } from '../src/availability.ts';
import { importBookings, processWebhooks, sweepBookingFeed } from '../src/bookings.ts';
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

/** A booking revision as Channex would send it for Harbour View Lodge (mapped, run by V-01). */
function revision(patch: Partial<Omit<BookingRevision, 'raw'>> & { id: string }): BookingRevision {
  return fakeRevision({
    bookingId: 'bk-1',
    externalPropertyId: 'cx-hvl',
    status: 'new',
    arrivalDate: '2026-12-20',
    departureDate: '2026-12-23',
    otaName: 'Airbnb',
    otaReservationCode: 'HMABC123',
    channel: 'airbnb',
    guestName: 'Maya Collins',
    guestEmail: 'maya@example.test',
    guestPhone: null,
    adults: 2,
    children: 1,
    infants: 0,
    amount: '450.00',
    currency: 'GBP',
    insertedAt: null,
    ...patch,
  });
}

interface StayRow {
  status: string;
  check_in: string;
  check_out: string;
  guest: string | null;
  adults: number;
  children: number;
  channel: string;
  channel_reference: string | null;
  total_minor: string | null;
  cancelled: boolean;
}

const stayFor = async (bookingId: string) => {
  const [row] = await owner<StayRow>(
    `select r.status, r.check_in::text, r.check_out::text, g.full_name as guest, r.adults, r.children,
            r.channel, r.channel_reference, r.total_minor::text, r.cancelled_at is not null as cancelled
       from app.channex_bookings cb
       join app.reservations r on r.id = cb.reservation_id
       left join app.guests g on g.id = r.guest_id
      where cb.channex_booking_id = $1`,
    [bookingId],
  );
  return row;
};

const revisionRow = async (id: string) => {
  const [row] = await owner<{ saved: boolean; acked: boolean; attempts: number; error: string | null }>(
    `select processed_at is not null as saved, acked_at is not null as acked, import_attempts as attempts,
            import_error as error
       from app.reservation_revisions where external_revision_id = $1`,
    [id],
  );
  return row;
};

describe('bringing bookings in', () => {
  it('saves a new booking with its guest, and only then acknowledges it', async () => {
    provider.feed = [revision({ id: 'rev-1' })];
    // Two webhooks for one booking: stored once, saved once.
    for (let i = 0; i < 2; i++) {
      await api.recordWebhook({
        provider: 'channex',
        event: 'booking_new',
        externalPropertyId: 'cx-hvl',
        payload: {},
      });
    }
    expect(await processWebhooks(deps)).toBe(2);

    expect(await stayFor('bk-1')).toEqual({
      status: 'confirmed',
      check_in: '2026-12-20',
      check_out: '2026-12-23',
      guest: 'Maya Collins',
      adults: 2,
      children: 1,
      channel: 'airbnb',
      channel_reference: 'HMABC123',
      total_minor: '45000',
      cancelled: false,
    });
    expect(await revisionRow('rev-1')).toEqual({ saved: true, acked: true, attempts: 0, error: null });
    expect(provider.acknowledged).toEqual(['rev-1']);
    // The nights are queued for the channels, closed.
    const queued = await owner<{ kind: string; date_from: string; date_to: string }>(
      `select kind, date_from::text, date_to::text from app.ari_outbox
        where property_id = $1 and date_from = '2026-12-20'`,
      [mapped],
    );
    expect(queued).toEqual([{ kind: 'availability', date_from: '2026-12-20', date_to: '2026-12-22' }]);
  });

  it('moves the stay when the booking changes', async () => {
    provider.feed = [
      revision({ id: 'rev-2', status: 'modified', arrivalDate: '2026-12-21', departureDate: '2026-12-24' }),
    ];
    await sweepBookingFeed(deps);
    expect(await stayFor('bk-1')).toMatchObject({
      status: 'confirmed',
      check_in: '2026-12-21',
      check_out: '2026-12-24',
    });
    expect(provider.acknowledged).toEqual(['rev-2']);
  });

  it('keeps a booking that overlaps another as a conflict, with an urgent alert, and still acknowledges it', async () => {
    provider.feed = [
      revision({
        id: 'rev-3',
        bookingId: 'bk-2',
        arrivalDate: '2026-12-22',
        departureDate: '2026-12-26',
        otaName: 'BookingCom',
        otaReservationCode: '4311850297',
        channel: 'booking_com',
        guestName: 'Ravi Kumar',
      }),
    ];
    await sweepBookingFeed(deps);
    expect(await stayFor('bk-2')).toMatchObject({ status: 'conflict', guest: 'Ravi Kumar' });
    expect(alerts.sent).toEqual([
      expect.objectContaining({ severity: 'urgent', title: 'Double booking: Harbour View Lodge' }),
    ]);
    expect(alerts.sent[0]?.detail).toContain('Ravi Kumar (Booking.com 4311850297), 2026-12-22 to 2026-12-26');
    expect(provider.acknowledged).toEqual(['rev-3']);
  });

  it('releases the nights when a booking is cancelled, and confirms a conflict that no longer overlaps', async () => {
    provider.feed = [
      revision({ id: 'rev-4', status: 'cancelled', arrivalDate: '2026-12-21', departureDate: '2026-12-24' }),
    ];
    await sweepBookingFeed(deps);
    expect(await stayFor('bk-1')).toMatchObject({ status: 'cancelled', cancelled: true });
    provider.feed = [
      revision({
        id: 'rev-5',
        bookingId: 'bk-2',
        status: 'modified',
        arrivalDate: '2026-12-22',
        departureDate: '2026-12-26',
        channel: 'booking_com',
        otaReservationCode: '4311850297',
        guestName: 'Ravi Kumar',
      }),
    ];
    await sweepBookingFeed(deps);
    expect(await stayFor('bk-2')).toMatchObject({ status: 'confirmed', check_in: '2026-12-22' });
  });

  it('applies revisions of one booking in the order they were made, even when they arrive together', async () => {
    provider.feed = [
      revision({
        id: 'rev-7',
        bookingId: 'bk-3',
        otaReservationCode: 'HMQ3F7H2NJ',
        status: 'modified',
        arrivalDate: '2027-01-10',
        departureDate: '2027-01-14',
        insertedAt: '2026-10-15T10:05:00Z',
      }),
      revision({
        id: 'rev-6',
        bookingId: 'bk-3',
        otaReservationCode: 'HMQ3F7H2NJ',
        arrivalDate: '2027-01-10',
        departureDate: '2027-01-12',
        insertedAt: '2026-10-15T10:00:00Z',
      }),
    ];
    await sweepBookingFeed(deps);
    expect(await stayFor('bk-3')).toMatchObject({ status: 'confirmed', check_out: '2027-01-14' });
  });

  it('never acknowledges a revision it could not save, and alerts once however often it is retried', async () => {
    provider.feed = [
      revision({
        id: 'rev-8',
        bookingId: 'bk-4',
        otaReservationCode: 'HMB6N3T9XE',
        arrivalDate: '2027-02-10',
        departureDate: '2027-02-08',
      }),
    ];
    await sweepBookingFeed(deps);
    await sweepBookingFeed(deps);
    expect(await revisionRow('rev-8')).toEqual({
      saved: false,
      acked: false,
      attempts: 2,
      error: "The stay's dates don't make sense: 2027-02-10 to 2027-02-08.",
    });
    expect(provider.acknowledged).toEqual([]);
    expect(alerts.sent.map((a) => a.title)).toEqual(["A booking from the channel manager couldn't be saved"]);
    expect(await stayFor('bk-4')).toBeUndefined();
  });

  it('tries the acknowledgement again when the channel manager is down, without saving twice', async () => {
    provider.feed = [
      revision({
        id: 'rev-9',
        bookingId: 'bk-5',
        otaReservationCode: 'HMK1C5V8QA',
        arrivalDate: '2027-03-01',
        departureDate: '2027-03-04',
      }),
    ];
    provider.failNextCallWith(new ChannelError('Service unavailable', 'server', 503));
    // The feed read fails first; nothing is stored.
    await expect(sweepBookingFeed(deps)).rejects.toThrow('Service unavailable');
    await sweepBookingFeed(deps);
    expect(provider.acknowledged).toEqual(['rev-9']);
    const stays = await owner<{ n: number }>(
      `select count(*)::int as n from app.channex_bookings where channex_booking_id = 'bk-5'`,
    );
    expect(stays).toEqual([{ n: 1 }]);
    expect((await importBookings(deps, op.orgId)).acknowledged).toBe(0);
  });

  it('links a booking V-01 already has under the same channel code, instead of saving it twice', async () => {
    // As if brought across from Guesty before the listing was linked to Channex.
    await owner(
      `insert into app.reservations (organisation_id, property_id, channel, channel_reference, status, check_in, check_out)
       values ($1, $2, 'airbnb', 'HMGUESTY01', 'confirmed', '2027-04-02', '2027-04-05')`,
      [op.orgId, mapped],
    );
    provider.feed = [
      revision({
        id: 'rev-10',
        bookingId: 'bk-6',
        otaReservationCode: 'HMGUESTY01',
        arrivalDate: '2027-04-02',
        departureDate: '2027-04-05',
        guestName: 'Lena Fischer',
      }),
    ];
    await sweepBookingFeed(deps);
    expect(await stayFor('bk-6')).toMatchObject({ status: 'confirmed', guest: 'Lena Fischer' });
    const copies = await owner<{ n: number }>(
      `select count(*)::int as n from app.reservations where channel_reference = 'HMGUESTY01'`,
    );
    expect(copies).toEqual([{ n: 1 }]);
    expect(provider.acknowledged).toEqual(['rev-10']);
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
