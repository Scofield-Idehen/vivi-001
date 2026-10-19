import { sql } from 'drizzle-orm';
import { bigint, date, index, integer, jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { app, createdAt, outboxKind, outboxStatus } from './common.ts';
import { organisations } from './operators.ts';
import { properties } from './properties.ts';

/**
 * Changes waiting to go to the channel manager. A row is written in the same
 * transaction as the change itself, so a saved change is never lost.
 */
export const ariOutbox = app.table(
  'ari_outbox',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'restrict' }),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'restrict' }),
    kind: outboxKind('kind').notNull(),
    dateFrom: date('date_from', { mode: 'string' }).notNull(),
    dateTo: date('date_to', { mode: 'string' }).notNull(),
    status: outboxStatus('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    lockedAt: timestamp('locked_at', { withTimezone: true, mode: 'string' }),
    lastError: text('last_error'),
    providerTaskId: text('provider_task_id'),
    createdAt: createdAt(),
    sentAt: timestamp('sent_at', { withTimezone: true, mode: 'string' }),
  },
  (t) => [
    index('ari_outbox_org_idx').on(t.organisationId),
    index('ari_outbox_due_idx').on(t.nextAttemptAt).where(sql`${t.status} = 'pending'`),
  ],
);

/**
 * Raw webhook deliveries, stored before anything else happens. Not tied to an
 * operator until the worker resolves which one it belongs to, so it is a
 * platform table: the API may only insert, the worker reads and updates.
 */
export const webhookEvents = app.table(
  'webhook_events',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    provider: text('provider').notNull(),
    event: text('event').notNull(),
    externalPropertyId: text('external_property_id'),
    payload: jsonb('payload').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
    organisationId: uuid('organisation_id').references(() => organisations.id, { onDelete: 'set null' }),
    processedAt: timestamp('processed_at', { withTimezone: true, mode: 'string' }),
    lockedAt: timestamp('locked_at', { withTimezone: true, mode: 'string' }),
    attempts: integer('attempts').notNull().default(0),
    error: text('error'),
  },
  (t) => [index('webhook_events_unprocessed_idx').on(t.receivedAt).where(sql`${t.processedAt} is null`)],
);

/** Every outgoing change and incoming booking, traceable by the provider's task id. */
export const syncLog = app.table(
  'sync_log',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'restrict' }),
    propertyId: uuid('property_id').references(() => properties.id, { onDelete: 'set null' }),
    direction: text('direction').notNull(),
    kind: text('kind').notNull(),
    providerTaskId: text('provider_task_id'),
    status: text('status').notNull(),
    detail: jsonb('detail'),
    createdAt: createdAt(),
  },
  (t) => [index('sync_log_org_created_idx').on(t.organisationId, t.createdAt)],
);

/** Who changed what, with before and after. Written only by database triggers. */
export const auditLog = app.table(
  'audit_log',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'restrict' }),
    actorUserId: uuid('actor_user_id'),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    createdAt: createdAt(),
  },
  (t) => [index('audit_log_org_created_idx').on(t.organisationId, t.createdAt)],
);

/**
 * One row per worker start. The heartbeat keeps `last_seen_at` fresh; a start that finds the
 * previous row's heartbeat old knows V-01 was down, and drains the booking feed before any price
 * or availability goes out (the recovery runbook, done by the worker itself). Not tied to an
 * operator: the worker writes it, the console reads it through a function.
 */
export const workerRuns = app.table(
  'worker_runs',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
    /** The previous run's last heartbeat, so the gap can be read back later. */
    previousSeenAt: timestamp('previous_seen_at', { withTimezone: true, mode: 'string' }),
    gapSeconds: integer('gap_seconds'),
    /** 'none' when the gap was short; 'draining' while bookings are being saved; 'done' after. */
    recovery: text('recovery').notNull().default('none'),
    drainedRevisions: integer('drained_revisions').notNull().default(0),
    recoveredAt: timestamp('recovered_at', { withTimezone: true, mode: 'string' }),
  },
  (t) => [index('worker_runs_started_idx').on(t.startedAt)],
);
