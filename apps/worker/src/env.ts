import { CHANNEX_STAGING_URL } from '@v01/channels';
import { z } from 'zod';

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    /** Connects as app_worker. Use the session pooler or the direct connection, not transaction mode. */
    DATABASE_URL: z.string().min(1),
    /** Connects as app_jobs for pg-boss. Without it, scheduled jobs (feed sweep, nightly sync) do not run. */
    JOBS_DATABASE_URL: z.string().min(1).optional(),
    CHANNEL_PROVIDER: z.enum(['channex', 'fake']).default('fake'),
    CHANNEX_BASE_URL: z.url().default(CHANNEX_STAGING_URL),
    CHANNEX_API_KEY: z.string().min(1).optional(),
    /** Platform alerts. Per-operator Slack channels come with workspace settings. */
    SLACK_ALERTS_WEBHOOK_URL: z.url().optional(),
    /** Changes are batched per property every 30–60 seconds (playbook, Section 4). */
    OUTBOX_INTERVAL_MS: z.coerce.number().int().min(1000).default(30_000),
    WEBHOOK_INTERVAL_MS: z.coerce.number().int().min(500).default(5_000),
  })
  .refine((env) => env.CHANNEL_PROVIDER !== 'channex' || env.CHANNEX_API_KEY, {
    message: 'CHANNEX_API_KEY is required when CHANNEL_PROVIDER=channex',
    path: ['CHANNEX_API_KEY'],
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.CHANNEL_PROVIDER === 'channex', {
    message: 'Production must use CHANNEL_PROVIDER=channex',
    path: ['CHANNEL_PROVIDER'],
  });

export type WorkerEnv = z.infer<typeof EnvSchema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): WorkerEnv {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((i) => `  ${i.path.join('.') || 'env'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid worker configuration:\n${problems}`);
  }
  return result.data;
}
