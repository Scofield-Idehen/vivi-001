import { PgBoss } from 'pg-boss';
import type { Logger } from './deps.ts';

/**
 * Scheduled work, run by pg-boss from its own schema as the app_jobs role.
 * Each handler does its real work through the worker's own database connection,
 * inside each operator's scope.
 */
export const SCHEDULES = {
  /** The safety net behind webhooks. */
  'booking-feed-sweep': { cron: '*/5 * * * *', tz: 'UTC' },
  /** Off-peak for the first operator. Per-operator times can follow once there are several. */
  'nightly-full-sync': { cron: '30 2 * * *', tz: 'Europe/London' },
  'nightly-cross-check': { cron: '30 3 * * *', tz: 'Europe/London' },
} as const;

export type JobName = keyof typeof SCHEDULES;

export async function startJobs(options: {
  connectionString: string;
  handlers: Record<JobName, () => Promise<unknown>>;
  log: Logger;
}): Promise<PgBoss> {
  const boss = new PgBoss({
    connectionString: options.connectionString,
    schema: 'pgboss',
    application_name: 'v01-jobs',
    max: 3,
  });
  boss.on('error', (error) => options.log.error({ error: error.message }, 'Job runner error'));
  await boss.start();

  for (const [name, schedule] of Object.entries(SCHEDULES) as [JobName, (typeof SCHEDULES)[JobName]][]) {
    await boss.createQueue(name);
    await boss.schedule(name, schedule.cron, null, { tz: schedule.tz });
    await boss.work(name, async () => {
      const started = Date.now();
      const result = await options.handlers[name]();
      options.log.info({ job: name, ms: Date.now() - started, result }, 'Job finished');
    });
  }
  return boss;
}
