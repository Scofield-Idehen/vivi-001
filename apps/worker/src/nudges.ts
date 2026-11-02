import { type NudgeSlack, sendNudge, type WorkerDatabase } from '@v01/db';
import { NUDGE_OVERDUE_MINUTES, NUDGE_REMINDER_HOUR, type NudgeKind, todayIn } from '@v01/shared';
import { sql } from 'drizzle-orm';

/**
 * The scheduled Slack run (2 Nov 2026), from scripts/nudges.ts every half hour in the day. For each
 * operator:
 *   assigned  jobs given out in the last two days whose message didn't go (the worker's automatic
 *             check-out cleans, or Slack was down): sent now.
 *   reminder  from 8:00 where the operator is, to whoever has today's job not yet started.
 *   overdue   an hour past a job's time (or a day that's gone) and not done: to whoever made the
 *             job, or the admins and operations for automatic ones.
 * Each message goes once per job, person and kind. Returns counts only.
 */

function clockIn(timeZone: string, now: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { hour: n('hour'), minutes: n('hour') * 60 + n('minute') };
}

export async function runNudges(
  db: WorkerDatabase,
  slack: NudgeSlack,
  options: { appUrl: string; now?: Date },
): Promise<Record<string, number>> {
  const now = options.now ?? new Date();
  const appUrl = options.appUrl;
  const counts: Record<string, number> = { sent: 0, not_on_slack: 0, failed: 0, already: 0, gone: 0 };
  for (const org of await db.listOrganisations()) {
    await db.withOrg({ orgId: org.id }, async (tx) => {
      const settings = await tx.execute<{ tz: string }>(
        sql`select time_zone as tz from app.organisation_settings`,
      );
      const tz = settings.rows[0]?.tz ?? 'Europe/London';
      const today = todayIn(tz, now);
      const { hour, minutes } = clockIn(tz, now);
      const jobs: { task: string; user: string; kind: NudgeKind; assignee?: string | null }[] = [];

      const missed = await tx.execute<{ id: string; user_id: string }>(sql`
        select t.id, t.assignee_user_id as user_id from app.tasks t
         where t.assignee_user_id is not null and t.status in ('open', 'in_progress')
           and t.due_on between ${today}::date and ${today}::date + 7
           and t.created_at > now() - interval '2 days'
           and not exists (select 1 from app.task_nudges n where n.task_id = t.id
                            and n.user_id = t.assignee_user_id and n.kind = 'assigned' and n.sent_at is not null)`);
      for (const r of missed.rows) jobs.push({ task: r.id, user: r.user_id, kind: 'assigned' });

      if (hour >= NUDGE_REMINDER_HOUR) {
        const todays = await tx.execute<{ id: string; user_id: string }>(sql`
          select t.id, t.assignee_user_id as user_id from app.tasks t
           where t.assignee_user_id is not null and t.status = 'open' and t.due_on = ${today}::date`);
        for (const r of todays.rows) jobs.push({ task: r.id, user: r.user_id, kind: 'reminder' });
      }

      const late = await tx.execute<{ id: string; created_by: string | null; assignee: string | null }>(sql`
        select t.id, t.created_by, coalesce(u.full_name, u.email) as assignee from app.tasks t
          left join app.app_users u on u.id = t.assignee_user_id
         where t.status in ('open', 'in_progress')
           and (t.due_on between ${today}::date - 2 and ${today}::date - 1
                or (t.due_on = ${today}::date and t.due_time is not null
                    and extract(hour from t.due_time) * 60 + extract(minute from t.due_time) + ${NUDGE_OVERDUE_MINUTES} <= ${minutes}))`);
      if (late.rows.length) {
        const office = await tx.execute<{ user_id: string }>(sql`
          select user_id from app.memberships where role in ('admin', 'operations')`);
        for (const r of late.rows) {
          const to = r.created_by ? [r.created_by] : office.rows.map((o) => o.user_id);
          for (const user of to) jobs.push({ task: r.id, user, kind: 'overdue', assignee: r.assignee });
        }
      }

      for (const j of jobs) {
        try {
          const result = await sendNudge(tx, slack, {
            orgId: org.id,
            taskId: j.task,
            userId: j.user,
            kind: j.kind,
            appUrl,
            assignee: j.assignee ?? null,
          });
          counts[result] = (counts[result] ?? 0) + 1;
        } catch {
          counts.failed = (counts.failed ?? 0) + 1;
        }
      }
    });
  }
  return counts;
}
