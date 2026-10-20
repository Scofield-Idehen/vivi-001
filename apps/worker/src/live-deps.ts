import {
  type ChannelProvider,
  ChannexProvider,
  createChannexRateLimiter,
  FakeChannelProvider,
} from '@v01/channels';
import { WorkerDatabase } from '@v01/db';
import { type AlertSink, AppAlerts, LogSink, ResendSender, SlackWebhookSink } from '@v01/integrations';
import { type Logger, pino } from 'pino';
import type { WorkerDeps } from './deps.ts';
import { loadEnv, type WorkerEnv } from './env.ts';
import type { Senders } from './inbox.ts';

/** The worker's real dependencies from its environment, for the worker itself and for hand-run jobs. */
export function liveDeps(
  env: WorkerEnv = loadEnv(),
  options: { applicationName?: string } = {},
): { env: WorkerEnv; deps: WorkerDeps; log: Logger } {
  const log: Logger = pino({
    level: env.LOG_LEVEL,
    base: { service: options.applicationName ?? 'v01-worker' },
  });
  const provider: ChannelProvider =
    env.CHANNEL_PROVIDER === 'channex' && env.CHANNEX_API_KEY
      ? new ChannexProvider({ baseUrl: env.CHANNEX_BASE_URL, apiKey: env.CHANNEX_API_KEY })
      : new FakeChannelProvider();
  const alerts: AlertSink = new AppAlerts(
    env.SLACK_ALERTS_WEBHOOK_URL
      ? new SlackWebhookSink(env.SLACK_ALERTS_WEBHOOK_URL)
      : new LogSink((message) => log.warn(message)),
    {
      appUrl: env.APP_URL,
      onError: (error, alert) =>
        log.error(
          { error: error instanceof Error ? error.message : String(error), alert },
          "Alert couldn't be sent",
        ),
    },
  );
  const deps: WorkerDeps = {
    db: new WorkerDatabase(env.DATABASE_URL, {
      applicationName: options.applicationName ?? 'v01-worker',
      max: 5,
    }),
    provider,
    limiter: createChannexRateLimiter(),
    alerts,
    log,
  };
  return { env, deps, log };
}

/** What the worker sends guest messages with: email through Resend once its key and the address are set. */
export function senders(env: WorkerEnv): Senders {
  if (!env.RESEND_API_KEY || !env.MAIL_FROM) return {};
  return { email: new ResendSender(env.RESEND_API_KEY), from: env.MAIL_FROM };
}
