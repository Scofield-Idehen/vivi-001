import { sql } from 'drizzle-orm';
import { bigint, check, date, index, integer, text, unique, uuid } from 'drizzle-orm/pg-core';
import { reservations } from './bookings.ts';
import { app, createdAt, updatedAt } from './common.ts';
import { appUsers, organisations } from './operators.ts';

/**
 * Damage claims (built 30 Oct 2026): one per booking. What was damaged and what it costs, the
 * files the team adds (kept as uploaded, in the private bucket), where it was filed and what came
 * back. The photos from the team's jobs are read from tasks, not copied.
 */
export const claims = app.table(
  'claims',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'restrict' }),
    reservationId: uuid('reservation_id')
      .notNull()
      .references(() => reservations.id, { onDelete: 'restrict' }),
    status: text('status').notNull().default('open'),
    place: text('place').notNull(),
    deadline: date('deadline', { mode: 'string' }).notNull(),
    summary: text('summary'),
    filedOn: date('filed_on', { mode: 'string' }),
    filedReference: text('filed_reference'),
    receivedMinor: bigint('received_minor', { mode: 'number' }),
    outcome: text('outcome'),
    createdBy: uuid('created_by').references(() => appUsers.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('claims_reservation_key').on(t.reservationId),
    index('claims_org_status_idx').on(t.organisationId, t.status, t.deadline),
    check('claims_status', sql`${t.status} in ('open', 'filed', 'paid', 'closed')`),
    check(
      'claims_place',
      sql`${t.place} in ('airbnb', 'booking_com', 'vrbo', 'expedia', 'guest', 'insurer')`,
    ),
    check('claims_summary_length', sql`${t.summary} is null or char_length(${t.summary}) <= 4000`),
    check('claims_outcome_length', sql`${t.outcome} is null or char_length(${t.outcome}) <= 2000`),
    check(
      'claims_reference_length',
      sql`${t.filedReference} is null or char_length(${t.filedReference}) <= 120`,
    ),
    check('claims_received', sql`${t.receivedMinor} is null or ${t.receivedMinor} >= 0`),
  ],
);

/** One line of what was damaged and what it costs to put right. */
export const claimItems = app.table(
  'claim_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'restrict' }),
    claimId: uuid('claim_id')
      .notNull()
      .references(() => claims.id, { onDelete: 'cascade' }),
    description: text('description').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    position: integer('position').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    index('claim_items_claim_idx').on(t.claimId),
    check('claim_items_description_length', sql`char_length(${t.description}) between 1 and 300`),
    check('claim_items_amount', sql`${t.amountMinor} >= 0`),
  ],
);

/** A photo, video, receipt or invoice the team added, kept exactly as uploaded. */
export const claimFiles = app.table(
  'claim_files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'restrict' }),
    claimId: uuid('claim_id')
      .notNull()
      .references(() => claims.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    storagePath: text('storage_path').notNull(),
    fileName: text('file_name').notNull(),
    contentType: text('content_type').notNull(),
    bytes: bigint('bytes', { mode: 'number' }).notNull(),
    uploadedBy: uuid('uploaded_by').references(() => appUsers.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('claim_files_claim_idx').on(t.claimId),
    unique('claim_files_storage_path_key').on(t.storagePath),
    check('claim_files_kind', sql`${t.kind} in ('photo', 'receipt', 'other')`),
    check('claim_files_name_length', sql`char_length(${t.fileName}) between 1 and 200`),
  ],
);
