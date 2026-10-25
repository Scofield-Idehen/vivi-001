import { sql } from 'drizzle-orm';
import type { Tx } from './client.ts';

/**
 * Saves the locks and gateways a lock maker lists, for the API (on connecting and on "Refresh")
 * and the worker (hourly): new locks are added off any property with codes off; known ones get
 * their name, battery and gateway updated; where each lock is placed is never touched here.
 */
export async function saveLockList(
  tx: Tx,
  list: {
    orgId: string;
    accountId: string;
    locks: { lockId: string; name: string; battery: number | null; hasGateway: boolean }[];
    gateways: { name: string; online: boolean }[];
    at: string;
  },
): Promise<void> {
  for (const l of list.locks) {
    await tx.execute(sql`
      insert into app.locks (organisation_id, account_id, provider_lock_id, name, battery, has_gateway, last_seen_at)
      values (${list.orgId}, ${list.accountId}, ${l.lockId}, ${l.name}, ${l.battery}, ${l.hasGateway}, ${list.at})
      on conflict (account_id, provider_lock_id) do update
        set name = excluded.name, battery = coalesce(excluded.battery, app.locks.battery),
            has_gateway = excluded.has_gateway, last_seen_at = excluded.last_seen_at`);
  }
  await tx.execute(sql`
    update app.lock_accounts
       set gateways = ${JSON.stringify(list.gateways.map((g) => ({ name: g.name, online: g.online })))}::jsonb,
           synced_at = ${list.at}, status = 'connected', last_error = null
     where id = ${list.accountId}`);
}
