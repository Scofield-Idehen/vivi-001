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
  if (process.argv.includes('--cleaners')) {
    // Who does the cleaning in Guesty: counts and field names only, never names, emails or phones.
    const keysOf = (items: Record<string, unknown>[]) =>
      [...new Set(items.slice(0, 20).flatMap((i) => Object.keys(i)))].sort();
    const tally = (values: unknown[]) => {
      const out: Record<string, number> = {};
      for (const v of values) {
        const k = typeof v === 'string' ? v : JSON.stringify(v ?? null).slice(0, 40);
        out[k] = (out[k] ?? 0) + 1;
      }
      return out;
    };
    if (process.argv.includes('--deep')) {
      const users: Record<string, unknown>[] = [];
      for await (const u of guesty.pages<Record<string, unknown>>('/v1/users')) users.push(u);
      const roles = users.flatMap((u) =>
        Array.isArray(u.roles) ? (u.roles as Record<string, unknown>[]) : [],
      );
      const roleShape = [...new Set(roles.flatMap((r) => Object.keys(r)))].sort();
      const roleIds = tally(roles.map((r) => r.roleId));
      const roleNames = tally(roles.map((r) => r.name ?? r.roleName ?? r.title));
      const listingScoped = roles.filter(
        (r) => Array.isArray(r.listingIds) || Array.isArray(r.listings) || r.listingsFilter,
      ).length;
      console.log(
        JSON.stringify(
          {
            users: users.length,
            roleShape,
            roleIds,
            roleNames,
            listingScoped,
            rolesPerUser: tally(users.map((u) => (Array.isArray(u.roles) ? u.roles.length : 0))),
            titles: tally(users.map((u) => (typeof u.title === 'string' && u.title ? 'has title' : 'none'))),
            titleWords: tally(
              users.map(
                (u) =>
                  String(u.title ?? '')
                    .toLowerCase()
                    .match(/clean|house|maint|ops|manag|admin/)?.[0] ?? '-',
              ),
            ),
            tags: tally(users.flatMap((u) => (Array.isArray(u.tags) ? u.tags : []))),
            settingsKeys: [
              ...new Set(users.flatMap((u) => Object.keys((u.settings as object) ?? {}))),
            ].sort(),
            isAuthZ: tally(users.map((u) => u.isAuthZ)),
            lastActive: tally(users.map((u) => String(u.lastActivityTime ?? 'never').slice(0, 4))),
          },
          null,
          2,
        ),
      );
      for (const path of [
        '/v1/roles',
        '/v1/accounts/me/roles',
        '/v1/tasks',
        '/v1/tasks-open-api/tasks?columns=_id',
      ]) {
        try {
          const page = await guesty.get<Record<string, unknown>>(
            path.split('?')[0] as string,
            path.includes('?')
              ? { columns: '_id listingId assigneeId type status', limit: 25 }
              : { limit: 25 },
          );
          const items = (page.results ??
            page.data ??
            page.items ??
            (Array.isArray(page) ? page : [])) as Record<string, unknown>[];
          console.log(
            JSON.stringify(
              {
                path,
                topKeys: Object.keys(page).slice(0, 20),
                count: page.count ?? page.total ?? items.length,
                fields: keysOf(items),
                names: path.includes('roles') ? items.map((r) => r.name ?? r.title) : undefined,
                types: path.includes('task') ? tally(items.map((i) => i.type)) : undefined,
              },
              null,
              2,
            ),
          );
        } catch (error) {
          console.log(JSON.stringify({ path, error: String(error).slice(0, 200) }));
        }
      }
      // Listing fields that might hold a cleaner or a default assignee.
      const page = await guesty.get<{ results?: Record<string, unknown>[] }>('/v1/listings', { limit: 5 });
      const keys = [...new Set((page.results ?? []).flatMap((l) => Object.keys(l)))];
      console.log(
        JSON.stringify({
          listingKeysAboutPeople: keys.filter((k) =>
            /clean|assign|staff|user|contact|house|team|owner|manag/i.test(k),
          ),
        }),
      );
      process.exit(0);
    }
    const tries: [string, Record<string, string | number>][] = [
      ['/v1/users', {}],
      ['/v1/contacts', {}],
      ['/v1/tasks-open-api/tasks', { columns: 'type status listingId assigneeId assignee supervisorId' }],
    ];
    for (const [path, query] of tries) {
      try {
        const items: Record<string, unknown>[] = [];
        for await (const item of guesty.pages<Record<string, unknown>>(path, query)) {
          items.push(item);
          if (items.length >= 3000) break;
        }
        const report: Record<string, unknown> = { path, count: items.length, fields: keysOf(items) };
        if (path === '/v1/users' || path === '/v1/contacts') {
          report.withEmail = items.filter((i) => typeof i.email === 'string' && i.email).length;
          report.withPhone = items.filter((i) => i.phone || i.phoneNumber || i.phones).length;
          report.roles = tally(items.map((i) => i.role ?? i.roles ?? i.type ?? i.contactType ?? i.tags));
          report.active = tally(items.map((i) => i.active ?? i.isActive ?? i.status));
          report.listingsField = items.filter(
            (i) => Array.isArray(i.listings) || Array.isArray(i.listingIds),
          ).length;
        } else {
          report.types = tally(items.map((i) => i.type));
          report.statuses = tally(items.map((i) => i.status));
          const pairs = new Map<string, Set<string>>();
          for (const i of items) {
            const who = String(i.assigneeId ?? (i.assignee as { _id?: string } | undefined)?._id ?? '');
            if (!who) continue;
            const set = pairs.get(who) ?? new Set<string>();
            set.add(String(i.listingId ?? ''));
            pairs.set(who, set);
          }
          report.distinctAssignees = pairs.size;
          report.homesPerAssignee = [...pairs.values()].map((s) => s.size).sort((a, b) => b - a);
          report.withoutAssignee = items.filter((i) => !i.assigneeId && !i.assignee).length;
        }
        console.log(JSON.stringify(report, null, 2));
      } catch (error) {
        console.log(JSON.stringify({ path, error: String(error).slice(0, 160) }));
      }
    }
    process.exit(0);
  }
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
