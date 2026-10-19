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
import { markDirtyAfterCheckOut } from '../src/cleaning.ts';
import {
  CROSS_CHECK_DAYS,
  compareNights,
  crossCheckAll,
  crossCheckProperty,
  datesToRanges,
} from '../src/cross-check.ts';
import { silentLogger, type WorkerDeps } from '../src/deps.ts';
import { enqueueFullSync, FULL_SYNC_DAYS } from '../src/full-sync.ts';
import { startJobs } from '../src/jobs.ts';
import { syncChannelLinks } from '../src/links.ts';
import { backoffMs, processOutbox } from '../src/outbox.ts';
import { beginRun, checkAllAutoClose, recover } from '../src/safety.ts';
import { connectProperties } from '../src/setup.ts';

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

  it('keeps a detail the team added when the channel sends none, and takes the ones it sends', async () => {
    const guestOf = async () => {
      const [row] = await owner<{ email: string | null; phone: string | null }>(
        `select g.email, g.phone from app.channex_bookings cb
           join app.reservations r on r.id = cb.reservation_id
           join app.guests g on g.id = r.guest_id
          where cb.channex_booking_id = 'bk-1'`,
      );
      return row;
    };
    // Typed in on the reservation page: Airbnb sends no phone number.
    await owner(
      `update app.guests g set phone = '+44 7700 900123'
         from app.reservations r join app.channex_bookings cb on cb.reservation_id = r.id
        where g.id = r.guest_id and cb.channex_booking_id = 'bk-1'`,
    );
    provider.feed = [
      revision({
        id: 'rev-2b',
        status: 'modified',
        arrivalDate: '2026-12-21',
        departureDate: '2026-12-24',
        guestEmail: 'maya.collins@example.test',
        guestPhone: null,
      }),
    ];
    await sweepBookingFeed(deps);
    expect(await guestOf()).toEqual({ email: 'maya.collins@example.test', phone: '+44 7700 900123' });
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

describe('clean and dirty', () => {
  let cottage: string;
  const at = (iso: string) => ({ ...deps, now: () => new Date(iso) });
  const state = async () => {
    const [row] = await owner<{ status: string; changed_at: string | null; by: string | null }>(
      `select cleaning_status as status, (cleaning_changed_at at time zone 'UTC')::text as changed_at,
              cleaning_changed_by as by
         from app.properties where id = $1`,
      [cottage],
    );
    return row;
  };

  beforeAll(async () => {
    cottage = await addProperty('Orchard Cottage', 'guesty', 'cx-orc');
    // Check-out on Friday 16 October at the usual 10:00, London time (09:00 UTC).
    await owner(
      `insert into app.reservations (organisation_id, property_id, channel, status, check_in, check_out)
       values ($1, $2, 'vrbo', 'confirmed', '2026-10-13', '2026-10-16')`,
      [op.orgId, cottage],
    );
  });

  it('marks a property dirty once the guest has checked out, not before', async () => {
    expect(await markDirtyAfterCheckOut(at('2026-10-16T08:59:00Z'))).toBe(0);
    expect((await state())?.status).toBe('clean');
    expect(await markDirtyAfterCheckOut(at('2026-10-16T09:10:00Z'))).toBe(1);
    // Dirty from the check-out itself, by nobody in particular.
    expect(await state()).toEqual({ status: 'dirty', changed_at: '2026-10-16 09:00:00', by: null });
    // Running again changes nothing.
    expect(await markDirtyAfterCheckOut(at('2026-10-16T09:25:00Z'))).toBe(0);
  });

  it('leaves a property someone marked clean after the check-out, and old check-outs alone', async () => {
    await owner(
      `update app.properties set cleaning_status = 'clean', cleaning_changed_at = '2026-10-16 11:30+00',
              cleaning_changed_by = $2 where id = $1`,
      [cottage, op.userId],
    );
    expect(await markDirtyAfterCheckOut(at('2026-10-16T12:00:00Z'))).toBe(0);
    expect((await state())?.status).toBe('clean');
    // A day on, the cleaned property isn't made dirty by Friday's check-out again.
    expect(await markDirtyAfterCheckOut(at('2026-10-17T12:00:00Z'))).toBe(0);
  });

  it('uses a check-out time agreed for the stay', async () => {
    await owner(
      `insert into app.reservations (organisation_id, property_id, channel, status, check_in, check_out, check_out_time)
       values ($1, $2, 'direct', 'confirmed', '2026-10-18', '2026-10-20', '13:00')`,
      [op.orgId, cottage],
    );
    expect(await markDirtyAfterCheckOut(at('2026-10-20T11:30:00Z'))).toBe(0);
    expect(await markDirtyAfterCheckOut(at('2026-10-20T12:05:00Z'))).toBe(1);
    expect((await state())?.changed_at).toBe('2026-10-20 12:00:00');
  });
});

describe('connecting properties to the channel manager', () => {
  /** A property added in V-01 with no Channex ids yet. */
  async function plainProperty(name: string, managedBy: 'v01' | 'guesty' | 'none'): Promise<string> {
    const [row] = await owner<{ id: string }>(
      `insert into app.properties (organisation_id, name, country_code, max_guests, managed_by, city, postcode, address_line1)
       values ($1, $2, 'GB', 6, $3, 'Port Seton', 'EH32 0AA', '4 Harbour Road') returning id`,
      [op.orgId, name, managedBy],
    );
    return row!.id;
  }
  const ask = (propertyId: string) =>
    owner(
      `insert into app.channex_setups (organisation_id, property_id, requested_by) values ($1, $2, $3)
       on conflict (property_id) do update set status = 'queued', attempts = 0, next_attempt_at = now(), locked_at = null, last_error = null, finished_at = null`,
      [op.orgId, propertyId, op.userId],
    );
  const setupOf = async (propertyId: string) => {
    const [row] = await owner<{
      status: string;
      attempts: number;
      last_error: string | null;
      finished_at: string | null;
    }>('select status, attempts, last_error, finished_at from app.channex_setups where property_id = $1', [
      propertyId,
    ]);
    return row;
  };
  const mappingOf = async (propertyId: string) => {
    const [row] = await owner<{
      channex_property_id: string;
      channex_room_type_id: string;
      channex_rate_plan_id: string;
    }>(
      'select channex_property_id, channex_room_type_id, channex_rate_plan_id from app.channex_mappings where property_id = $1',
      [propertyId],
    );
    return row;
  };

  it('makes the operator’s group once, then the property in it, and keeps the ids', async () => {
    const lodge = await plainProperty('Lighthouse Lodge', 'guesty');
    const barn = await plainProperty('Lighthouse Barn', 'guesty');
    await ask(lodge);
    await ask(barn);
    expect(await connectProperties(deps)).toEqual({ claimed: 2, done: 2, deferred: 0, failed: 0 });
    expect(provider.groups).toEqual(['Operator']);
    expect(provider.listings).toHaveLength(2);
    expect(provider.listings[0]).toMatchObject({
      title: 'Lighthouse Lodge',
      currency: 'GBP',
      countryCode: 'GB',
      timeZone: 'Europe/London',
      maxGuests: 6,
      city: 'Port Seton',
      postcode: 'EH32 0AA',
      address: '4 Harbour Road',
      groupId: `fake-group-${provider.token}-1`,
    });
    expect(await mappingOf(lodge)).toEqual({
      channex_property_id: `fake-property-${provider.token}-1`,
      channex_room_type_id: `fake-room-${provider.token}-1`,
      channex_rate_plan_id: `fake-rate-${provider.token}-1`,
    });
    expect(await setupOf(lodge)).toMatchObject({ status: 'done', attempts: 1, last_error: null });
    expect((await setupOf(lodge))?.finished_at).not.toBeNull();
    const groups = await owner<{ channex_group_id: string }>(
      'select channex_group_id from app.channex_groups where organisation_id = $1',
      [op.orgId],
    );
    expect(groups).toEqual([{ channex_group_id: `fake-group-${provider.token}-1` }]);
    // Nothing is queued for a property still on Guesty: Guesty runs its channels.
    const queued = await owner('select 1 from app.ari_outbox where property_id = $1', [lodge]);
    expect(queued).toHaveLength(0);
    // A second run finds nothing to do.
    expect(await connectProperties(deps)).toEqual({ claimed: 0, done: 0, deferred: 0, failed: 0 });
  });

  it('queues a full sync straight away for a property V-01 already runs', async () => {
    const studio = await plainProperty('Pier Studio', 'v01');
    await ask(studio);
    await connectProperties(deps);
    expect(await setupOf(studio)).toMatchObject({ status: 'done', last_error: null });
    const rows = await owner<{ kind: string; date_from: string; date_to: string }>(
      'select kind, date_from::text, date_to::text from app.ari_outbox where property_id = $1 order by kind',
      [studio],
    );
    expect(rows).toEqual([
      { kind: 'availability', date_from: TODAY, date_to: '2028-02-26' },
      { kind: 'restrictions', date_from: TODAY, date_to: '2028-02-26' },
    ]);
  });

  it('tries again later when the channel manager is busy, and gives up with an alert when it refuses', async () => {
    const flat = await plainProperty('Pier Flat', 'guesty');
    await ask(flat);
    provider.failNextCallWith(new ChannelError('Too many requests', 'rate_limited', 429, 1000));
    expect(await connectProperties(deps)).toMatchObject({ deferred: 1 });
    expect(await setupOf(flat)).toMatchObject({
      status: 'queued',
      attempts: 1,
      last_error: 'Too many requests',
    });
    expect(await mappingOf(flat)).toBeUndefined();
    expect(alerts.sent).toHaveLength(0);
    // Not due yet.
    expect(await connectProperties(deps)).toMatchObject({ claimed: 0 });
    await owner('update app.channex_setups set next_attempt_at = now() where property_id = $1', [flat]);
    provider.failNextCallWith(new ChannelError('Title is too long', 'validation', 422));
    expect(await connectProperties(deps)).toMatchObject({ failed: 1 });
    expect(await setupOf(flat)).toMatchObject({
      status: 'failed',
      attempts: 2,
      last_error: 'Title is too long',
    });
    expect(alerts.sent.map((a) => a.title)).toEqual(["Couldn't connect Pier Flat to the channel manager"]);
    // Asked again from the property's page, it starts over and gets through.
    await ask(flat);
    expect(await connectProperties(deps)).toMatchObject({ done: 1 });
    expect(await mappingOf(flat)).toBeDefined();
  });

  it('records the request and its outcome in the audit trail and the sync log', async () => {
    const cabin = await plainProperty('Pier Cabin', 'guesty');
    await ask(cabin);
    await connectProperties(deps);
    const log = await owner<{ kind: string; status: string }>(
      "select kind, status from app.sync_log where property_id = $1 and kind = 'setup'",
      [cabin],
    );
    expect(log).toEqual([{ kind: 'setup', status: 'ok' }]);
    const audit = await owner<{ action: string }>(
      "select action from app.audit_log where entity_type = 'channex_setups' and entity_id = (select id from app.channex_setups where property_id = $1) order by created_at",
      [cabin],
    );
    expect(audit.map((a) => a.action)).toEqual(['insert', 'update', 'update']);
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
        'cleaning-after-check-out': async () => 0,
        'daily-safety-check': async () => 0,
        'hourly-listing-refresh': async () => 0,
      },
    });
    const schedules = await boss.getSchedules();
    await boss.stop({ graceful: false });
    expect(schedules.map((s) => s.name).sort()).toEqual([
      'booking-feed-sweep',
      'cleaning-after-check-out',
      'daily-safety-check',
      'hourly-listing-refresh',
      'nightly-cross-check',
      'nightly-full-sync',
    ]);
  });
});

describe('the safety net for downtime', () => {
  const safetyOf = async (propertyId: string) => {
    const [row] = await owner<{ auto_close: boolean | null; checked: boolean }>(
      'select auto_close, auto_close_checked_at is not null as checked from app.channex_mappings where property_id = $1',
      [propertyId],
    );
    return row;
  };

  it('reads back that Channex closes booked nights itself when a property is connected', async () => {
    const [row] = await owner<{ id: string }>(
      `insert into app.properties (organisation_id, name, country_code, max_guests, managed_by)
       values ($1, 'Net Cottage', 'GB', 4, 'guesty') returning id`,
      [op.orgId],
    );
    const cottage = row!.id;
    await owner(
      `insert into app.channex_setups (organisation_id, property_id, requested_by) values ($1, $2, $3)`,
      [op.orgId, cottage, op.userId],
    );
    expect(await connectProperties(deps)).toMatchObject({ done: 1 });
    expect(await safetyOf(cottage)).toEqual({ auto_close: true, checked: true });
    expect(alerts.sent.filter((a) => a.title.includes('stopped closing'))).toEqual([]);
  });

  it('turns the setting back on when someone turned it off in Channex, and says so', async () => {
    provider.autoClose.set('cx-hvl', false);
    expect(await checkAllAutoClose(deps)).toMatchObject({ fixed: 1, failed: 0 });
    expect(provider.autoClose.get('cx-hvl')).toBe(true);
    expect(await safetyOf(mapped)).toEqual({ auto_close: true, checked: true });
    expect(alerts.sent).toContainEqual(
      expect.objectContaining({
        severity: 'warning',
        title: 'Channex had stopped closing booked nights for Harbour View Lodge',
      }),
    );
    const logged = await owner<{ kind: string; status: string }>(
      `select kind, status from app.sync_log where property_id = $1 and kind = 'safety' order by id desc limit 1`,
      [mapped],
    );
    expect(logged).toEqual([{ kind: 'safety', status: 'fixed' }]);
    // A second look finds it on, and says nothing.
    alerts.sent.length = 0;
    expect(await checkAllAutoClose(deps)).toMatchObject({ fixed: 0, failed: 0 });
    expect(alerts.sent).toEqual([]);
  });

  it('records when Channex could not be asked, and keeps going', async () => {
    provider.failNextCallWith(new ChannelError('Channex is down', 'server', 503));
    const stats = await checkAllAutoClose(deps);
    expect(stats.failed).toBe(1);
    expect(stats.checked).toBeGreaterThan(1);
    const [row] = await owner<{ status: string }>(
      `select status from app.sync_log where kind = 'safety' order by id desc limit 1`,
    );
    expect(row).toEqual({ status: 'error' });
  });

  it('knows when it has been away, and drains the booking feed before anything is sent', async () => {
    // A first run ever: no gap, no recovery.
    const first = await beginRun(deps);
    expect(first).toMatchObject({ gapSeconds: null, recovering: false });

    // The worker was last seen 40 minutes ago.
    await owner(`update app.worker_runs set last_seen_at = now() - interval '40 minutes' where id = $1`, [
      first.runId,
    ]);
    const later = { ...deps, now: () => new Date() };
    const run = await beginRun(later);
    expect(run.gapSeconds).toBeGreaterThanOrEqual(39 * 60);
    expect(run.recovering).toBe(true);
    const [draining] = await owner<{ recovery: string }>(
      'select recovery from app.worker_runs where id = $1',
      [run.runId],
    );
    expect(draining).toEqual({ recovery: 'draining' });

    // Two bookings arrived at Channex while V-01 was away.
    provider.feed = [
      revision({
        id: 'gap-1',
        bookingId: 'bk-gap-1',
        otaReservationCode: 'HMGAP0001',
        arrivalDate: '2027-02-01',
        departureDate: '2027-02-04',
      }),
      revision({
        id: 'gap-2',
        bookingId: 'bk-gap-2',
        otaReservationCode: 'HMGAP0002',
        arrivalDate: '2027-02-10',
        departureDate: '2027-02-12',
      }),
    ];
    const stats = await recover(later, run);
    expect(stats).toMatchObject({ drained: 2 });
    expect(provider.acknowledged).toEqual(expect.arrayContaining(['gap-1', 'gap-2']));
    expect(await stayFor('bk-gap-1')).toMatchObject({ status: 'confirmed', check_in: '2027-02-01' });
    const [done] = await owner<{ recovery: string; drained_revisions: number; recovered: boolean }>(
      'select recovery, drained_revisions, recovered_at is not null as recovered from app.worker_runs where id = $1',
      [run.runId],
    );
    expect(done).toEqual({ recovery: 'done', drained_revisions: 2, recovered: true });
    expect(alerts.sent).toContainEqual(
      expect.objectContaining({
        severity: 'info',
        title: 'V-01 is back after 40 minutes away',
        detail: '2 booking changes saved before anything was sent to the channels.',
      }),
    );
  });

  it('does not recover after a short gap', async () => {
    const run = await beginRun(deps);
    await owner(`update app.worker_runs set last_seen_at = now() - interval '2 minutes' where id = $1`, [
      run.runId,
    ]);
    const next = await beginRun({ ...deps, now: () => new Date() });
    expect(next.recovering).toBe(false);
  });
});

describe('the nightly cross-check with Channex', () => {
  let cottage: string;
  let mappingId: string;
  const horizonEnd = '2027-01-12'; // TODAY + 89 nights
  const mappingOf = async () => {
    const [row] = await owner<{ checked: boolean; differences: number | null; error: string | null }>(
      `select cross_checked_at is not null as checked, cross_check_differences as differences, cross_check_error as error
         from app.channex_mappings where id = $1`,
      [mappingId],
    );
    return row;
  };
  const check = () =>
    crossCheckProperty(deps, op.orgId, {
      id: mappingId,
      propertyId: cottage,
      channexPropertyId: 'cx-chk',
      channexRoomTypeId: 'cx-chk-room',
      channexRatePlanId: 'cx-chk-rate',
    });

  beforeAll(async () => {
    cottage = await addProperty('Check Cottage', 'v01', 'cx-chk');
    await owner(
      `update app.properties set base_price_minor = 12000, weekend_price_minor = 14000, min_nights = 2, max_nights = 21 where id = $1`,
      [cottage],
    );
    await owner(
      `insert into app.reservations (organisation_id, property_id, channel, status, check_in, check_out)
       values ($1, $2, 'direct', 'confirmed', '2026-10-20', '2026-10-22')`,
      [op.orgId, cottage],
    );
    const [m] = await owner<{ id: string }>('select id from app.channex_mappings where property_id = $1', [
      cottage,
    ]);
    mappingId = m!.id;
    await owner('delete from app.ari_outbox where status = $1', ['pending']);
  });

  it('compares the fields the channels get, and leaves prices alone when PriceLabs sets them', () => {
    const ours = [
      {
        date: '2026-11-01',
        available: 0,
        rateMinor: 15000,
        minStayArrival: 2,
        maxStay: null,
        closedToArrival: false,
        closedToDeparture: false,
      },
      {
        date: '2026-11-02',
        available: 1,
        rateMinor: null,
        minStayArrival: 2,
        maxStay: 14,
        closedToArrival: false,
        closedToDeparture: false,
      },
    ];
    const theirs = [
      {
        date: '2026-11-01',
        available: 1,
        rate: '150.00',
        minStayArrival: 3,
        maxStay: null,
        closedToArrival: false,
        closedToDeparture: false,
        stopSell: false,
      },
      {
        date: '2026-11-02',
        available: 1,
        rate: '999.00',
        minStayArrival: 2,
        maxStay: 14,
        closedToArrival: false,
        closedToDeparture: null,
        stopSell: false,
      },
    ];
    expect(compareNights(ours, theirs, 'GBP')).toEqual([
      { date: '2026-11-01', field: 'available', ours: 0, theirs: 1 },
      { date: '2026-11-01', field: 'minStayArrival', ours: 2, theirs: 3 },
      { date: '2026-11-02', field: 'closedToDeparture', ours: false, theirs: null },
    ]);
    expect(datesToRanges(['2026-11-03', '2026-11-01', '2026-11-02', '2026-11-05'])).toEqual([
      { dateFrom: '2026-11-01', dateTo: '2026-11-03' },
      { dateFrom: '2026-11-05', dateTo: '2026-11-05' },
    ]);
  });

  /** A full sync into the stand-in, which keeps what it was sent, as Channex would. */
  async function fill() {
    await queue('availability', cottage, TODAY, horizonEnd);
    await queue('restrictions', cottage, TODAY, horizonEnd);
    expect(await processOutbox(deps)).toMatchObject({ sent: 2 });
  }

  it('finds everything matching once a full sync has reached Channex', async () => {
    await fill();
    expect(provider.nights.get('cx-chk')?.get('2026-10-20')).toMatchObject({ available: 0, rate: '120.00' });
    expect(await check()).toEqual({ outcome: 'matching' });
    expect(await mappingOf()).toEqual({ checked: true, differences: 0, error: null });
    const [log] = await owner<{ status: string; detail: { nightsChecked: number } }>(
      `select status, detail from app.sync_log where property_id = $1 and kind = 'cross_check' order by id desc limit 1`,
      [cottage],
    );
    expect(log).toMatchObject({ status: 'ok', detail: { nightsChecked: CROSS_CHECK_DAYS } });
    expect(alerts.sent).toEqual([]);
  });

  it('sends a night Channex has wrong again, and says so', async () => {
    await fill();
    // Someone opened a booked night in Channex, and changed a price by hand.
    provider.setNight('cx-chk', '2026-10-21', { available: 1 });
    provider.setNight('cx-chk', '2026-11-10', { rate: '99.00', minStayArrival: 5 });
    provider.setNight('cx-chk', '2026-11-11', { rate: '99.00' });
    expect(await check()).toEqual({ outcome: 'differing', nights: 3 });
    expect(await mappingOf()).toEqual({ checked: true, differences: 3, error: null });
    const queued = await owner<{ kind: string; date_from: string; date_to: string }>(
      `select kind, date_from::text, date_to::text from app.ari_outbox where property_id = $1 and status = 'pending' order by kind`,
      [cottage],
    );
    expect(queued).toEqual([
      { kind: 'availability', date_from: '2026-10-21', date_to: '2026-10-21' },
      { kind: 'restrictions', date_from: '2026-11-10', date_to: '2026-11-11' },
    ]);
    expect(alerts.sent).toEqual([
      expect.objectContaining({
        severity: 'warning',
        title: "Channex didn't match V-01 for Check Cottage",
        detail: expect.stringContaining(
          '3 nights differed (price on 2, availability on 1, shortest stay on 1)',
        ),
      }),
    ]);
    const [log] = await owner<{ status: string; detail: { differences: unknown[] } }>(
      `select status, detail from app.sync_log where property_id = $1 and kind = 'cross_check' order by id desc limit 1`,
      [cottage],
    );
    expect(log?.status).toBe('differences');
    expect(log?.detail.differences).toContainEqual({
      date: '2026-10-21',
      field: 'available',
      ours: 0,
      theirs: 1,
    });

    // Until the re-send has gone, the check waits; once it has, Channex matches again.
    expect(await check()).toEqual({ outcome: 'waiting' });
    expect(await processOutbox(deps)).toMatchObject({ sent: 2 });
    expect(provider.nights.get('cx-chk')?.get('2026-10-21')?.available).toBe(0);
    expect(provider.nights.get('cx-chk')?.get('2026-11-10')).toMatchObject({
      rate: '120.00',
      minStayArrival: 2,
    });
    expect(await check()).toEqual({ outcome: 'matching' });
  });

  it('records when Channex could not be asked, and the job keeps going', async () => {
    await fill();
    provider.failNextCallWith(new ChannelError('Channex is down', 'server', 503));
    expect(await check()).toEqual({ outcome: 'failed' });
    expect(await mappingOf()).toEqual({ checked: true, differences: null, error: 'Channex is down' });
    expect(await check()).toEqual({ outcome: 'matching' });
    expect((await mappingOf())?.error).toBeNull();
    const stats = await crossCheckAll(deps);
    expect(stats.checked).toBeGreaterThanOrEqual(1);
    expect(stats.matching).toBeGreaterThanOrEqual(1);
  });
});

describe('channel accounts and listing links', () => {
  const accountOf = async (id: string) => {
    const [row] = await owner<{
      status: string;
      external_account_id: string | null;
      last_error: string | null;
    }>('select status, external_account_id, last_error from app.channel_accounts where id = $1', [id]);
    return row;
  };
  const connectionOf = async (id: string) => {
    const [row] = await owner<{ channex_channel_id: string; connect_url: string | null; active: boolean }>(
      'select channex_channel_id, connect_url, active from app.channex_channels where channel_account_id = $1',
      [id],
    );
    return row;
  };
  const linkOf = async (propertyId: string, accountId: string) => {
    const [row] = await owner<{ status: string; live_from: string | null; last_error: string | null }>(
      `select status, live_from::text, last_error from app.channel_listings
        where property_id = $1 and channel_account_id = $2 order by created_at desc limit 1`,
      [propertyId, accountId],
    );
    return row;
  };
  let airbnbA: string;
  let bookingA: string;
  /** A property added in V-01 and never connected to Channex. */
  let unmapped: string;

  /** The stand-in forgets between tests; this one knows both connections as Channex still holds them. */
  async function providerKnowing(active: Partial<Record<'airbnb' | 'booking', boolean>> = {}) {
    const fresh = new FakeChannelProvider();
    for (const [key, accountId, channel] of [
      ['airbnb', airbnbA, 'airbnb'],
      ['booking', bookingA, 'booking_com'],
    ] as const) {
      const connection = await connectionOf(accountId);
      if (!connection) continue;
      fresh.channels.set(connection.channex_channel_id, {
        setup: { channel, title: key, groupId: 'g', externalPropertyIds: ['cx-hvl'] },
        active: active[key] ?? connection.active,
        mappings: [],
        listings: [],
      });
    }
    return fresh;
  }

  beforeAll(async () => {
    // The operator's group exists from an earlier connection; make sure.
    await owner(
      `insert into app.channex_groups (organisation_id, channex_group_id) values ($1, 'fake-group-links')
       on conflict (organisation_id) do nothing`,
      [op.orgId],
    );
    const rows = await owner<{ id: string }>(
      `insert into app.channel_accounts (organisation_id, channel, label, status, external_account_id)
       values ($1, 'airbnb', 'Airbnb A', 'pending', null), ($1, 'booking_com', 'Booking.com A', 'pending', '1234567')
       returning id`,
      [op.orgId],
    );
    airbnbA = rows[0]!.id;
    bookingA = rows[1]!.id;
    const [plain] = await owner<{ id: string }>(
      `insert into app.properties (organisation_id, name, country_code, max_guests, managed_by)
       values ($1, 'Unmapped Barn', 'GB', 2, 'none') returning id`,
      [op.orgId],
    );
    unmapped = plain!.id;
  });

  it('makes the connection in Channex and keeps the authorisation link for the owner', async () => {
    const stats = await syncChannelLinks(deps);
    expect(stats).toMatchObject({ connected: 2, activated: 0 });
    const airbnb = await connectionOf(airbnbA);
    expect(airbnb).toMatchObject({ active: false });
    expect(airbnb?.connect_url).toMatch(/^https:\/\/connect\.example\.test\//);
    expect((await connectionOf(bookingA))?.connect_url).toBeNull();
    expect(provider.channels.get(airbnb!.channex_channel_id)?.setup).toMatchObject({
      channel: 'airbnb',
      title: 'Airbnb A',
      groupId: expect.any(String),
    });
    expect(provider.channels.get(airbnb!.channex_channel_id)?.setup.externalPropertyIds).toContain('cx-hvl');
    expect(provider.channels.get((await connectionOf(bookingA))!.channex_channel_id)?.setup.hotelId).toBe(
      '1234567',
    );
    // Still waiting for the owner.
    expect(await accountOf(airbnbA)).toMatchObject({ status: 'pending', last_error: null });
  });

  it('notices when the owner has authorised, and caches the listings Channex sees', async () => {
    const { channex_channel_id } = (await connectionOf(airbnbA))!;
    const fresh = await providerKnowing();
    fresh.authorise(channex_channel_id, [
      { externalListingId: '55512345', title: 'Harbour View Lodge · sea views', url: null },
      { externalListingId: '55598765', title: 'Mill Street Flat', url: null },
    ]);
    const stats = await syncChannelLinks({ ...deps, provider: fresh });
    expect(stats).toMatchObject({ activated: 1, refreshed: 1 });
    expect(await accountOf(airbnbA)).toMatchObject({
      status: 'connected',
      external_account_id: `host-${channex_channel_id}`,
    });
    const cached = await owner<{ external_listing_id: string; title: string; url: string }>(
      'select external_listing_id, title, url from app.channel_account_listings where channel_account_id = $1 order by 1',
      [airbnbA],
    );
    expect(cached).toEqual([
      {
        external_listing_id: '55512345',
        title: 'Harbour View Lodge · sea views',
        url: 'https://www.airbnb.com/rooms/55512345',
      },
      {
        external_listing_id: '55598765',
        title: 'Mill Street Flat',
        url: 'https://www.airbnb.com/rooms/55598765',
      },
    ]);
  });

  it('sends the account’s whole mapping set when a link is asked for, and turns the connection on', async () => {
    const { channex_channel_id } = (await connectionOf(airbnbA))!;
    const fresh = await providerKnowing();
    await owner(
      `insert into app.channel_listings (organisation_id, property_id, channel_account_id, channel, external_listing_id, status, requested_by)
       values ($1, $2, $3, 'airbnb', '55512345', 'linking', $4)`,
      [op.orgId, mapped, airbnbA, op.userId],
    );
    const stats = await syncChannelLinks({ ...deps, provider: fresh });
    expect(stats).toMatchObject({ linked: 1, failed: 0 });
    expect(fresh.channels.get(channex_channel_id)?.mappings).toEqual([
      { ratePlanId: 'cx-hvl-rate', externalListingId: '55512345' },
    ]);
    expect(await linkOf(mapped, airbnbA)).toMatchObject({
      status: 'live',
      live_from: TODAY,
      last_error: null,
    });
    const logged = await owner<{ kind: string; status: string }>(
      `select kind, status from app.sync_log where property_id = $1 and kind = 'link' order by id desc limit 1`,
      [mapped],
    );
    expect(logged).toEqual([{ kind: 'link', status: 'ok' }]);
  });

  it('refuses to link a property that is not in Channex, and says so on the link', async () => {
    const { channex_channel_id } = (await connectionOf(airbnbA))!;
    const fresh = await providerKnowing();
    await owner(
      `insert into app.channel_listings (organisation_id, property_id, channel_account_id, channel, external_listing_id, status)
       values ($1, $2, $3, 'airbnb', '55598765', 'linking')`,
      [op.orgId, unmapped, airbnbA],
    );
    const stats = await syncChannelLinks({ ...deps, provider: fresh });
    expect(stats.failed).toBeGreaterThanOrEqual(1);
    expect(await linkOf(unmapped, airbnbA)).toMatchObject({
      status: 'linking',
      last_error: 'Connect the property to Channex first.',
    });
    // The mapping set sent still carries the live link, and nothing for the unmapped property.
    expect(fresh.channels.get(channex_channel_id)?.mappings).toEqual([
      { ratePlanId: 'cx-hvl-rate', externalListingId: '55512345' },
    ]);
    await owner(`delete from app.channel_listings where property_id = $1`, [unmapped]);
  });

  it('unlinks by sending the set without it, then archives the link', async () => {
    const { channex_channel_id } = (await connectionOf(airbnbA))!;
    const fresh = await providerKnowing();
    fresh.channels.get(channex_channel_id)!.mappings = [
      { ratePlanId: 'cx-hvl-rate', externalListingId: '55512345' },
    ];
    await owner(
      `update app.channel_listings set status = 'closing' where property_id = $1 and channel_account_id = $2`,
      [mapped, airbnbA],
    );
    const stats = await syncChannelLinks({ ...deps, provider: fresh });
    expect(stats).toMatchObject({ unlinked: 1 });
    expect(fresh.channels.get(channex_channel_id)?.mappings).toEqual([]);
    expect(await linkOf(mapped, airbnbA)).toMatchObject({ status: 'archived' });
  });

  it('keeps a link waiting, with the reason, while the account’s owner has not authorised', async () => {
    const { channex_channel_id } = (await connectionOf(bookingA))!;
    const fresh = new FakeChannelProvider();
    fresh.channels.set(channex_channel_id, {
      setup: {
        channel: 'booking_com',
        title: 'Booking.com A',
        groupId: 'g',
        externalPropertyIds: ['cx-hvl'],
      },
      active: false,
      mappings: [],
      listings: [],
    });
    await owner(
      `insert into app.channel_listings (organisation_id, property_id, channel_account_id, channel, external_listing_id, status)
       values ($1, $2, $3, 'booking_com', '987654', 'linking')`,
      [op.orgId, mapped, bookingA],
    );
    await syncChannelLinks({ ...deps, provider: fresh });
    expect(await linkOf(mapped, bookingA)).toMatchObject({
      status: 'linking',
      last_error: "Booking.com A isn't connected yet; the account's owner has to authorise it.",
    });
  });
});

describe('Airbnb specifics through Channex', () => {
  let airbnbA: string;
  let channelId: string;
  const linkRow = async () => {
    const [row] = await owner<{
      channex_mapping_id: string | null;
      settings_synced: boolean;
      settings_error: string | null;
      published: boolean | null;
      published_wanted: boolean;
    }>(
      `select channex_mapping_id, settings_synced_at is not null as settings_synced, settings_error, published, published_wanted
         from app.channel_listings where property_id = $1 and channel = 'airbnb' and status = 'live'`,
      [mapped],
    );
    return row;
  };
  const providerWith = () => {
    const fresh = new FakeChannelProvider();
    fresh.channels.set(channelId, {
      setup: { channel: 'airbnb', title: 'Airbnb A', groupId: 'g', externalPropertyIds: ['cx-hvl'] },
      active: true,
      mappings: [],
      listings: [],
    });
    return fresh;
  };

  beforeAll(async () => {
    const [account] = await owner<{ id: string }>(
      `select a.id from app.channel_accounts a where a.organisation_id = $1 and a.label = 'Airbnb A'`,
      [op.orgId],
    );
    airbnbA = account!.id;
    const [conn] = await owner<{ channex_channel_id: string }>(
      'select channex_channel_id from app.channex_channels where channel_account_id = $1',
      [airbnbA],
    );
    channelId = conn!.channex_channel_id;
    await owner(
      `update app.properties set base_price_minor = 15000, weekend_price_minor = 17500, cleaning_fee_minor = 6000,
          extra_guest_fee_minor = 2500, extra_guest_from = 3, security_deposit_minor = 20000, instant_book = true,
          cancellation_policy = 'strict' where id = $1`,
      [mapped],
    );
    // Only the Airbnb account is in play here: the Booking.com one stops waiting for its owner.
    await owner(
      `update app.channel_accounts set status = 'disconnected' where organisation_id = $1 and channel = 'booking_com'`,
      [op.orgId],
    );
    await owner(`delete from app.channel_listings where channel = 'booking_com'`);
    // A fresh live link, as the worker leaves one after linking.
    await owner(`delete from app.channel_listings where property_id = $1 and channel_account_id = $2`, [
      mapped,
      airbnbA,
    ]);
    await owner(
      `insert into app.channel_listings (organisation_id, property_id, channel_account_id, channel, external_listing_id, status, live_from, channex_mapping_id)
       values ($1, $2, $3, 'airbnb', '55512345', 'live', '2026-10-15', 'fake-mapping-cx-hvl-rate-55512345')`,
      [op.orgId, mapped, airbnbA],
    );
  });

  it('sends the property’s fees, prices and booking rules to Airbnb once the link is live', async () => {
    const fresh = providerWith();
    await syncChannelLinks({ ...deps, provider: fresh });
    expect(fresh.airbnbSettings.get('fake-mapping-cx-hvl-rate-55512345')).toEqual({
      currency: 'GBP',
      defaultDailyPrice: 150,
      weekendPrice: 175,
      guestsIncluded: 2,
      pricePerExtraPerson: 25,
      cleaningFee: 60,
      securityDeposit: 200,
      instantBook: true,
      checkInTime: '15:00',
      checkOutTime: '10:00',
      cancellationPolicy: 'strict',
    });
    expect(await linkRow()).toMatchObject({ settings_synced: true, settings_error: null });
  });

  it('sends them again when the property’s fees or rules change', async () => {
    await owner(`update app.properties set cleaning_fee_minor = 7500 where id = $1`, [mapped]);
    expect(await linkRow()).toMatchObject({ settings_synced: false });
    const fresh = providerWith();
    await syncChannelLinks({ ...deps, provider: fresh });
    expect(fresh.airbnbSettings.get('fake-mapping-cx-hvl-rate-55512345')?.cleaningFee).toBe(75);
    // A change to something Airbnb doesn't take (the title) leaves it alone.
    await owner(`update app.properties set title = 'Harbour View Lodge, sea views' where id = $1`, [mapped]);
    expect(await linkRow()).toMatchObject({ settings_synced: true });
  });

  it('pauses the listing on Airbnb when asked, and puts it back', async () => {
    await owner(
      `update app.channel_listings set published_wanted = false where property_id = $1 and channel = 'airbnb'`,
      [mapped],
    );
    let fresh = providerWith();
    await syncChannelLinks({ ...deps, provider: fresh });
    expect(fresh.published.get('55512345')).toBe(false);
    expect(await linkRow()).toMatchObject({ published: false, published_wanted: false });
    await owner(
      `update app.channel_listings set published_wanted = true where property_id = $1 and channel = 'airbnb'`,
      [mapped],
    );
    fresh = providerWith();
    await syncChannelLinks({ ...deps, provider: fresh });
    expect(fresh.published.get('55512345')).toBe(true);
    expect(await linkRow()).toMatchObject({ published: true });
  });

  it('keeps a refusal on the link instead of asking Airbnb again and again', async () => {
    await owner(`update app.properties set cleaning_fee_minor = 8000 where id = $1`, [mapped]);
    const fresh = providerWith();
    fresh.failNextCallWith(new ChannelError('Airbnb refused the cleaning fee', 'validation', 422));
    await syncChannelLinks({ ...deps, provider: fresh });
    expect(await linkRow()).toMatchObject({
      settings_synced: true,
      settings_error: 'Airbnb refused the cleaning fee',
    });
  });
});
