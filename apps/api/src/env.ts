import { z } from 'zod';

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().positive().default(3001),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    /** Connects as app_api, through the Supabase pooler. Never the owner. */
    DATABASE_URL: z.string().min(1),
    /** Used to verify sign-in tokens against the project's published keys (JWKS). */
    SUPABASE_URL: z.url().optional(),
    /** Only for projects still on the legacy shared secret, and for tests. */
    SUPABASE_JWT_SECRET: z.string().min(16).optional(),
    /** How long one sign-in lasts before a person signs in again; tokens refresh silently within it. 0 = never. */
    SESSION_MAX_HOURS: z.coerce
      .number()
      .int()
      .min(0)
      .max(24 * 30)
      .default(48),
    /** Comma-separated origins allowed to call the API from a browser. */
    CORS_ORIGINS: z.string().default('http://localhost:5173'),
    /** The signing secret set on the Channex webhook. Webhooks are refused until it is set. */
    CHANNEX_WEBHOOK_SECRET: z.string().min(16).optional(),
    /** Server-side only: lets the API issue photo upload tickets. Photo uploads wait until it is set. */
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional(),
    /** A public Supabase Storage bucket for listing photos, and nothing else. */
    PHOTO_BUCKET: z.string().default('property-photos'),
    /**
     * Encrypts secret custom fields (lock codes, Wi-Fi passwords) in the database. Secrets can't be
     * saved or read until it is set. Changing it makes every stored secret unreadable, so it is
     * kept in the secret manager and never rotated without re-encrypting first.
     */
    FIELD_SECRET_KEY: z.string().min(32).optional(),
  })
  .refine((env) => env.SUPABASE_URL || env.SUPABASE_JWT_SECRET, {
    message: 'Set SUPABASE_URL (recommended) or SUPABASE_JWT_SECRET so sign-in tokens can be verified',
  });

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((i) => `  ${i.path.join('.') || 'env'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid API configuration:\n${problems}`);
  }
  return result.data;
}
