import { setRolePasswords } from '../src/migrate.ts';

/**
 * Turns on login for the application roles. Passwords come from the environment
 * and are never stored in migrations or the repository.
 *
 *   DATABASE_OWNER_URL=... APP_API_DB_PASSWORD=... APP_WORKER_DB_PASSWORD=... APP_JOBS_DB_PASSWORD=... pnpm db:roles
 */
const url = process.env.DATABASE_OWNER_URL;
if (!url) {
  console.error('Set DATABASE_OWNER_URL to the owner connection (direct connection, not the pooler).');
  process.exit(1);
}

const updated = await setRolePasswords(url, {
  app_api: process.env.APP_API_DB_PASSWORD,
  app_worker: process.env.APP_WORKER_DB_PASSWORD,
  app_jobs: process.env.APP_JOBS_DB_PASSWORD,
});

console.log(
  updated.length ? `Login enabled for: ${updated.join(', ')}` : 'No passwords supplied; nothing changed.',
);
