import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  check,
  date,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { claims } from './claims.ts';
import { app, bytea, createdAt, updatedAt } from './common.ts';
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
    /** The owner's id in Guesty, when they came from there; a later import updates them. */
    guestyOwnerId: text('guesty_owner_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('owners_org_idx').on(t.organisationId),
    unique('owners_guesty_key').on(t.organisationId, t.guestyOwnerId),
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
    /** The job that made it: a finished clean or repair. FK in SQL. */
    taskId: uuid('task_id'),
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

/**
 * An owner's statement for a month, once finalised: the figures as they were then (`snapshot`),
 * so later changes to bookings or expenses don't move a statement already sent. Paid adds the day
 * and reference. No row means the month is still a draft, worked out live.
 */
export const ownerStatements = app.table(
  'owner_statements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'restrict' }),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => owners.id, { onDelete: 'cascade' }),
    month: text('month').notNull(),
    status: text('status').notNull().default('final'),
    snapshot: jsonb('snapshot').notNull(),
    earnedMinor: bigint('earned_minor', { mode: 'number' }).notNull(),
    feeMinor: bigint('fee_minor', { mode: 'number' }).notNull(),
    expensesMinor: bigint('expenses_minor', { mode: 'number' }).notNull(),
    netMinor: bigint('net_minor', { mode: 'number' }).notNull(),
    finalisedAt: timestamp('finalised_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
    finalisedBy: uuid('finalised_by').references(() => appUsers.id, { onDelete: 'set null' }),
    paidOn: date('paid_on', { mode: 'string' }),
    paidReference: text('paid_reference'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('owner_statements_owner_month_key').on(t.ownerId, t.month),
    index('owner_statements_org_month_idx').on(t.organisationId, t.month),
    check('owner_statements_status', sql`${t.status} in ('final', 'paid')`),
    check('owner_statements_month', sql`${t.month} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    check(
      'owner_statements_reference_length',
      sql`${t.paidReference} is null or char_length(${t.paidReference}) <= 120`,
    ),
  ],
);

/**
 * Owners' contracts (1 Nov 2026): the signed management agreement, kept as uploaded in the private
 * bucket, with when it was signed, starts and ends. Each home's terms point at the contract they
 * come from.
 */
export const ownerContracts = app.table(
  'owner_contracts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'restrict' }),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => owners.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    signedOn: date('signed_on', { mode: 'string' }),
    startsOn: date('starts_on', { mode: 'string' }),
    endsOn: date('ends_on', { mode: 'string' }),
    filePath: text('file_path'),
    fileName: text('file_name'),
    fileType: text('file_type'),
    fileBytes: bigint('file_bytes', { mode: 'number' }),
    /** The owner sees it in their log-in. */
    sharedWithOwner: boolean('shared_with_owner').notNull().default(true),
    createdBy: uuid('created_by').references(() => appUsers.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('owner_contracts_owner_idx').on(t.ownerId),
    check('owner_contracts_title_length', sql`char_length(${t.title}) between 1 and 120`),
    check(
      'owner_contracts_dates',
      sql`${t.endsOn} is null or ${t.startsOn} is null or ${t.endsOn} >= ${t.startsOn}`,
    ),
  ],
);

/**
 * A home's terms from a month on (1 Nov 2026): the deal (a percentage of what the stay brings in,
 * a fixed monthly rent, or no fee for a board member), who arranges maintenance, and the contract
 * they come from. A change starts a new row from its month, so earlier statements keep theirs.
 */
export const homeTerms = app.table(
  'home_terms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'restrict' }),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    /** Always the first of a month. */
    effectiveFrom: date('effective_from', { mode: 'string' }).notNull(),
    deal: text('deal').notNull(),
    feeBasisPoints: integer('fee_basis_points'),
    rentMinor: bigint('rent_minor', { mode: 'number' }),
    maintenanceBy: text('maintenance_by').notNull().default('company'),
    contractId: uuid('contract_id').references(() => ownerContracts.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by').references(() => appUsers.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    unique('home_terms_property_month_key').on(t.propertyId, t.effectiveFrom),
    check('home_terms_deal', sql`${t.deal} in ('percentage', 'fixed_rent', 'no_fee')`),
    check('home_terms_first_of_month', sql`extract(day from ${t.effectiveFrom}) = 1`),
    check(
      'home_terms_values',
      sql`(${t.deal} = 'percentage' and ${t.feeBasisPoints} between 0 and 10000 and ${t.rentMinor} is null)
        or (${t.deal} = 'fixed_rent' and ${t.rentMinor} >= 0 and ${t.feeBasisPoints} is null)
        or (${t.deal} = 'no_fee' and ${t.feeBasisPoints} is null and ${t.rentMinor} is null)`,
    ),
    check('home_terms_maintenance', sql`${t.maintenanceBy} in ('company', 'owner')`),
  ],
);

/**
 * Who is paid for a home, and where (1 Nov 2026). The sort code and account number are sealed by
 * the API before they reach the database and shown only to admins and accounts.
 */
export const homePayees = app.table(
  'home_payees',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'restrict' }),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    payeeName: text('payee_name').notNull(),
    /** Sealed JSON: { sortCode, accountNumber }. */
    bankSealed: bytea('bank_sealed'),
    /** The account number's last four digits, to tell accounts apart without opening them. */
    accountHint: text('account_hint'),
    reference: text('reference'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('home_payees_property_key').on(t.propertyId),
    check('home_payees_name_length', sql`char_length(${t.payeeName}) between 1 and 120`),
    check('home_payees_hint', sql`${t.accountHint} is null or ${t.accountHint} ~ '^[0-9]{2,4}$'`),
  ],
);
