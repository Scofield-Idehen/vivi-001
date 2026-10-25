import { saveLockList, type Tx } from '@v01/db';
import { LockError, type LockProvider, type LockToken, type SecretBox } from '@v01/integrations';
import {
  addDays,
  CHECK_OUT_GRACE_MINUTES,
  CREW_CODE_FROM,
  CREW_CODE_UNTIL,
  GUEST_CODE_DAYS_AHEAD,
  makeDoorCode,
  todayIn,
} from '@v01/shared';
import { sql } from 'drizzle-orm';
import type { WorkerDeps } from './deps.ts';

/**
 * Door codes (TTLock first), the way Guesty's Locks Manager does them:
 * - every confirmed stay at a home whose locks make codes gets one code, the same digits on every
 *   lock of the home, from the check-in time to half an hour after the check-out time, made up
 *   to 14 days ahead so it can go in the arrival messages;
 * - every job on the field team gets a code for its day only, 07:00 to 22:00;
 * - a cancelled or moved stay, or a cancelled job, has its code taken off the lock; changed dates
 *   change the code's window; a code past its end is left to expire on the lock by itself.
 *
 * Commands go one at a time: a lock's gateway takes one at a time. A refused code is tried again,
 * at once for the first few attempts and then hourly. Locks' battery and gateways are listed
 * again hourly. A code is shown to anyone only once the lock has it (status `set`).
 */

export interface LockDeps {
  provider: LockProvider;
  box: SecretBox;
}

export interface DoorCodeStats {
  added: number;
  changed: number;
  removed: number;
  failed: number;
  refreshed: number;
}

/** Commands sent per operator per run, so one run never holds the worker for long. */
const MAX_COMMANDS = 40;
/** A token is renewed this long before it runs out (TTLock's last 90 days). */
const RENEW_WITHIN_MS = 7 * 86_400_000;

type AccountRow = { id: string; token_sealed: Buffer; synced_at: string | null; status: string };
type Wanted = {
  lock_id: string;
  provider_lock_id: string;
  reservation_id: string | null;
  task_id: string | null;
  kind: 'guest' | 'crew';
  starts_at: string;
  ends_at: string;
  label: string;
};
type CodeRow = {
  id: string;
  lock_id: string;
  provider_lock_id: string;
  reservation_id: string | null;
  task_id: string | null;
  code_sealed: Buffer;
  provider_code_id: string | null;
  starts_at: string;
  ends_at: string;
  status: 'pending' | 'set' | 'failed' | 'removed';
  sent_starts_at: string | null;
  sent_ends_at: string | null;
  attempts: number;
  updated_at: string;
};

const ownerKey = (x: { lock_id: string; reservation_id: string | null; task_id: string | null }) =>
  `${x.lock_id}|${x.reservation_id ?? ''}|${x.task_id ?? ''}`;
const sameTime = (a: string | null, b: string | null) =>
  a !== null && b !== null && Date.parse(a) === Date.parse(b);

export async function syncDoorCodes(
  deps: Pick<WorkerDeps, 'db' | 'log' | 'now'>,
  locks: LockDeps,
): Promise<DoorCodeStats> {
  const stats: DoorCodeStats = { added: 0, changed: 0, removed: 0, failed: 0, refreshed: 0 };
  for (const org of await deps.db.listOrganisations()) {
    try {
      await deps.db.withOrg({ orgId: org.id }, (tx) => syncOrg(tx, org.id, deps, locks, stats));
    } catch (error) {
      deps.log.error({ org: org.name, error: String(error) }, 'Door codes failed for an operator');
    }
  }
  return stats;
}

async function syncOrg(
  tx: Tx,
  orgId: string,
  deps: Pick<WorkerDeps, 'log' | 'now'>,
  { provider, box }: LockDeps,
  stats: DoorCodeStats,
): Promise<void> {
  const [account] = (
    await tx.execute<AccountRow>(
      sql`select id, token_sealed, synced_at::text, status from app.lock_accounts limit 1`,
    )
  ).rows;
  if (!account) return;
  const now = deps.now?.() ?? new Date();

  const failAccount = async (message: string) => {
    await tx.execute(
      sql`update app.lock_accounts set status = 'error', last_error = ${message} where id = ${account.id}`,
    );
  };

  const opened = box.open(Buffer.from(account.token_sealed));
  if (!opened) {
    await failAccount('The saved TTLock sign-in can’t be read with this key. Connect the account again.');
    return;
  }
  let token = JSON.parse(opened) as LockToken;
  try {
    if (Date.parse(token.expiresAt) - now.getTime() < RENEW_WITHIN_MS) {
      token = await provider.refresh(token);
      await tx.execute(
        sql`update app.lock_accounts set token_sealed = ${box.seal(JSON.stringify(token))} where id = ${account.id}`,
      );
    }
    // Battery and gateways, hourly.
    if (!account.synced_at || now.getTime() - Date.parse(account.synced_at) > 3_600_000) {
      await refreshLocks(tx, orgId, account.id, provider, token, now);
      stats.refreshed += 1;
    }
  } catch (error) {
    if (error instanceof LockError && error.kind === 'auth') {
      await failAccount(`TTLock refused V-01’s sign-in (${error.message}). Connect the account again.`);
      return;
    }
    deps.log.warn({ error: String(error) }, 'Lock status could not be refreshed');
  }

  const [settings] = (
    await tx.execute<{ time_zone: string }>(sql`select time_zone from app.organisation_settings limit 1`)
  ).rows;
  const zone = settings?.time_zone ?? 'Europe/London';
  const today = todayIn(zone, now);
  const last = addDays(today, GUEST_CODE_DAYS_AHEAD);
  const tomorrow = addDays(today, 1);

  const wanted = (
    await tx.execute<Wanted>(sql`
      select l.id as lock_id, l.provider_lock_id, r.id as reservation_id, null::uuid as task_id,
             'guest' as kind,
             ((r.check_in + coalesce(r.check_in_time, p.check_in_time))::timestamp at time zone ${zone})::text as starts_at,
             ((r.check_out + coalesce(r.check_out_time, p.check_out_time))::timestamp at time zone ${zone}
               + make_interval(mins => ${CHECK_OUT_GRACE_MINUTES}))::text as ends_at,
             'V-01 · ' || coalesce(g.full_name, 'Guest') || ' · ' || to_char(r.check_in, 'DD Mon') as label
        from app.locks l
        join app.properties p on p.id = l.property_id
        join app.reservations r on r.property_id = p.id and r.status = 'confirmed'
        left join app.guests g on g.id = r.guest_id
       where l.makes_codes and l.has_gateway
         and r.check_out >= ${today}::date and r.check_in <= ${last}::date
      union all
      select l.id, l.provider_lock_id, null::uuid, t.id, 'crew',
             ((t.due_on + ${CREW_CODE_FROM}::time)::timestamp at time zone ${zone})::text,
             ((t.due_on + ${CREW_CODE_UNTIL}::time)::timestamp at time zone ${zone})::text,
             'V-01 · ' || t.title || ' · ' || to_char(t.due_on, 'DD Mon')
        from app.locks l
        join app.tasks t on t.property_id = l.property_id
       where l.makes_codes and l.has_gateway
         and t.status <> 'cancelled'
         and t.due_on between ${today}::date and ${tomorrow}::date`)
  ).rows;

  const rows = (
    await tx.execute<CodeRow>(sql`
      select c.id, c.lock_id, l.provider_lock_id, c.reservation_id, c.task_id, c.code_sealed,
             c.provider_code_id, c.starts_at::text, c.ends_at::text, c.status,
             c.sent_starts_at::text, c.sent_ends_at::text, c.attempts, c.updated_at::text
        from app.lock_codes c join app.locks l on l.id = c.lock_id
       where c.status <> 'removed'`)
  ).rows;
  const byOwner = new Map(rows.map((r) => [ownerKey(r), r]));
  const wantedKeys = new Set(wanted.map(ownerKey));

  // One set of digits per stay or job, on every lock of the home.
  const digits = new Map<string, string>();
  const allRows = (
    await tx.execute<{ owner: string; code_sealed: Buffer }>(
      sql`select coalesce(reservation_id, task_id)::text as owner, code_sealed from app.lock_codes`,
    )
  ).rows;
  for (const r of allRows) {
    if (digits.has(r.owner)) continue;
    const code = box.open(Buffer.from(r.code_sealed));
    if (code) digits.set(r.owner, code);
  }

  let commands = 0;
  const due = (row: CodeRow) => row.attempts < 5 || now.getTime() - Date.parse(row.updated_at) > 3_600_000;

  const failed = async (row: { id: string }, error: unknown, fresh: boolean) => {
    stats.failed += 1;
    const message = error instanceof Error ? error.message : String(error);
    // A code the lock already holds is refused again with fresh digits, which nobody has seen yet.
    const clash = fresh && /exist|duplicate|same|repeat/i.test(message);
    await tx.execute(sql`
      update app.lock_codes
         set status = case when status = 'set' then 'set' else 'failed' end,
             error = ${message}, attempts = attempts + 1
             ${clash ? sql`, code_sealed = ${box.seal(makeDoorCode())}` : sql``}
       where id = ${row.id}`);
    if (error instanceof LockError && error.kind === 'auth') throw error;
  };

  try {
    // New codes, and ones not yet on the lock.
    for (const w of wanted) {
      if (commands >= MAX_COMMANDS) break;
      if (Date.parse(w.ends_at) <= now.getTime()) continue;
      let row = byOwner.get(ownerKey(w));
      if (!row) {
        const owner = w.reservation_id ?? w.task_id ?? '';
        const code = digits.get(owner) ?? makeDoorCode();
        digits.set(owner, code);
        const [made] = (
          await tx.execute<CodeRow>(sql`
            insert into app.lock_codes (organisation_id, lock_id, reservation_id, task_id, kind, code_sealed, starts_at, ends_at)
            values (${orgId}, ${w.lock_id}, ${w.reservation_id}, ${w.task_id}, ${w.kind}, ${box.seal(code)}, ${w.starts_at}, ${w.ends_at})
            returning id, lock_id, ${w.provider_lock_id} as provider_lock_id, reservation_id, task_id, code_sealed,
                      provider_code_id, starts_at::text, ends_at::text, status, sent_starts_at::text,
                      sent_ends_at::text, attempts, updated_at::text`)
        ).rows;
        if (!made) continue;
        row = made;
      } else if (!sameTime(row.starts_at, w.starts_at) || !sameTime(row.ends_at, w.ends_at)) {
        await tx.execute(
          sql`update app.lock_codes set starts_at = ${w.starts_at}, ends_at = ${w.ends_at} where id = ${row.id}`,
        );
        row = { ...row, starts_at: w.starts_at, ends_at: w.ends_at };
      }
      const inSync =
        row.status === 'set' &&
        sameTime(row.sent_starts_at, w.starts_at) &&
        sameTime(row.sent_ends_at, w.ends_at);
      if (inSync) continue;
      if (row.attempts > 0 && !due(row)) continue;
      const code = box.open(Buffer.from(row.code_sealed));
      if (!code) continue;
      const window = {
        lockId: w.provider_lock_id,
        name: w.label,
        code,
        startsAt: new Date(w.starts_at),
        endsAt: new Date(w.ends_at),
      };
      commands += 1;
      try {
        if (row.provider_code_id) {
          await provider.changeCode(token, row.provider_code_id, window);
          stats.changed += 1;
        } else {
          const { codeId } = await provider.addCode(token, window);
          await tx.execute(sql`update app.lock_codes set provider_code_id = ${codeId} where id = ${row.id}`);
          stats.added += 1;
        }
        await tx.execute(sql`
          update app.lock_codes
             set status = 'set', error = null, attempts = 0,
                 sent_starts_at = ${w.starts_at}, sent_ends_at = ${w.ends_at}
           where id = ${row.id}`);
      } catch (error) {
        await failed(row, error, !row.provider_code_id);
      }
    }

    // Codes nobody needs any more: off the lock, or left to run out if already past.
    for (const row of rows) {
      if (wantedKeys.has(ownerKey(row))) continue;
      const past = Date.parse(row.ends_at) <= now.getTime();
      if (past || !row.provider_code_id || row.status !== 'set') {
        await tx.execute(sql`update app.lock_codes set status = 'removed' where id = ${row.id}`);
        continue;
      }
      if (commands >= MAX_COMMANDS) break;
      commands += 1;
      try {
        await provider.deleteCode(token, row.provider_lock_id, row.provider_code_id);
        await tx.execute(
          sql`update app.lock_codes set status = 'removed', error = null where id = ${row.id}`,
        );
        stats.removed += 1;
      } catch (error) {
        await failed(row, error, false);
      }
    }
  } catch (error) {
    if (error instanceof LockError && error.kind === 'auth') {
      await failAccount(`TTLock refused V-01’s sign-in (${error.message}). Connect the account again.`);
      return;
    }
    throw error;
  }
}

/** The locks and gateways as the lock maker lists them now: names, battery, gateway. */
export async function refreshLocks(
  tx: Tx,
  orgId: string,
  accountId: string,
  provider: LockProvider,
  token: LockToken,
  now: Date = new Date(),
): Promise<void> {
  const [listed, gateways] = await Promise.all([provider.listLocks(token), provider.listGateways(token)]);
  await saveLockList(tx, { orgId, accountId, locks: listed, gateways, at: now.toISOString() });
}
