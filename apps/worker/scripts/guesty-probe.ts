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
  if (process.argv.includes('--documents')) {
    // Owner documents: counts only, never names or file names.
    let owners = 0;
    let withDocs = 0;
    let withContract = 0;
    const byType: Record<string, number> = {};
    let dated = 0;
    let shared = 0;
    for await (const o of guesty.owners()) {
      owners += 1;
      const page = await guesty.get<{
        results?: { type?: string; startDate?: string; endDate?: string; isShared?: boolean }[];
      }>(`/v1/owners/${o._id}/documents`, { limit: 100, isExpired: 'true' });
      const docs = page.results ?? [];
      if (docs.length) withDocs += 1;
      if (docs.some((d) => d.type === 'CONTRACT')) withContract += 1;
      for (const d of docs) {
        byType[d.type ?? '?'] = (byType[d.type ?? '?'] ?? 0) + 1;
        if (d.startDate || d.endDate) dated += 1;
        if (d.isShared) shared += 1;
      }
    }
    console.log(
      JSON.stringify(
        {
          owners,
          ownersWithDocuments: withDocs,
          ownersWithAContract: withContract,
          documentsByType: byType,
          documentsWithDates: dated,
          sharedWithOwner: shared,
        },
        null,
        2,
      ),
    );
    process.exit(0);
  }
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
