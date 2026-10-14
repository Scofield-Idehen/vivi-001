import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { runMigrations, setRolePasswords } from './migrate.ts';

/**
 * Creates a fresh, fully migrated database for one test file and drops it afterwards.
 * Needs a Postgres server reachable through TEST_DATABASE_URL (a superuser or owner connection).
 */

export const TEST_ROLE_PASSWORD = 'test-only-password';
const SETUP_LOCK = 72_001_001;

function requireRow<T>(rows: T[], what: string): T {
  const row = rows[0];
  if (!row) throw new Error(`Expected a ${what} row`);
  return row;
}

export interface TestDatabase {
  name: string;
  ownerUrl: string;
  apiUrl: string;
  workerUrl: string;
  jobsUrl: string;
  drop(): Promise<void>;
}

export function testAdminUrl(): string {
  return process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
}

function withDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

function withCredentials(url: string, user: string, password: string): string {
  const u = new URL(url);
  u.username = user;
  u.password = password;
  return u.toString();
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const adminUrl = testAdminUrl();
  const name = `v01_test_${randomBytes(5).toString('hex')}`;
  const admin = new pg.Client({ connectionString: adminUrl, application_name: 'v01-test-setup' });
  await admin.connect();
  const ownerUrl = withDatabase(adminUrl, name);
  try {
    // Roles are shared by every database on the server, so test files set them up one at a time.
    await admin.query('select pg_advisory_lock($1)', [SETUP_LOCK]);
    await admin.query(`create database "${name}"`);
    await runMigrations(ownerUrl);
    await setRolePasswords(ownerUrl, {
      app_api: TEST_ROLE_PASSWORD,
      app_worker: TEST_ROLE_PASSWORD,
      app_jobs: TEST_ROLE_PASSWORD,
    });
  } finally {
    await admin.query('select pg_advisory_unlock($1)', [SETUP_LOCK]).catch(() => {});
    await admin.end();
  }
  return {
    name,
    ownerUrl,
    apiUrl: withCredentials(ownerUrl, 'app_api', TEST_ROLE_PASSWORD),
    workerUrl: withCredentials(ownerUrl, 'app_worker', TEST_ROLE_PASSWORD),
    jobsUrl: withCredentials(ownerUrl, 'app_jobs', TEST_ROLE_PASSWORD),
    async drop() {
      const client = new pg.Client({ connectionString: adminUrl });
      await client.connect();
      try {
        await client.query(`drop database if exists "${name}" with (force)`);
      } finally {
        await client.end();
      }
    },
  };
}

/**
 * Adds a V-01 staff member with a sign-in, as the owner, for test setup only. With `linked: false`
 * the staff entry waits for its first sign-in, the way `pnpm db:staff add` leaves it.
 */
export async function seedPlatformStaff(
  ownerUrl: string,
  input: { email: string; role: 'owner' | 'support' | 'viewer'; linked?: boolean },
): Promise<{ userId: string }> {
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    const email = input.email.toLowerCase();
    const user = await client.query<{ id: string }>(
      `insert into app.app_users (id, email) values (gen_random_uuid(), $1)
       on conflict (email) do update set email = excluded.email returning id`,
      [email],
    );
    const userId = requireRow(user.rows, 'user').id;
    await client.query('insert into app.platform_staff (email, user_id, role) values ($1, $2, $3)', [
      email,
      input.linked === false ? null : userId,
      input.role,
    ]);
    return { userId };
  } finally {
    await client.end();
  }
}

/** Inserts an operator, a user and a membership as the owner, for test setup only. */
export async function seedOperator(
  ownerUrl: string,
  input: { name: string; slug: string; userEmail: string; role?: string },
): Promise<{ orgId: string; userId: string }> {
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    const org = await client.query<{ id: string }>(
      'insert into app.organisations (name, slug) values ($1, $2) returning id',
      [input.name, input.slug],
    );
    const orgId = requireRow(org.rows, 'organisation').id;
    await client.query('insert into app.organisation_settings (organisation_id) values ($1)', [orgId]);
    await client.query('insert into app.organisation_brand (organisation_id, display_name) values ($1, $2)', [
      orgId,
      input.name,
    ]);
    const user = await client.query<{ id: string }>(
      `insert into app.app_users (id, email) values (gen_random_uuid(), $1)
       on conflict (email) do update set email = excluded.email returning id`,
      [input.userEmail.toLowerCase()],
    );
    const userId = requireRow(user.rows, 'user').id;
    await client.query('insert into app.memberships (organisation_id, user_id, role) values ($1, $2, $3)', [
      orgId,
      userId,
      input.role ?? 'admin',
    ]);
    return { orgId, userId };
  } finally {
    await client.end();
  }
}
