import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { keyInExampleEnv, parseCheckArgs, runChannexCheck } from '../src/channex-check.ts';

/**
 * `pnpm channex:check` against a stand-in for Channex's API, since tests never reach the real one.
 * The stand-in keeps prices as Channex reads them back: decimals such as "150.00".
 */

const KEY = 'test-key-0123456789abcdef';
const NOW = new Date('2026-10-15T09:00:00Z');

interface Stub {
  /** Which server knows the key. */
  knownOn: 'staging' | 'live';
  /** Behave as if Channex read integer prices as whole units, to prove the check notices. */
  ratesAsWholeUnits?: boolean;
  /** Turn down every price with a warning, the way Channex does with a 200. */
  warnOnRates?: boolean;
  properties?: number;
  /** The account already has the test property, from an earlier run. */
  testPropertyMade?: boolean;
  /** Turn down a new rate plan, to prove a half-made property is cleaned up. */
  refuseRatePlans?: boolean;
}

function stubChannex(stub: Stub) {
  const property = (n: number) => ({
    id: `prop-${n}`,
    type: 'property',
    attributes: { title: `Test cottage ${n}`, currency: 'GBP', timezone: 'Europe/London' },
  });
  const state = {
    properties: [
      ...Array.from({ length: stub.properties ?? 1 }, (_, i) => property(i + 1)),
      ...(stub.testPropertyMade
        ? [
            {
              id: 'prop-test',
              type: 'property',
              attributes: { title: 'V-01 test property', currency: 'GBP' },
            },
          ]
        : []),
    ],
    made: {} as Record<string, unknown>,
    rates: new Map<string, string>(),
    minStays: new Map<string, number>(),
    availability: new Map<string, number>(),
    calls: [] as string[],
    bodies: [] as unknown[],
  };

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  const fetchStub = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const path = url.pathname.replace(/^\/api\/v1/, '');
    const server = url.hostname === 'staging.channex.io' ? 'staging' : 'live';
    state.calls.push(`${method} ${server} ${path}`);
    const key = new Headers(init?.headers).get('user-api-key');
    if (server !== stub.knownOn || key !== KEY) return json(401, { errors: { title: 'Unauthorized' } });

    const q = url.searchParams;
    const forProperty = q.get('filter[property_id]');
    if (method === 'GET' && path === '/properties') {
      return json(200, { data: state.properties, meta: { total: state.properties.length } });
    }
    if (method === 'GET' && path.startsWith('/properties/')) {
      const found = state.properties.find((p) => p.id === path.split('/')[2]);
      return found ? json(200, { data: found }) : json(404, { errors: { title: 'Not found' } });
    }
    if (method === 'GET' && path === '/room_types') {
      return json(200, {
        data: [
          {
            id: `${forProperty}-room`,
            attributes: { title: 'Whole cottage', count_of_rooms: 1 },
            relationships: { property: { data: { id: forProperty } } },
          },
        ],
      });
    }
    if (method === 'GET' && path === '/rate_plans') {
      return json(200, {
        data: [
          {
            id: `${forProperty}-rate`,
            attributes: { title: 'Standard', currency: 'GBP' },
            relationships: { room_type: { data: { id: `${forProperty}-room` } } },
          },
        ],
      });
    }
    if (method === 'GET' && path === '/channels') {
      return json(200, {
        data: [
          {
            id: 'ch-1',
            attributes: { channel: 'AirBNB', title: 'Airbnb', is_active: true, properties: ['prop-1'] },
          },
        ],
      });
    }
    if (method === 'GET' && path === '/booking_revisions/feed') {
      return json(200, { data: [{ id: 'rev-1' }, { id: 'rev-2' }], meta: { total: 2 } });
    }
    const date = q.get('filter[date][gte]') ?? '';
    if (method === 'GET' && path === '/restrictions') {
      const plan = `${forProperty}-rate`;
      const k = `${plan}|${date}`;
      return json(200, {
        data: {
          [plan]: {
            [date]: { rate: state.rates.get(k) ?? '150.00', min_stay_arrival: state.minStays.get(k) ?? 1 },
          },
        },
      });
    }
    if (method === 'GET' && path === '/availability') {
      const room = `${forProperty}-room`;
      return json(200, { data: { [room]: { [date]: state.availability.get(`${room}|${date}`) ?? 1 } } });
    }
    if (method === 'POST' && path === '/restrictions') {
      const body = JSON.parse(String(init?.body)) as { values: Record<string, unknown>[] };
      state.bodies.push(body);
      if (stub.warnOnRates && body.values.some((v) => v.rate !== undefined)) {
        return json(200, {
          data: [{ id: 'task-r', type: 'task' }],
          meta: { warnings: ['rate: is invalid'] },
        });
      }
      for (const v of body.values) {
        const k = `${v.rate_plan_id}|${v.date_from}`;
        if (typeof v.rate === 'number') {
          state.rates.set(k, stub.ratesAsWholeUnits ? v.rate.toFixed(2) : (v.rate / 100).toFixed(2));
        }
        if (typeof v.min_stay_arrival === 'number') state.minStays.set(k, v.min_stay_arrival);
      }
      return json(200, {
        data: [{ id: 'task-r', type: 'task' }],
        meta: { message: 'Success', warnings: [] },
      });
    }
    if (method === 'POST' && path === '/properties') {
      const body = JSON.parse(String(init?.body)) as { property: { title: string; currency: string } };
      state.made.property = body;
      const made = {
        id: `prop-${state.properties.length + 1}`,
        type: 'property',
        attributes: { title: body.property.title, currency: body.property.currency },
      };
      state.properties.push(made);
      return json(201, { data: made });
    }
    if (method === 'POST' && path === '/room_types') {
      const body = JSON.parse(String(init?.body)) as { room_type: { property_id: string } };
      state.made.roomType = body;
      return json(201, { data: { id: `${body.room_type.property_id}-room`, type: 'room_type' } });
    }
    if (method === 'POST' && path === '/rate_plans') {
      const body = JSON.parse(String(init?.body)) as { rate_plan: { property_id: string } };
      state.made.ratePlan = body;
      if (stub.refuseRatePlans) {
        return json(422, {
          errors: {
            code: 'validation_error',
            title: 'Validation Error',
            details: { options: ['is invalid'] },
          },
        });
      }
      return json(201, { data: { id: `${body.rate_plan.property_id}-rate`, type: 'rate_plan' } });
    }
    if (method === 'DELETE' && path.startsWith('/properties/')) {
      state.properties = state.properties.filter((p) => p.id !== path.split('/')[2]);
      return json(200, { meta: { message: 'Success' } });
    }
    if (method === 'POST' && path === '/availability') {
      const body = JSON.parse(String(init?.body)) as { values: Record<string, unknown>[] };
      state.bodies.push(body);
      for (const v of body.values) {
        state.availability.set(`${v.room_type_id}|${v.date_from}`, Number(v.availability));
      }
      return json(200, {
        data: [{ id: 'task-a', type: 'task' }],
        meta: { message: 'Success', warnings: [] },
      });
    }
    return json(404, { errors: { title: 'Not found' } });
  }) as typeof fetch;

  return { state, fetch: fetchStub };
}

async function check(
  stub: ReturnType<typeof stubChannex>,
  extra: { roundTrip?: string; makeTestProperty?: boolean; apiKey?: string; exampleEnv?: string } = {},
) {
  const lines: string[] = [];
  const passed = await runChannexCheck({
    apiKey: extra.apiKey ?? KEY,
    roundTrip: extra.roundTrip,
    makeTestProperty: extra.makeTestProperty,
    exampleEnv: extra.exampleEnv ?? null,
    fetch: stub.fetch,
    now: NOW,
    sleep: async () => {},
    print: (line) => lines.push(line),
  });
  return { passed, output: lines.join('\n') };
}

describe('pnpm channex:check', () => {
  it('reads the account on staging, and never prints the key or touches the booking feed', async () => {
    const stub = stubChannex({ knownOn: 'staging' });
    const { passed, output } = await check(stub);
    expect(passed).toBe(true);
    expect(output).toContain('Channex staging accepted the key.');
    expect(output).toContain('Test cottage 1 (GBP)');
    expect(output).toContain('Channex id: prop-1');
    expect(output).toContain('Room types: Whole cottage (1 unit)');
    expect(output).toContain('Rate plans: Standard');
    expect(output).toContain('Channels: Airbnb, on');
    expect(output).toContain('2 booking changes are waiting in the feed.');
    expect(output).toContain('pnpm channex:check --round-trip <Channex property id>');
    expect(output).not.toContain(KEY);
    // Reads only: nothing sent, nothing acknowledged.
    expect(stub.state.calls.filter((c) => !c.startsWith('GET'))).toEqual([]);
  });

  it('tries live when staging does not know the key, and keeps the round trip off live', async () => {
    const stub = stubChannex({ knownOn: 'live' });
    const { passed, output } = await check(stub, { roundTrip: 'prop-1' });
    expect(output).toContain("Channex live accepted the key (Channex staging didn't know it).");
    expect(output).toContain('only runs on Channex staging');
    expect(passed).toBe(false);
    expect(stub.state.calls.filter((c) => c.startsWith('POST'))).toEqual([]);
  });

  it('says plainly when no server knows the key', async () => {
    const { passed, output } = await check(stubChannex({ knownOn: 'staging' }), { apiKey: 'not-the-key' });
    expect(passed).toBe(false);
    expect(output).toContain('Channex staging and Channex live refused the key.');
    expect(output).not.toContain('not-the-key');
  });

  it('asks for the key when there is none', async () => {
    const { passed, output } = await check(stubChannex({ knownOn: 'staging' }), { apiKey: '  ' });
    expect(passed).toBe(false);
    expect(output).toContain('No CHANNEX_API_KEY in apps/worker/.env.');
  });

  it('sends a test night through the adapter, reads it back, then puts the night back', async () => {
    const stub = stubChannex({ knownOn: 'staging' });
    const { passed, output } = await check(stub, { roundTrip: 'prop-1' });
    expect(output).toContain('Test cottage 1, Wed 11 Aug 2027');
    expect(output).toContain('Read the night as it is: £150.00 a night, minimum stay 1, open.');
    expect(output).toContain('Sent £151.00 a night, minimum stay 2, closed (Channex task task-r, task-a).');
    expect(output).toContain('Channex shows £151.00 a night, minimum stay 2, closed.');
    expect(output).toContain('Channex shows the night as it was: £150.00 a night, minimum stay 1, open.');
    expect(passed).toBe(true);
    // The price went out in minor units, as the worker will send it.
    expect(stub.state.bodies[0]).toEqual({
      values: [
        {
          property_id: 'prop-1',
          rate_plan_id: 'prop-1-rate',
          date_from: '2027-08-11',
          date_to: '2027-08-11',
          rate: 15_100,
          min_stay_arrival: 2,
        },
      ],
    });
  });

  it('notices when Channex reads prices differently from how the adapter sends them', async () => {
    const { passed, output } = await check(stubChannex({ knownOn: 'staging', ratesAsWholeUnits: true }), {
      roundTrip: 'prop-1',
    });
    expect(passed).toBe(false);
    expect(output).toContain('Channex shows £15,100.00 a night, minimum stay 2, closed, not £151.00 a night');
    expect(output).toContain('Channex read the price as whole units.');
  });

  it("reports Channex's warnings instead of trusting the 200", async () => {
    const { passed, output } = await check(stubChannex({ knownOn: 'staging', warnOnRates: true }), {
      roundTrip: 'prop-1',
    });
    expect(passed).toBe(false);
    expect(output).toContain('but Channex turned part of it down:');
    expect(output).toContain('rate: is invalid');
  });

  it('refuses a round trip on a property the account does not have', async () => {
    const { passed, output } = await check(stubChannex({ knownOn: 'staging' }), { roundTrip: 'prop-9' });
    expect(passed).toBe(false);
    expect(output).toContain('Channex has no property with the id prop-9.');
  });

  it('offers to make a test property when a staging account has none', async () => {
    const { passed, output } = await check(stubChannex({ knownOn: 'staging', properties: 0 }));
    expect(passed).toBe(true);
    expect(output).toContain('The account has no properties yet.');
    expect(output).toContain('pnpm channex:check --make-test-property');
    expect(output).not.toContain('--round-trip');
  });

  it('makes a test property through the adapter, then sends it a test night', async () => {
    const stub = stubChannex({ knownOn: 'staging', properties: 0 });
    const { passed, output } = await check(stub, { makeTestProperty: true });
    expect(output).toContain('Made "V-01 test property" on staging, with one unit and one rate plan.');
    expect(output).toContain('Channex id: prop-1');
    expect(output).toContain('Channex shows £151.00 a night, minimum stay 2, closed.');
    expect(passed).toBe(true);
    expect(stub.state.made).toEqual({
      property: {
        property: {
          title: 'V-01 test property',
          currency: 'GBP',
          country: 'GB',
          timezone: 'Europe/London',
          settings: {
            allow_availability_autoupdate_on_confirmation: true,
            allow_availability_autoupdate_on_modification: true,
            allow_availability_autoupdate_on_cancellation: true,
            min_stay_type: 'arrival',
          },
        },
      },
      roomType: {
        room_type: {
          property_id: 'prop-1',
          title: 'Whole place',
          count_of_rooms: 1,
          occ_adults: 4,
          occ_children: 0,
          occ_infants: 0,
          default_occupancy: 4,
          room_kind: 'room',
        },
      },
      ratePlan: {
        rate_plan: {
          title: 'Standard',
          property_id: 'prop-1',
          room_type_id: 'prop-1-room',
          currency: 'GBP',
          sell_mode: 'per_room',
          rate_mode: 'manual',
          options: [{ occupancy: 4, is_primary: true, rate: 0 }],
        },
      },
    });
  });

  it('uses the test property made before rather than making another', async () => {
    const stub = stubChannex({ knownOn: 'staging', testPropertyMade: true });
    const { passed, output } = await check(stub, { makeTestProperty: true });
    expect(output).toContain('Using "V-01 test property", made before.');
    expect(output).toContain('Channex id: prop-test');
    expect(passed).toBe(true);
    expect(stub.state.calls).not.toContain('POST staging /properties');
  });

  it('never makes a test property on live', async () => {
    const stub = stubChannex({ knownOn: 'live', properties: 0 });
    const { passed, output } = await check(stub, { makeTestProperty: true });
    expect(passed).toBe(false);
    expect(output).toContain(
      'A test property is only made on Channex staging. This key is for Channex live.',
    );
    expect(stub.state.calls.filter((c) => !c.startsWith('GET'))).toEqual([]);
  });

  it('removes a half-made property when Channex turns down part of it, and says why', async () => {
    const stub = stubChannex({ knownOn: 'staging', properties: 0, refuseRatePlans: true });
    const { passed, output } = await check(stub, { makeTestProperty: true });
    expect(passed).toBe(false);
    expect(output).toContain(
      'The test property stopped: Channex POST /rate_plans returned 422: Validation Error {"options":["is invalid"]} The property it had made is removed again.',
    );
    expect(stub.state.calls).toContain('DELETE staging /properties/prop-1');
    expect(stub.state.properties).toEqual([]);
  });

  it('says which code it runs from, and refuses options it does not know', async () => {
    const lines: string[] = [];
    await runChannexCheck({
      version: '3a92166',
      apiKey: KEY,
      fetch: stubChannex({ knownOn: 'staging' }).fetch,
      now: NOW,
      print: (line) => lines.push(line),
    });
    expect(lines[0]).toBe('V-01 Channex check, code 3a92166');

    expect(parseCheckArgs([])).toEqual({ makeTestProperty: false });
    expect(parseCheckArgs(['--make-test-property'])).toEqual({ makeTestProperty: true });
    expect(parseCheckArgs(['--round-trip', 'prop-1'])).toEqual({
      roundTrip: 'prop-1',
      makeTestProperty: false,
    });
    expect(parseCheckArgs(['--round-trip'])).toEqual({
      error: 'Give the Channex property id after --round-trip: pnpm channex:check --round-trip <id>',
    });
    expect(parseCheckArgs(['--make-test-propery'])).toEqual({
      error:
        'Unknown option --make-test-propery. The options are --round-trip <Channex property id> and --make-test-property.',
    });
    expect(parseCheckArgs(['--round-trip', 'prop-1', '--make-test-property'])).toEqual({
      error: 'Use --round-trip or --make-test-property, not both.',
    });
  });

  it('warns when the key was pasted into the example file, which git tracks', async () => {
    const example = `CHANNEL_PROVIDER=fake\n# CHANNEX_API_KEY=${KEY}\n`;
    expect(keyInExampleEnv(example)).toBe(true);
    expect(keyInExampleEnv('# CHANNEX_API_KEY=\n')).toBe(false);
    const { passed, output } = await check(stubChannex({ knownOn: 'staging' }), { exampleEnv: example });
    expect(passed).toBe(false);
    expect(output).toContain('There is a Channex key in apps/worker/.env.example, which git tracks.');
    expect(output).not.toContain(KEY);
  });
});

describe('example env files', () => {
  const SECRETS = [
    'CHANNEX_API_KEY',
    'CHANNEX_WEBHOOK_SECRET',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_JWT_SECRET',
    'SLACK_ALERTS_WEBHOOK_URL',
    'APP_API_DB_PASSWORD',
    'APP_WORKER_DB_PASSWORD',
    'APP_JOBS_DB_PASSWORD',
  ];

  it('hold no keys, secrets or passwords, commented out or not', () => {
    const root = fileURLToPath(new URL('../../..', import.meta.url));
    const files = ['apps', 'packages'].flatMap((group) =>
      readdirSync(join(root, group))
        .map((name) => join(root, group, name, '.env.example'))
        .filter((file) => {
          try {
            readFileSync(file);
            return true;
          } catch {
            return false;
          }
        }),
    );
    expect(files.length).toBeGreaterThanOrEqual(4);
    const leaks = files.flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .map((line) => /^\s*#?\s*([A-Z0-9_]+)\s*=\s*(\S*)/.exec(line))
        .filter((m): m is RegExpExecArray => Boolean(m && SECRETS.includes(m[1] ?? '') && m[2]))
        .map((m) => `${file.slice(root.length)}: ${m[1]}`),
    );
    expect(leaks).toEqual([]);
  });
});
