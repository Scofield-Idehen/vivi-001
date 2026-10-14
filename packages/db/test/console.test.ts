import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiDatabase, supportAccessGrants } from '../src/index.ts';
import { createTestDatabase, seedOperator, seedPlatformStaff, type TestDatabase } from '../src/testing.ts';
import { expectPgError, PG, rawQuery } from './helpers.ts';

/**
 * The V-01 console reads across every operator, so it is the most sensitive path in the system.
 * These tests prove, in the database itself, that only V-01 staff can use it, that it returns
 * totals rather than operators' data, and that support access is time-limited, read-only,
 * visible to the operator and logged.
 */

let t: TestDatabase;
let api: ApiDatabase;
let a: { orgId: string; userId: string };
let b: { orgId: string; userId: string };
let owner: string;
let support: string;
let viewer: string;

/** Runs one SQL statement as a signed-in person, the way the API does. */
async function as<T = Record<string, unknown>>(userId: string, query: ReturnType<typeof sql>): Promise<T[]> {
  return api.withUser(userId, async (tx) => (await tx.execute(query)).rows as T[]);
}

async function startAccess(
  userId: string,
  orgId: string,
  reason = 'Ticket 12: missing booking',
  minutes = 30,
) {
  const [row] = await as<{ id: string }>(
    userId,
    sql`select app.console_start_support_access(${orgId}::uuid, ${reason}, ${minutes}) as id`,
  );
  return row!.id;
}

async function activeGrant(userId: string, orgId: string): Promise<string | null> {
  const [row] = await as<{ id: string | null }>(
    userId,
    sql`select app.active_support_grant(${orgId}::uuid) as id`,
  );
  return row?.id ?? null;
}

beforeAll(async () => {
  t = await createTestDatabase();
  a = await seedOperator(t.ownerUrl, {
    name: 'Operator A',
    slug: 'operator-a',
    userEmail: 'admin-a@example.test',
  });
  b = await seedOperator(t.ownerUrl, {
    name: 'Operator B',
    slug: 'operator-b',
    userEmail: 'admin-b@example.test',
  });
  ({ userId: owner } = await seedPlatformStaff(t.ownerUrl, { email: 'owner@v01.test', role: 'owner' }));
  ({ userId: support } = await seedPlatformStaff(t.ownerUrl, { email: 'support@v01.test', role: 'support' }));
  ({ userId: viewer } = await seedPlatformStaff(t.ownerUrl, { email: 'viewer@v01.test', role: 'viewer' }));
  await rawQuery(
    t.ownerUrl,
    `insert into app.properties (organisation_id, name, country_code, max_guests, managed_by) values
       ($1, 'Harbour View Lodge', 'GB', 6, 'v01'),
       ($1, 'Mill Street Flat', 'GB', 2, 'guesty'),
       ($1, 'Quay Studio', 'GB', 2, 'none'),
       ($2, 'Orchard Cottage', 'GB', 4, 'guesty')`,
    [a.orgId, b.orgId],
  );
  api = new ApiDatabase(t.apiUrl);
});

afterAll(async () => {
  await api?.close();
  await t?.drop();
});

describe('who counts as V-01 staff', () => {
  it('links a staff entry to the sign-in with the same email, on first sign-in', async () => {
    const { userId } = await seedPlatformStaff(t.ownerUrl, {
      email: 'new.starter@v01.test',
      role: 'support',
      linked: false,
    });
    const before = await as<{ role: string | null }>(userId, sql`select app.platform_role() as role`);
    expect(before).toEqual([{ role: null }]);
    const linked = await as<{ role: string }>(
      userId,
      sql`select app.link_platform_staff(${userId}::uuid, ${'New.Starter@V01.test'}) as role`,
    );
    expect(linked).toEqual([{ role: 'support' }]);
  });

  it('never links a staff entry to someone other than the person signing in', async () => {
    await expectPgError(
      as(a.userId, sql`select app.link_platform_staff(${owner}::uuid, ${'owner@v01.test'})`),
      PG.insufficientPrivilege,
    );
  });

  it('gives an operator admin no V-01 role', async () => {
    expect(await as(a.userId, sql`select app.platform_role() as role`)).toEqual([{ role: null }]);
  });
});

describe('console reads', () => {
  it('refuses everyone who is not V-01 staff', async () => {
    for (const query of [
      sql`select * from app.console_overview()`,
      sql`select * from app.console_operators()`,
      sql`select * from app.console_operator(${a.orgId}::uuid)`,
      sql`select * from app.console_sync_health()`,
      sql`select * from app.console_support_log(null, 10)`,
    ]) {
      await expectPgError(as(a.userId, query), PG.insufficientPrivilege);
    }
  });

  it('counts every operator, without returning their properties or guests', async () => {
    const rows = await as<{
      name: string;
      properties: number;
      properties_on_v01: number;
      properties_on_guesty: number;
      members: number;
    }>(
      viewer,
      sql`select name, properties, properties_on_v01, properties_on_guesty, members from app.console_operators()`,
    );
    // Quay Studio was added in V-01 and isn't connected: it is neither run by V-01 nor on Guesty.
    expect(rows).toEqual([
      { name: 'Operator A', properties: 3, properties_on_v01: 1, properties_on_guesty: 1, members: 1 },
      { name: 'Operator B', properties: 1, properties_on_v01: 0, properties_on_guesty: 1, members: 1 },
    ]);
    const [overview] = await as<Record<string, unknown>>(viewer, sql`select * from app.console_overview()`);
    expect(overview).toMatchObject({
      operators: 2,
      operators_live: 1,
      properties: 4,
      properties_on_v01: 1,
      properties_on_guesty: 2,
    });
    const [one] = await as<Record<string, unknown>>(
      owner,
      sql`select * from app.console_operator(${a.orgId}::uuid)`,
    );
    expect(one).toMatchObject({
      name: 'Operator A',
      properties: 3,
      properties_on_v01: 1,
      properties_on_guesty: 1,
    });
  });

  it('logs a look at one operator', async () => {
    const [row] = await as<{ name: string; display_name: string; time_zone: string }>(
      viewer,
      sql`select name, display_name, time_zone from app.console_operator(${b.orgId}::uuid)`,
    );
    expect(row).toEqual({ name: 'Operator B', display_name: 'Operator B', time_zone: 'Europe/London' });
    const logged = await rawQuery(
      t.ownerUrl,
      `select action from app.platform_audit where staff_user_id = $1 and organisation_id = $2`,
      [viewer, b.orgId],
    );
    expect(logged).toEqual([{ action: 'console.operator.view' }]);
  });

  it("shows an operator's team to owners and support, but not to viewers", async () => {
    const team = await as<{ email: string; role: string; status: string }>(
      support,
      sql`select email, role, status from app.console_operator_team(${a.orgId}::uuid)`,
    );
    expect(team).toEqual([{ email: 'admin-a@example.test', role: 'admin', status: 'active' }]);
    await expectPgError(
      as(viewer, sql`select * from app.console_operator_team(${a.orgId}::uuid)`),
      PG.insufficientPrivilege,
    );
  });
});

describe('support access', () => {
  it('cannot be opened by viewers, without a real reason, or for longer than four hours', async () => {
    await expectPgError(startAccess(viewer, a.orgId), PG.insufficientPrivilege);
    await expectPgError(startAccess(support, a.orgId, 'x'), '23514');
    await expectPgError(startAccess(support, a.orgId, 'Checking prices', 600), '22023');
  });

  it("opens one operator's workspace and no other", async () => {
    const grant = await startAccess(support, a.orgId);
    expect(await activeGrant(support, a.orgId)).toBe(grant);
    expect(await activeGrant(support, b.orgId)).toBeNull();
    expect(await activeGrant(owner, a.orgId)).toBeNull();
  });

  it('is visible to the operator it opens, and to no other operator', async () => {
    const seenByA = await api.withOrg({ orgId: a.orgId, userId: a.userId }, (tx) =>
      tx
        .select({ email: supportAccessGrants.staffEmail, reason: supportAccessGrants.reason })
        .from(supportAccessGrants),
    );
    expect(seenByA).toEqual([{ email: 'support@v01.test', reason: 'Ticket 12: missing booking' }]);
    const seenByB = await api.withOrg({ orgId: b.orgId, userId: b.userId }, (tx) =>
      tx.select().from(supportAccessGrants),
    );
    expect(seenByB).toEqual([]);
    const audit = await rawQuery(
      t.ownerUrl,
      `select action from app.audit_log where organisation_id = $1 and entity_type = 'support_access_grants'`,
      [a.orgId],
    );
    expect(audit).toContainEqual({ action: 'insert' });
  });

  it('cannot be written by the API directly', async () => {
    await expectPgError(
      api.withOrg({ orgId: a.orgId, userId: support }, (tx) =>
        tx.insert(supportAccessGrants).values({
          organisationId: a.orgId,
          staffUserId: support,
          staffEmail: 'support@v01.test',
          reason: 'Planted grant',
          expiresAt: sql`now() + interval '1 hour'`,
        }),
      ),
      PG.insufficientPrivilege,
    );
  });

  it('logs every request, only for the staff member who holds the grant', async () => {
    const grant = (await activeGrant(support, a.orgId)) as string;
    await as(support, sql`select app.log_support_request(${grant}::uuid, 'GET', '/v1/properties', true)`);
    await expectPgError(
      as(owner, sql`select app.log_support_request(${grant}::uuid, 'GET', '/v1/properties', true)`),
      PG.insufficientPrivilege,
    );
    const [log] = await as<{ requests: number; active: boolean }>(
      viewer,
      sql`select requests, active from app.console_support_log(${a.orgId}::uuid, 10)`,
    );
    expect(log).toEqual({ requests: 1, active: true });
  });

  it('ends when asked, and then lets nothing through', async () => {
    const grant = (await activeGrant(support, a.orgId)) as string;
    expect(await as(support, sql`select app.console_end_support_access(${grant}::uuid) as ended`)).toEqual([
      { ended: true },
    ]);
    expect(await activeGrant(support, a.orgId)).toBeNull();
    await expectPgError(
      as(support, sql`select app.log_support_request(${grant}::uuid, 'GET', '/v1/properties', true)`),
      PG.insufficientPrivilege,
    );
    expect(await as(support, sql`select app.console_end_support_access(${grant}::uuid) as ended`)).toEqual([
      { ended: false },
    ]);
  });

  it('closes by itself at its end time', async () => {
    const grant = await startAccess(support, b.orgId);
    await rawQuery(
      t.ownerUrl,
      `update app.support_access_grants
          set started_at = now() - interval '2 hours', expires_at = now() - interval '1 hour'
        where id = $1`,
      [grant],
    );
    expect(await activeGrant(support, b.orgId)).toBeNull();
  });

  it('stops at once for someone removed from V-01 staff', async () => {
    await startAccess(support, b.orgId);
    expect(await activeGrant(support, b.orgId)).not.toBeNull();
    await rawQuery(t.ownerUrl, `delete from app.platform_staff where user_id = $1`, [support]);
    expect(await activeGrant(support, b.orgId)).toBeNull();
    await expectPgError(as(support, sql`select * from app.console_overview()`), PG.insufficientPrivilege);
  });
});
