import { addDays } from '@v01/shared';
import { sql } from 'drizzle-orm';
import type { WorkerDeps } from './deps.ts';

/**
 * Marks a property dirty once a guest has checked out: at the time agreed for that stay, or the
 * property's usual check-out time, where the operator is. Runs every quarter of an hour.
 *
 * A property someone marked after that check-out (clean, say) keeps what they marked, and a
 * check-out more than a day old is left alone, so the first run never turns every property dirty.
 * The time it went dirty is the check-out itself, which is what the calendar shows.
 */
export async function markDirtyAfterCheckOut(deps: Pick<WorkerDeps, 'db' | 'log' | 'now'>): Promise<number> {
  const now = deps.now?.() ?? new Date();
  const at = now.toISOString();
  // A generous window of check-out dates, whatever the time zone; the times decide exactly.
  const utcToday = at.slice(0, 10);
  const from = addDays(utcToday, -2);
  const to = addDays(utcToday, 1);
  let marked = 0;
  for (const org of await deps.db.listOrganisations()) {
    marked += await deps.db.withOrg({ orgId: org.id }, async (tx) => {
      const rows = await tx.execute(sql`
        with checked_out as (
          select r.property_id, max(left_at) as left_at
            from app.reservations r
            join app.properties p on p.id = r.property_id
            join app.organisation_settings s on s.organisation_id = p.organisation_id
            cross join lateral (
              select ((r.check_out + coalesce(r.check_out_time, p.check_out_time)) at time zone s.time_zone)
                     as left_at
            ) m
           where r.status = 'confirmed'
             and r.check_out between ${from}::date and ${to}::date
             and m.left_at <= ${at}::timestamptz
             and m.left_at > ${at}::timestamptz - interval '1 day'
           group by r.property_id
        )
        update app.properties p
           set cleaning_status = 'dirty', cleaning_changed_at = c.left_at, cleaning_changed_by = null
          from checked_out c
         where p.id = c.property_id
           and p.archived_at is null
           and (p.cleaning_changed_at is null or p.cleaning_changed_at < c.left_at)
        returning p.id`);
      return rows.rows.length;
    });
  }
  if (marked) deps.log.info({ marked }, 'Properties marked dirty after check-out');
  return marked;
}
