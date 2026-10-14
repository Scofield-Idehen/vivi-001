import { sql } from 'drizzle-orm';
import { bigint, check, index, jsonb, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { app, createdAt, platformRole } from './common.ts';
import { appUsers, organisations } from './operators.ts';

/**
 * V-01's own staff: the people who can open the console. Added by email with
 * `pnpm db:staff`, and linked to a sign-in the first time that email signs in.
 * No application role can read this table; it is reached only through functions.
 */
export const platformStaff = app.table(
  'platform_staff',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    userId: uuid('user_id').references(() => appUsers.id, { onDelete: 'set null' }),
    role: platformRole('role').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('platform_staff_email_key').on(t.email),
    unique('platform_staff_user_key').on(t.userId),
    check('platform_staff_email_lowercase', sql`${t.email} = lower(${t.email})`),
  ],
);

/**
 * Time-limited, read-only access for one V-01 staff member to one operator's workspace.
 * It always carries a reason, and the operator can read every grant for their own workspace.
 */
export const supportAccessGrants = app.table(
  'support_access_grants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'restrict' }),
    staffUserId: uuid('staff_user_id')
      .notNull()
      .references(() => appUsers.id, { onDelete: 'restrict' }),
    /** Kept on the grant so the operator can see who it was without reading V-01's staff list. */
    staffEmail: text('staff_email').notNull(),
    reason: text('reason').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true, mode: 'string' }),
  },
  (t) => [
    index('support_access_grants_org_idx').on(t.organisationId, t.startedAt),
    index('support_access_grants_staff_idx').on(t.staffUserId, t.expiresAt),
    check('support_access_grants_reason_length', sql`length(btrim(${t.reason})) between 5 and 500`),
    check(
      'support_access_grants_window',
      sql`${t.expiresAt} > ${t.startedAt} and ${t.expiresAt} <= ${t.startedAt} + interval '4 hours'`,
    ),
    check(
      'support_access_grants_ended_after_start',
      sql`${t.endedAt} is null or ${t.endedAt} >= ${t.startedAt}`,
    ),
  ],
);

/**
 * What V-01 staff did: console views of an operator, support grants opened and closed, and every
 * request made under a grant. Written and read only through functions.
 */
export const platformAudit = app.table(
  'platform_audit',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    staffUserId: uuid('staff_user_id').notNull(),
    action: text('action').notNull(),
    organisationId: uuid('organisation_id').references(() => organisations.id, { onDelete: 'set null' }),
    grantId: uuid('grant_id').references(() => supportAccessGrants.id, { onDelete: 'set null' }),
    detail: jsonb('detail'),
    createdAt: createdAt(),
  },
  (t) => [
    index('platform_audit_created_idx').on(t.createdAt),
    index('platform_audit_org_idx').on(t.organisationId, t.createdAt),
    index('platform_audit_grant_idx').on(t.grantId),
  ],
);
