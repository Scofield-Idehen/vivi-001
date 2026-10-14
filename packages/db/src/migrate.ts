import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));

/** Applies pending migrations. Run as the database owner over the direct connection, never through the pooler. */
export async function runMigrations(ownerUrl: string): Promise<void> {
  const pool = new pg.Pool({ connectionString: ownerUrl, max: 1, application_name: 'v01-migrate' });
  try {
    await migrate(drizzle({ client: pool }), {
      migrationsFolder: MIGRATIONS_DIR,
      migrationsSchema: 'drizzle',
      migrationsTable: '__migrations',
    });
  } finally {
    await pool.end();
  }
}

export const LOGIN_ROLES = ['app_api', 'app_worker', 'app_jobs'] as const;
export type LoginRole = (typeof LOGIN_ROLES)[number];

/**
 * Migrations create the roles without passwords (secrets never go in migrations).
 * This turns on login for each role that has a password supplied.
 */
export async function setRolePasswords(
  ownerUrl: string,
  passwords: Partial<Record<LoginRole, string>>,
): Promise<LoginRole[]> {
  const client = new pg.Client({ connectionString: ownerUrl, application_name: 'v01-roles' });
  await client.connect();
  const updated: LoginRole[] = [];
  try {
    for (const role of LOGIN_ROLES) {
      const password = passwords[role];
      if (!password) continue;
      const { rows } = await client.query<{ stmt: string }>(
        `select format('alter role %I with login password %L', $1::text, $2::text) as stmt`,
        [role, password],
      );
      const statement = rows[0]?.stmt;
      if (!statement) throw new Error(`Could not build the statement for ${role}`);
      await client.query(statement);
      updated.push(role);
    }
  } finally {
    await client.end();
  }
  return updated;
}
