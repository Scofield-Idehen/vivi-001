import { addDays, todayIn } from '@v01/shared';
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

/**
 * A clean for every check-out (design roadmap, Phase 2): for each confirmed booking leaving within
 * the next `daysAhead` days, one cleaning task on the check-out day, due by the next guest's arrival
 * when one arrives that day, assigned to the property's usual cleaner, with the workspace's cleaning
 * checklist. One per booking (a unique index), so running again never doubles it; a booking that is
 * cancelled takes its open clean with it. Off per workspace when the cleaning template says so.
 */
export async function makeCheckOutCleans(
  deps: Pick<WorkerDeps, 'db' | 'log' | 'now'>,
  daysAhead = 7,
): Promise<{ made: number; cancelled: number }> {
  const now = deps.now?.() ?? new Date();
  let made = 0;
  let cancelled = 0;
  for (const org of await deps.db.listOrganisations()) {
    const result = await deps.db.withOrg({ orgId: org.id }, async (tx) => {
      const [template] = await tx
        .execute<{ title: string; checklist: string[]; automatic: boolean; time_zone: string }>(sql`
        select t.title, t.checklist, t.automatic, s.time_zone
          from app.task_templates t
          join app.organisation_settings s on s.organisation_id = t.organisation_id
         where t.kind = 'cleaning'`)
        .then((r) => r.rows);
      if (!template?.automatic) return { made: 0, cancelled: 0 };
      const today = todayIn(template.time_zone, now);
      const until = addDays(today, daysAhead);
      const checklist = JSON.stringify((template.checklist ?? []).map((text) => ({ text, done: false })));
      const inserted = await tx.execute(sql`
        insert into app.tasks (organisation_id, property_id, reservation_id, kind, source, title, notes,
                               due_on, due_time, assignee_user_id, checklist)
        select r.organisation_id, r.property_id, r.id, 'cleaning', 'check_out', ${template.title},
               'Guest leaves at ' || to_char(coalesce(r.check_out_time, p.check_out_time), 'HH24:MI')
                 || coalesce('. Next guest arrives at ' || to_char(n.arrives, 'HH24:MI') || '.', '. Nobody arrives today.'),
               r.check_out, n.arrives, p.cleaner_user_id, ${checklist}::jsonb
          from app.reservations r
          join app.properties p on p.id = r.property_id
          left join lateral (
            select coalesce(x.check_in_time, p.check_in_time) as arrives
              from app.reservations x
             where x.property_id = r.property_id and x.status = 'confirmed' and x.check_in = r.check_out
             order by coalesce(x.check_in_time, p.check_in_time)
             limit 1
          ) n on true
         where r.status = 'confirmed'
           and p.archived_at is null
           and r.check_out between ${today}::date and ${until}::date
           and not exists (
             select 1 from app.tasks t
              where t.reservation_id = r.id and t.kind = 'cleaning' and t.source = 'check_out'
           )
        returning id`);
      // A booking that was cancelled, or moved off its day, takes its open clean with it.
      const gone = await tx.execute(sql`
        update app.tasks t
           set status = 'cancelled'
          from app.reservations r
         where t.reservation_id = r.id and t.source = 'check_out' and t.kind = 'cleaning'
           and t.status in ('open', 'in_progress')
           and (r.status <> 'confirmed' or r.check_out <> t.due_on)
        returning t.id`);
      return { made: inserted.rows.length, cancelled: gone.rows.length };
    });
    made += result.made;
    cancelled += result.cancelled;
  }
  if (made || cancelled) deps.log.info({ made, cancelled }, 'Check-out cleans kept up to date');
  return { made, cancelled };
}
