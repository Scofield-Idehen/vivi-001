import { ApiDatabase } from '@v01/db';
import { buildApp } from './app.ts';
import { createTokenVerifier } from './auth.ts';
import { loadEnv } from './env.ts';

const env = loadEnv();
const db = new ApiDatabase(env.DATABASE_URL, { applicationName: 'v01-api', max: 10 });
const app = await buildApp({
  env,
  db,
  verifyToken: createTokenVerifier({
    supabaseUrl: env.SUPABASE_URL,
    jwtSecret: env.SUPABASE_JWT_SECRET,
    sessionMaxHours: env.SESSION_MAX_HOURS,
  }),
});

let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  app.log.info({ signal }, 'Shutting down');
  await app.close();
  await db.close();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ host: env.HOST, port: env.PORT });
