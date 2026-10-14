import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../src/testing.ts';
import { rawQuery } from './helpers.ts';

/**
 * Guards for future migrations. If someone adds a table or function and forgets
 * the security rules, these fail in CI before it reaches production.
 */

/** Tables that are not tied to one operator, each with a reason. */
const NOT_OPERATOR_TABLES: Record<string, string> = {
  organisations: 'the operators themselves; custom policies',
  app_users: 'people can belong to several operators; custom policies',
  webhook_events: 'raw inbox before the operator is known; API insert-only, worker read',
};

const APP_ROLES = ['app_base', 'app_api', 'app_worker', 'app_jobs'];

let t: TestDatabase;

beforeAll(async () => {
  t = await createTestDatabase();
});

afterAll(async () => {
  await t?.drop();
});

describe('security coverage', () => {
  it('turns on row-level security for every table that holds operator data', async () => {
    const rows = await rawQuery<{ table: string; rls: boolean }>(
      t.ownerUrl,
      `select c.relname as table, c.relrowsecurity as rls
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'app' and c.relkind = 'r'`,
    );
    expect(rows.length).toBeGreaterThan(15);
    const missing = rows.filter((r) => !r.rls && r.table !== 'webhook_events').map((r) => r.table);
    expect(missing).toEqual([]);
  });

  it('gives every operator table a required organisation_id and a policy', async () => {
    const tables = await rawQuery<{ table: string; has_org: boolean; policies: number }>(
      t.ownerUrl,
      `select c.relname as table,
              exists (
                select 1 from pg_attribute a
                 where a.attrelid = c.oid and a.attname = 'organisation_id' and a.attnotnull and not a.attisdropped
              ) as has_org,
              (select count(*)::int from pg_policies p where p.schemaname = 'app' and p.tablename = c.relname) as policies
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'app' and c.relkind = 'r'`,
    );
    const problems = tables
      .filter((r) => !(r.table in NOT_OPERATOR_TABLES))
      .filter((r) => !r.has_org || r.policies === 0)
      .map((r) => r.table);
    expect(problems).toEqual([]);
  });

  it('never lets an application role bypass row-level security or own a table', async () => {
    const roles = await rawQuery<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }>(
      t.ownerUrl,
      'select rolname, rolsuper, rolbypassrls from pg_roles where rolname = any($1)',
      [APP_ROLES],
    );
    expect(roles).toHaveLength(APP_ROLES.length);
    for (const role of roles) {
      expect(role.rolsuper, role.rolname).toBe(false);
      expect(role.rolbypassrls, role.rolname).toBe(false);
    }
    const owned = await rawQuery(
      t.ownerUrl,
      `select tablename from pg_tables where schemaname = 'app' and tableowner = any($1)`,
      [APP_ROLES],
    );
    expect(owned).toEqual([]);
  });

  it('keeps every function in schema app away from PUBLIC', async () => {
    const exposed = await rawQuery<{ name: string }>(
      t.ownerUrl,
      `select p.proname as name
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'app'
          and exists (
            select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
             where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
          )`,
    );
    expect(exposed).toEqual([]);
  });

  it('lets only the worker call the cross-operator functions', async () => {
    const [row] = await rawQuery<{ api: boolean; worker: boolean; jobs_schema: boolean }>(
      t.ownerUrl,
      `select has_function_privilege('app_api', 'app.sys_claim_outbox(integer)', 'EXECUTE') as api,
              has_function_privilege('app_worker', 'app.sys_claim_outbox(integer)', 'EXECUTE') as worker,
              has_schema_privilege('app_jobs', 'app', 'USAGE') as jobs_schema`,
    );
    expect(row).toEqual({ api: false, worker: true, jobs_schema: false });
  });
});
