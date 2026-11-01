import { GuestyClient } from '@v01/integrations';
import { liveDeps } from '../src/live-deps.ts';

/**
 * pnpm guesty:probe — shows the SHAPE of a few Guesty bookings' money (field names and whether
 * each is a number), never names or guest details, so the import can read the right fields.
 * Reuses the saved Guesty token when it is still valid.
 */

const { env, deps } = liveDeps(undefined, { applicationName: 'v01-guesty-probe', queryTimeoutMs: 60_000 });
if (!env.GUESTY_CLIENT_ID || !env.GUESTY_CLIENT_SECRET) throw new Error('No Guesty credentials.');
const clientId = env.GUESTY_CLIENT_ID;
const guesty = new GuestyClient({
  clientId,
  clientSecret: env.GUESTY_CLIENT_SECRET,
  baseUrl: env.GUESTY_API_URL,
  tokens: {
    load: () => deps.db.loadToken('guesty', clientId),
    save: (_id, token, remaining) => deps.db.saveToken('guesty', clientId, token, remaining),
  },
});

function shape(value: unknown, depth = 0): unknown {
  if (value === null) return 'null';
  if (Array.isArray(value)) return value.length ? [shape(value[0], depth + 1)] : [];
  if (typeof value === 'object') {
    if (depth > 3) return '{…}';
    return Object.fromEntries(Object.entries(value as object).map(([k, v]) => [k, shape(v, depth + 1)]));
  }
  if (typeof value === 'number') return value > 0 ? 'number>0' : `number(${value})`;
  return typeof value;
}

try {
  for (const fields of ['money status', undefined]) {
    const page = await guesty.get<{ results?: Record<string, unknown>[] }>('/v1/reservations', {
      limit: 2,
      skip: 40,
      ...(fields ? { fields } : {}),
      filters: JSON.stringify([{ field: 'status', operator: '$eq', value: 'confirmed' }]),
    });
    console.log(`\nWith fields=${fields ?? '(none)'}:`);
    for (const r of page.results ?? []) {
      console.log(JSON.stringify({ topLevelKeys: Object.keys(r), money: shape(r.money) }, null, 2));
    }
  }
} finally {
  await deps.db.close();
}
