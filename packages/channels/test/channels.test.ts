import { describe, expect, it } from 'vitest';
import {
  ChannelError,
  ChannexClient,
  ChannexProvider,
  createChannexRateLimiter,
  signChannexWebhook,
  verifyChannexWebhook,
} from '../src/index.ts';

const SECRET = 'whsec_test_0123456789abcdef';
const BODY = JSON.stringify({ event: 'booking', property_id: 'cx-1', timestamp: '2026-10-14T10:00:00Z' });

describe('Channex webhook signatures', () => {
  const now = 1_791_986_400;

  it('accepts a correctly signed body', () => {
    const headers = signChannexWebhook(BODY, SECRET, now);
    expect(verifyChannexWebhook({ rawBody: BODY, headers, secret: SECRET, nowSeconds: now })).toEqual({
      ok: true,
    });
  });

  it('accepts either signature during key rotation', () => {
    const headers = signChannexWebhook(BODY, SECRET, now);
    headers['x-hmac-signature-256'] = `${'0'.repeat(64)}, ${headers['x-hmac-signature-256']}`;
    expect(verifyChannexWebhook({ rawBody: BODY, headers, secret: SECRET, nowSeconds: now }).ok).toBe(true);
  });

  it('rejects a body changed after signing', () => {
    const headers = signChannexWebhook(BODY, SECRET, now);
    const tampered = BODY.replace('cx-1', 'cx-2');
    expect(verifyChannexWebhook({ rawBody: tampered, headers, secret: SECRET, nowSeconds: now })).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('rejects anything older than five minutes', () => {
    const headers = signChannexWebhook(BODY, SECRET, now - 301);
    expect(verifyChannexWebhook({ rawBody: BODY, headers, secret: SECRET, nowSeconds: now })).toEqual({
      ok: false,
      reason: 'stale_timestamp',
    });
  });

  it('rejects unsigned requests', () => {
    expect(verifyChannexWebhook({ rawBody: BODY, headers: {}, secret: SECRET, nowSeconds: now })).toEqual({
      ok: false,
      reason: 'missing_signature',
    });
  });
});

describe('rate limiter', () => {
  it('allows ten calls a minute per property, then waits', () => {
    let clock = 0;
    const limiter = createChannexRateLimiter(() => clock);
    for (let i = 0; i < 10; i++) expect(limiter.tryTake('availability:p1').ok).toBe(true);
    const blocked = limiter.tryTake('availability:p1');
    expect(blocked).toEqual({ ok: false, retryInMs: 60_000 });
    expect(limiter.tryTake('availability:p2').ok).toBe(true);
    clock = 60_001;
    expect(limiter.tryTake('availability:p1').ok).toBe(true);
  });

  it('pauses a property for a minute after an error', () => {
    let clock = 0;
    const limiter = createChannexRateLimiter(() => clock);
    limiter.pause('restrictions:p1', 60_000);
    expect(limiter.tryTake('restrictions:p1')).toEqual({ ok: false, retryInMs: 60_000 });
    clock = 60_000;
    expect(limiter.tryTake('restrictions:p1').ok).toBe(true);
  });
});

function mockFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers });
  }) as unknown as typeof fetch;
  return { calls, impl };
}

const REF = { externalPropertyId: 'cx-prop', externalRoomTypeId: 'cx-room', externalRatePlanId: 'cx-rate' };

describe('Channex adapter', () => {
  it('sends availability in one call with the API key header', async () => {
    const { calls, impl } = mockFetch(200, {
      data: [{ id: 'task-1', type: 'task' }],
      meta: { warnings: [] },
    });
    const provider = new ChannexProvider({
      baseUrl: 'https://staging.channex.io/api/v1',
      apiKey: 'key',
      fetch: impl,
    });
    const result = await provider.pushAvailability([
      { ref: REF, dateFrom: '2026-11-01', dateTo: '2026-11-30', available: 1 },
      { ref: REF, dateFrom: '2026-12-01', dateTo: '2026-12-03', available: 0 },
    ]);
    expect(result).toEqual({ taskId: 'task-1', warnings: [] });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://staging.channex.io/api/v1/availability');
    expect((calls[0]!.init.headers as Record<string, string>)['user-api-key']).toBe('key');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      values: [
        {
          property_id: 'cx-prop',
          room_type_id: 'cx-room',
          date_from: '2026-11-01',
          date_to: '2026-11-30',
          availability: 1,
        },
        {
          property_id: 'cx-prop',
          room_type_id: 'cx-room',
          date_from: '2026-12-01',
          date_to: '2026-12-03',
          availability: 0,
        },
      ],
    });
  });

  it('sends prices as minor units and surfaces warnings returned with a 200', async () => {
    const { calls, impl } = mockFetch(200, {
      data: [{ id: 'task-2', type: 'task' }],
      meta: { warnings: [{ rate: ['must be greater than 0'] }] },
    });
    const provider = new ChannexProvider({ baseUrl: 'https://x/api/v1', apiKey: 'key', fetch: impl });
    const result = await provider.pushRestrictions([
      { ref: REF, dateFrom: '2026-11-01', dateTo: '2026-11-01', rateMinor: 14250, minStayArrival: 2 },
    ]);
    expect(result.warnings).toHaveLength(1);
    expect(JSON.parse(String(calls[0]?.init.body)).values[0]).toEqual({
      property_id: 'cx-prop',
      rate_plan_id: 'cx-rate',
      date_from: '2026-11-01',
      date_to: '2026-11-01',
      rate: 14250,
      min_stay_arrival: 2,
    });
  });

  it('sends every stay rule, with no longest stay as 0', async () => {
    const { calls, impl } = mockFetch(200, { data: [{ id: 'task-3', type: 'task' }] });
    const provider = new ChannexProvider({ baseUrl: 'https://x/api/v1', apiKey: 'key', fetch: impl });
    await provider.pushRestrictions([
      {
        ref: REF,
        dateFrom: '2026-11-01',
        dateTo: '2026-11-07',
        minStayArrival: 3,
        maxStay: null,
        closedToArrival: true,
        closedToDeparture: false,
      },
      { ref: REF, dateFrom: '2026-11-08', dateTo: '2026-11-08', minStayArrival: 1, maxStay: 14 },
    ]);
    const [closed, open] = JSON.parse(String(calls[0]?.init.body)).values;
    expect(closed).toMatchObject({
      min_stay_arrival: 3,
      max_stay: 0,
      closed_to_arrival: true,
      closed_to_departure: false,
    });
    expect(closed).not.toHaveProperty('rate');
    expect(open).toMatchObject({ min_stay_arrival: 1, max_stay: 14 });
  });

  it('turns a 429 into a retryable rate-limit error', async () => {
    const { impl } = mockFetch(
      429,
      { errors: { code: 'too_many_requests', title: 'Too Many Requests' } },
      { 'retry-after': '30' },
    );
    const client = new ChannexClient({ baseUrl: 'https://x/api/v1', apiKey: 'key', fetch: impl });
    const error = await client.request('POST', '/availability', { values: [] }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ChannelError);
    expect((error as ChannelError).kind).toBe('rate_limited');
    expect((error as ChannelError).retryAfterMs).toBe(30_000);
    expect((error as ChannelError).retryable).toBe(true);
  });

  it('treats a validation error as needing a person, not a retry', async () => {
    const { impl } = mockFetch(422, { errors: { code: 'validation_error', title: 'Validation Error' } });
    const client = new ChannexClient({ baseUrl: 'https://x/api/v1', apiKey: 'key', fetch: impl });
    const error = (await client
      .request('POST', '/restrictions', {})
      .catch((e: unknown) => e)) as ChannelError;
    expect(error.kind).toBe('validation');
    expect(error.retryable).toBe(false);
  });

  it('reads the booking revision feed oldest first and acknowledges by id', async () => {
    const { calls, impl } = mockFetch(200, {
      data: [
        {
          id: 'rev-1',
          type: 'booking_revision',
          attributes: {
            booking_id: 'bk-1',
            property_id: 'cx-prop',
            status: 'new',
            arrival_date: '2026-11-13',
            departure_date: '2026-11-15',
            ota_name: 'Airbnb',
            ota_reservation_code: 'HMABC123',
            amount: '284.00',
            currency: 'GBP',
          },
        },
      ],
    });
    const provider = new ChannexProvider({ baseUrl: 'https://x/api/v1', apiKey: 'key', fetch: impl });
    const [revision] = await provider.fetchBookingRevisionFeed({ externalPropertyId: 'cx-prop' });
    expect(revision).toMatchObject({
      id: 'rev-1',
      status: 'new',
      arrivalDate: '2026-11-13',
      otaReservationCode: 'HMABC123',
    });
    const feedUrl = new URL(calls[0]?.url ?? '');
    expect(feedUrl.pathname).toBe('/api/v1/booking_revisions/feed');
    expect(feedUrl.searchParams.get('order[inserted_at]')).toBe('asc');
    expect(feedUrl.searchParams.get('filter[property_id]')).toBe('cx-prop');

    await provider.acknowledgeBookingRevision('rev-1');
    expect(calls[1]?.url).toBe('https://x/api/v1/booking_revisions/rev-1/ack');
    expect(calls[1]?.init.method).toBe('POST');
  });
});
