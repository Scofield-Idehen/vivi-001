import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiDatabase, appUsers, auditLog, memberships, organisations, properties } from '../src/index.ts';
import { createTestDatabase, seedOperator, type TestDatabase } from '../src/testing.ts';
import { expectPgError, insertProperty, PG, rawQuery } from './helpers.ts';

let t: TestDatabase;
let api: ApiDatabase;
let op: { orgId: string; userId: string };
let other: { orgId: string; userId: string };

beforeAll(async () => {
  t = await createTestDatabase();
  op = await seedOperator(t.ownerUrl, {
    name: 'Operator',
    slug: 'operator',
    userEmail: 'admin@example.test',
  });
  other = await seedOperator(t.ownerUrl, { name: 'Other', slug: 'other', userEmail: 'x@example.test' });
  api = new ApiDatabase(t.apiUrl);
});

afterAll(async () => {
  await api?.close();
  await t?.drop();
});

describe('audit log', () => {
  it('records who created and changed a property, with before and after', async () => {
    const scope = { orgId: op.orgId, userId: op.userId };
    const id = await api.withOrg(scope, (tx) => insertProperty(tx, op.orgId, 'Harbour View Lodge'));
    await api.withOrg(scope, (tx) =>
      tx.update(properties).set({ name: 'Harbour View' }).where(eq(properties.id, id)),
    );
    const entries = await api.withOrg(scope, (tx) =>
      tx.select().from(auditLog).where(eq(auditLog.entityId, id)).orderBy(asc(auditLog.id)),
    );
    expect(entries.map((e) => e.action)).toEqual(['insert', 'update']);
    expect(entries.every((e) => e.actorUserId === op.userId)).toBe(true);
    const update = entries[1]!;
    expect((update.before as { name: string }).name).toBe('Harbour View Lodge');
    expect((update.after as { name: string }).name).toBe('Harbour View');
  });

  it('cannot be edited or deleted by the application', async () => {
    await expectPgError(
      api.withOrg({ orgId: op.orgId }, (tx) => tx.update(auditLog).set({ action: 'tampered' })),
      PG.insufficientPrivilege,
    );
    await expectPgError(
      api.withOrg({ orgId: op.orgId }, (tx) => tx.delete(auditLog)),
      PG.insufficientPrivilege,
    );
  });
});

describe('invitations', () => {
  const newUserId = '3f0b6a1e-2c7d-4b8e-9a51-6d2f0c9e7b14';

  async function signInFirstTime(userId: string, email: string): Promise<void> {
    await api.withUser(userId, (tx) =>
      tx.insert(appUsers).values({ id: userId, email }).onConflictDoNothing(),
    );
  }

  it('turns an invitation into a membership on first sign-in, once', async () => {
    await rawQuery(
      t.ownerUrl,
      `insert into app.invitations (organisation_id, email, role) values ($1, 'new.person@example.test', 'operations')`,
      [op.orgId],
    );
    await signInFirstTime(newUserId, 'new.person@example.test');
    expect(await api.acceptInvitations(newUserId, 'New.Person@example.test')).toBe(1);
    expect(await api.acceptInvitations(newUserId, 'new.person@example.test')).toBe(0);

    const mine = await api.withUser(newUserId, (tx) =>
      tx.select().from(memberships).where(eq(memberships.userId, newUserId)),
    );
    expect(mine.map((m) => [m.organisationId, m.role])).toEqual([[op.orgId, 'operations']]);
  });

  it('shows the new person only the operator they were invited to', async () => {
    const visible = await api.withUser(newUserId, (tx) => tx.select().from(organisations));
    expect(visible.map((o) => o.id)).toEqual([op.orgId]);
    expect(visible.map((o) => o.id)).not.toContain(other.orgId);
  });

  it('ignores expired invitations', async () => {
    const lateUserId = '8a1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d';
    await rawQuery(
      t.ownerUrl,
      `insert into app.invitations (organisation_id, email, role, expires_at)
       values ($1, 'late@example.test', 'admin', now() - interval '1 day')`,
      [other.orgId],
    );
    await signInFirstTime(lateUserId, 'late@example.test');
    expect(await api.acceptInvitations(lateUserId, 'late@example.test')).toBe(0);
  });
});
