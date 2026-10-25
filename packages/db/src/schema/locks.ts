import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { reservations } from './bookings.ts';
import { app, bytea, createdAt, updatedAt } from './common.ts';
import { organisations } from './operators.ts';
import { properties } from './properties.ts';
import { tasks } from './tasks.ts';

/**
 * Smart locks (TTLock first). The lock maker's ids live only here, like Channex's and Guesty's.
 * Tokens and codes are sealed with FIELD_SECRET_KEY before they reach the database: Postgres,
 * its backups and the audit log only ever hold the sealed bytes.
 */

/** One per operator: the lock maker's account that owns its locks, and the sealed sign-in token. */
export const lockAccounts = app.table(
  'lock_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'restrict' }),
    provider: text('provider').notNull().default('ttlock'),
    /** The app sign-in it was connected with, shown so the team knows which account it is. */
    username: text('username').notNull(),
    /** The token as JSON, sealed. Never the password. */
    tokenSealed: bytea('token_sealed').notNull(),
    status: text('status').notNull().default('connected'),
    lastError: text('last_error'),
    /** Gateways as last listed: name and whether online. */
    gateways: jsonb('gateways')
      .$type<{ name: string; online: boolean }[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    syncedAt: timestamp('synced_at', { withTimezone: true, mode: 'string' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('lock_accounts_org_key').on(t.organisationId),
    check('lock_accounts_status_check', sql`${t.status} in ('connected', 'error')`),
  ],
);

export const locks = app.table(
  'locks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'restrict' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => lockAccounts.id, { onDelete: 'cascade' }),
    providerLockId: text('provider_lock_id').notNull(),
    name: text('name').notNull(),
    propertyId: uuid('property_id').references(() => properties.id, { onDelete: 'set null' }),
    battery: integer('battery'),
    hasGateway: boolean('has_gateway').notNull().default(false),
    /** Off until the team turns it on, so V-01 never fights Guesty's Locks Manager over a lock. */
    makesCodes: boolean('makes_codes').notNull().default(false),
    /** When the lock maker last listed it; a lock it stops listing is gone. */
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'string' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('locks_provider_key').on(t.accountId, t.providerLockId),
    index('locks_property_idx').on(t.propertyId),
  ],
);

/**
 * A code on a lock: a guest's for their stay, or the crew's for one job's day. The same digits go
 * on every lock of the home. The worker makes, changes and removes them; this is its record.
 */
export const lockCodes = app.table(
  'lock_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'restrict' }),
    lockId: uuid('lock_id')
      .notNull()
      .references(() => locks.id, { onDelete: 'cascade' }),
    reservationId: uuid('reservation_id').references(() => reservations.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    codeSealed: bytea('code_sealed').notNull(),
    providerCodeId: text('provider_code_id'),
    startsAt: timestamp('starts_at', { withTimezone: true, mode: 'string' }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true, mode: 'string' }).notNull(),
    status: text('status').notNull().default('pending'),
    /** The window the lock holds, so a change of dates is noticed. */
    sentStartsAt: timestamp('sent_starts_at', { withTimezone: true, mode: 'string' }),
    sentEndsAt: timestamp('sent_ends_at', { withTimezone: true, mode: 'string' }),
    error: text('error'),
    attempts: integer('attempts').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('lock_codes_kind_check', sql`${t.kind} in ('guest', 'crew')`),
    check('lock_codes_status_check', sql`${t.status} in ('pending', 'set', 'failed', 'removed')`),
    check(
      'lock_codes_owner_check',
      sql`(${t.kind} = 'guest' and ${t.reservationId} is not null) or (${t.kind} = 'crew' and ${t.taskId} is not null)`,
    ),
    uniqueIndex('lock_codes_stay_key')
      .on(t.lockId, t.reservationId)
      .where(sql`${t.reservationId} is not null`),
    uniqueIndex('lock_codes_job_key').on(t.lockId, t.taskId).where(sql`${t.taskId} is not null`),
    index('lock_codes_org_status_idx').on(t.organisationId, t.status),
  ],
);
