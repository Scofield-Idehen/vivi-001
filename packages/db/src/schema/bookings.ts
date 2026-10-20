import { sql } from 'drizzle-orm';
import {
  bigint,
  char,
  check,
  date,
  index,
  integer,
  jsonb,
  text,
  time,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { channelAccounts } from './channels.ts';
import { app, channel, createdAt, daterange, reservationStatus, updatedAt } from './common.ts';
import { appUsers, organisations } from './operators.ts';
import { properties } from './properties.ts';

export const guests = app.table(
  'guests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'restrict' }),
    fullName: text('full_name'),
    email: text('email'),
    phone: text('phone'),
    createdAt: createdAt(),
  },
  (t) => [index('guests_org_idx').on(t.organisationId)],
);

export const reservations = app.table(
  'reservations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'restrict' }),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'restrict' }),
    channel: channel('channel').notNull(),
    channelAccountId: uuid('channel_account_id').references(() => channelAccounts.id, {
      onDelete: 'restrict',
    }),
    /** The channel's own confirmation code, e.g. an Airbnb reservation code. */
    channelReference: text('channel_reference'),
    status: reservationStatus('status').notNull(),
    checkIn: date('check_in', { mode: 'string' }).notNull(),
    checkOut: date('check_out', { mode: 'string' }).notNull(),
    guestId: uuid('guest_id').references(() => guests.id, { onDelete: 'set null' }),
    adults: integer('adults').notNull().default(1),
    children: integer('children').notNull().default(0),
    infants: integer('infants').notNull().default(0),
    currency: char('currency', { length: 3 }),
    totalMinor: bigint('total_minor', { mode: 'number' }),
    payoutMinor: bigint('payout_minor', { mode: 'number' }),
    /** The team's own notes on the booking. Channels never see them. */
    notes: text('notes'),
    /** Agreed times for this stay only (an early arrival, a late departure); null keeps the property's. */
    checkInTime: time('check_in_time'),
    checkOutTime: time('check_out_time'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true, mode: 'string' }),
    /** Why, when the team cancelled it here (a direct booking); a channel's cancellation carries none. */
    cancellationReason: text('cancellation_reason'),
    cancelledBy: uuid('cancelled_by').references(() => appUsers.id, { onDelete: 'set null' }),
    /** The private key in the guest's link to their stay page: 128 random bits as hex, made with the row. */
    guestKey: text('guest_key')
      .notNull()
      .default(sql`md5(gen_random_uuid()::text || gen_random_uuid()::text)`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('reservations_org_idx').on(t.organisationId),
    index('reservations_property_dates_idx').on(t.propertyId, t.checkIn),
    // The Reservations list: an operator's bookings by arrival.
    index('reservations_org_check_in_idx').on(t.organisationId, t.checkIn),
    unique('reservations_channel_reference_key').on(t.organisationId, t.channel, t.channelReference),
    unique('reservations_guest_key_key').on(t.guestKey),
    check('reservations_dates_order', sql`${t.checkOut} > ${t.checkIn}`),
    check('reservations_notes_length', sql`char_length(${t.notes}) <= 4000`),
    check(
      'reservations_cancellation_reason_length',
      sql`${t.cancellationReason} is null or char_length(${t.cancellationReason}) <= 400`,
    ),
  ],
);

/** Channex's booking id for a reservation. Kept out of the core table on purpose. */
export const channexBookings = app.table(
  'channex_bookings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'restrict' }),
    reservationId: uuid('reservation_id')
      .notNull()
      .references(() => reservations.id, { onDelete: 'restrict' }),
    channexBookingId: text('channex_booking_id').notNull(),
    lastRevisionId: text('last_revision_id'),
    createdAt: createdAt(),
  },
  (t) => [
    index('channex_bookings_org_idx').on(t.organisationId),
    unique('channex_bookings_reservation_key').on(t.reservationId),
    unique('channex_bookings_channex_key').on(t.channexBookingId),
  ],
);

/** Every booking revision exactly as received, stored before it is processed so it can be replayed. */
export const reservationRevisions = app.table(
  'reservation_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'restrict' }),
    reservationId: uuid('reservation_id').references(() => reservations.id, { onDelete: 'set null' }),
    provider: text('provider').notNull().default('channex'),
    externalRevisionId: text('external_revision_id').notNull(),
    revisionStatus: text('revision_status'),
    payload: jsonb('payload').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true, mode: 'string' }),
    ackedAt: timestamp('acked_at', { withTimezone: true, mode: 'string' }),
    /** Tries to save it as a booking that failed, and why the last one did. Cleared once saved. */
    importAttempts: integer('import_attempts').notNull().default(0),
    importError: text('import_error'),
  },
  (t) => [
    index('reservation_revisions_org_idx').on(t.organisationId),
    unique('reservation_revisions_external_key').on(t.provider, t.externalRevisionId),
  ],
);

export const blocks = app.table(
  'blocks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'restrict' }),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'restrict' }),
    startsOn: date('starts_on', { mode: 'string' }).notNull(),
    /** First night that is free again (exclusive), like a check-out date. */
    endsOn: date('ends_on', { mode: 'string' }).notNull(),
    reason: text('reason'),
    createdBy: uuid('created_by').references(() => appUsers.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('blocks_org_idx').on(t.organisationId),
    index('blocks_property_idx').on(t.propertyId, t.startsOn),
    check('blocks_dates_order', sql`${t.endsOn} > ${t.startsOn}`),
  ],
);

/**
 * Nights held on the calendar, one row per confirmed reservation or block.
 * Written only by database triggers. An exclusion constraint (see the security
 * migration) makes Postgres refuse any two rows for the same property whose nights overlap.
 */
export const occupancies = app.table(
  'occupancies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'restrict' }),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'restrict' }),
    nights: daterange('nights').notNull(),
    sourceType: text('source_type').notNull(),
    sourceId: uuid('source_id').notNull(),
  },
  (t) => [
    index('occupancies_org_idx').on(t.organisationId),
    unique('occupancies_source_key').on(t.sourceType, t.sourceId),
    check('occupancies_source_type', sql`${t.sourceType} in ('reservation', 'block')`),
  ],
);

/**
 * Extra charges on a booking, on top of the channel's total: a late check-out, a pet, damage
 * agreed with the guest; a negative amount is a discount. For the record and the balance; nothing
 * is charged from here yet (payments and Stripe come in Phase 4).
 */
export const reservationCharges = app.table(
  'reservation_charges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'restrict' }),
    reservationId: uuid('reservation_id')
      .notNull()
      .references(() => reservations.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    createdBy: uuid('created_by').references(() => appUsers.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('reservation_charges_reservation_idx').on(t.reservationId),
    check('reservation_charges_label_length', sql`char_length(${t.label}) between 1 and 80`),
    check('reservation_charges_amount', sql`${t.amountMinor} <> 0`),
  ],
);

/**
 * Money received against a booking, as the team records it: a bank transfer, cash at the door,
 * a card payment taken elsewhere, or what the channel collected. A negative amount is a refund.
 * The balance is the total plus charges, less payments.
 */
export const reservationPayments = app.table(
  'reservation_payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'restrict' }),
    reservationId: uuid('reservation_id')
      .notNull()
      .references(() => reservations.id, { onDelete: 'cascade' }),
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    /** channel | card | bank_transfer | cash | other. */
    method: text('method').notNull(),
    paidOn: date('paid_on', { mode: 'string' }).notNull(),
    note: text('note'),
    recordedBy: uuid('recorded_by').references(() => appUsers.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('reservation_payments_reservation_idx').on(t.reservationId),
    check(
      'reservation_payments_method',
      sql`${t.method} in ('channel', 'card', 'bank_transfer', 'cash', 'other')`,
    ),
    check('reservation_payments_amount', sql`${t.amountMinor} <> 0`),
    check('reservation_payments_note_length', sql`${t.note} is null or char_length(${t.note}) <= 400`),
  ],
);
