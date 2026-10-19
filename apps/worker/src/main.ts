import {
  type ChannelProvider,
  ChannexProvider,
  createChannexRateLimiter,
  FakeChannelProvider,
} from '@v01/channels';
import { WorkerDatabase } from '@v01/db';
import { type AlertSink, LogSink, SlackWebhookSink } from '@v01/integrations';
import { pino } from 'pino';
import { processWebhooks, sweepBookingFeed } from './bookings.ts';
import { markDirtyAfterCheckOut } from './cleaning.ts';
import type { WorkerDeps } from './deps.ts';
import { loadEnv } from './env.ts';
import { enqueueFullSync } from './full-sync.ts';
import { startJobs } from './jobs.ts';
import { processOutbox } from './outbox.ts';
import { beginRun, checkAllAutoClose, recover } from './safety.ts';
import { connectProperties } from './setup.ts';

const env = loadEnv();
const log = pino({ level: env.LOG_LEVEL, base: { service: 'v01-worker' } });

const provider: ChannelProvider =
  env.CHANNEL_PROVIDER === 'channex' && env.CHANNEX_API_KEY
    ? new ChannexProvider({ baseUrl: env.CHANNEX_BASE_URL, apiKey: env.CHANNEX_API_KEY })
    : new FakeChannelProvider();
const alerts: AlertSink = env.SLACK_ALERTS_WEBHOOK_URL
  ? new SlackWebhookSink(env.SLACK_ALERTS_WEBHOOK_URL)
  : new LogSink((message) => log.warn(message));

const deps: WorkerDeps = {
  db: new WorkerDatabase(env.DATABASE_URL, { applicationName: 'v01-worker', max: 5 }),
  provider,
  limiter: createChannexRateLimiter(),
  alerts,
  log,
};

/** Runs `task` every `intervalMs`, never overlapping itself, until stopped. */
function every(name: string, intervalMs: number, task: () => Promise<unknown>): () => Promise<void> {
  let stopped = false;
  let running: Promise<unknown> = Promise.resolve();
  let timer: NodeJS.Timeout | undefined;
  const tick = () => {
    running = task()
      .catch((error: unknown) => log.error({ loop: name, error: String(error) }, 'Loop failed'))
      .finally(() => {
        if (!stopped) timer = setTimeout(tick, intervalMs);
      });
  };
  tick();
  return async () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    await running;
  };
}

log.info({ provider: provider.name }, 'Worker starting');

// Drain before push. While `holding` is true nothing goes out to the channel manager: the bookings
// that arrived while V-01 was away are saved first (docs/runbooks/recovery.md, done by the worker).
const run = await beginRun(deps);
let holding = run.recovering;
if (holding) log.warn({ gapSeconds: run.gapSeconds }, 'Back after a gap: draining bookings before sending');

const stops = [
  every('heartbeat', 30_000, () => deps.db.heartbeat(run.runId)),
  every('webhooks', env.WEBHOOK_INTERVAL_MS, () => processWebhooks(deps)),
  every('outbox', env.OUTBOX_INTERVAL_MS, async () => {
    if (holding) return;
    const stats = await processOutbox(deps);
    if (stats.claimed) log.info(stats, 'Outbox processed');
  }),
  every('setup', env.OUTBOX_INTERVAL_MS, async () => {
    if (holding) return;
    const stats = await connectProperties(deps);
    if (stats.claimed) log.info(stats, 'Properties connected');
  }),
];

if (holding) {
  await recover(deps, run);
  holding = false;
}

if (!env.JOBS_DATABASE_URL) log.warn({}, 'JOBS_DATABASE_URL not set: scheduled jobs are off');
const boss = env.JOBS_DATABASE_URL
  ? await startJobs({
      connectionString: env.JOBS_DATABASE_URL,
      log,
      handlers: {
        'booking-feed-sweep': () => sweepBookingFeed(deps),
        'nightly-full-sync': async () => (holding ? { skipped: 'recovering' } : enqueueFullSync(deps)),
        'daily-safety-check': () => checkAllAutoClose(deps),
        // Phase 1: compare every calendar with the channel manager for the next 90 days.
        'nightly-cross-check': async () => ({ skipped: 'cross-check is built in Phase 1' }),
        'cleaning-after-check-out': () => markDirtyAfterCheckOut(deps),
      },
    })
  : null;

let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  log.info({ signal }, 'Worker stopping');
  await Promise.all(stops.map((stop) => stop()));
  await boss?.stop({ graceful: true });
  await deps.db.close();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
