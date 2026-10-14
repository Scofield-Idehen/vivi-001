import { runMigrations } from '../src/migrate.ts';

const url = process.env.DATABASE_OWNER_URL;
if (!url) {
  console.error('Set DATABASE_OWNER_URL to the owner connection (direct connection, not the pooler).');
  process.exit(1);
}

await runMigrations(url);
console.log('Migrations applied.');
