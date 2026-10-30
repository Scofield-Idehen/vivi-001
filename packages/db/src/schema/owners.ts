import { sql } from 'drizzle-orm';
import { bigint, char, check, date, index, integer, text, uuid } from 'drizzle-orm/pg-core';
import { claims } from './claims.ts';
import { app, createdAt, updatedAt } from './common.ts';
import { appUsers, organisations } from './operators.ts';
import { properties } from './properties.ts';

/**
 * Owners and expenses (built 30 Oct 2026). A home points at its owner (`properties.owner_id`);
 * an expense is money spent on a home, or on the business when no home is given, charged on to
 * the owner or kept by the company, with its receipt kept as uploaded in the private bucket.
 */
export const owners = app.table(
  'owners',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    company: text('company'),
    email: text('email'),
    phone: text('phone'),
    /** Hundredths of a percent: 1800 is 18%. */
    feeBasisPoints: integer('fee_basis_points').notNull().default(0),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('owners_org_idx').on(t.organisationId),
    check('owners_name_length', sql`char_length(${t.name}) between 1 and 120`),
    check('owners_fee', sql`${t.feeBasisPoints} between 0 and 10000`),
    check('owners_notes_length', sql`${t.notes} is null or char_length(${t.notes}) <= 2000`),
  ],
);

export const expenses = app.table(
  'expenses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'restrict' }),
    propertyId: uuid('property_id').references(() => properties.id, { onDelete: 'restrict' }),
    claimId: uuid('claim_id').references(() => claims.id, { onDelete: 'set null' }),
    spentOn: date('spent_on', { mode: 'string' }).notNull(),
    category: text('category').notNull(),
    description: text('description').notNull(),
    vendor: text('vendor'),
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    chargeTo: text('charge_to').notNull().default('owner'),
    receiptPath: text('receipt_path'),
    receiptName: text('receipt_name'),
    receiptType: text('receipt_type'),
    receiptBytes: bigint('receipt_bytes', { mode: 'number' }),
    createdBy: uuid('created_by').references(() => appUsers.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('expenses_org_spent_idx').on(t.organisationId, t.spentOn),
    index('expenses_property_idx').on(t.propertyId, t.spentOn),
    index('expenses_claim_idx').on(t.claimId),
    check(
      'expenses_category',
      sql`${t.category} in ('cleaning', 'laundry', 'repairs', 'supplies', 'utilities', 'furnishing', 'other')`,
    ),
    check('expenses_charge_to', sql`${t.chargeTo} in ('owner', 'company')`),
    check('expenses_description_length', sql`char_length(${t.description}) between 1 and 300`),
    check('expenses_amount', sql`${t.amountMinor} >= 0`),
  ],
);
