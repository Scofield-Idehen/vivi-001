import { boolean, index, integer, jsonb, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { reservations } from './bookings.ts';
import { channelAccounts } from './channels.ts';
import { app, channel, createdAt } from './common.ts';
import { organisations } from './operators.ts';
import { properties } from './properties.ts';

/**
 * The move from Guesty (playbook, Section 13). Guesty's ids live only here, never in core tables,
 * the way Channex's do: the import can run again and again, updating what it made the first time,
 * and the move-over step reads the account map from here to make the listing links.
 */

/** One Guesty import run, for the record and the report. */
export const guestyImports = app.table(
  'guesty_imports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'restrict' }),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'string' }),
    dryRun: boolean('dry_run').notNull().default(false),
    /** Counts, and anything the team should look at: unmapped amenities, unknown accounts, refusals. */
    summary: jsonb('summary'),
    error: text('error'),
  },
  (t) => [index('guesty_imports_org_idx').on(t.organisationId, t.startedAt)],
);

/** A Guesty listing and the V-01 property made from it. */
export const guestyListings = app.table(
  'guesty_listings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'restrict' }),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'restrict' }),
    guestyListingId: text('guesty_listing_id').notNull(),
    /** Guesty's own words for it, for the report. */
    nickname: text('nickname'),
    active: boolean('active').notNull(),
    /** The listing exactly as Guesty sent it, so nothing is lost if a field wasn't mapped. */
    raw: jsonb('raw').notNull(),
    importedAt: timestamp('imported_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  },
  (t) => [
    index('guesty_listings_org_idx').on(t.organisationId),
    unique('guesty_listings_guesty_key').on(t.guestyListingId),
    unique('guesty_listings_property_key').on(t.propertyId),
  ],
);

/**
 * The account map: each channel account Guesty's listings sit on, as a V-01 channel account. The
 * key is whatever identifies the account in Guesty's listing integrations; confirmed on the first
 * real pull (docs/decisions.md).
 */
export const guestyAccounts = app.table(
  'guesty_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'restrict' }),
    channel: channel('channel').notNull(),
    accountKey: text('account_key').notNull(),
    channelAccountId: uuid('channel_account_id')
      .notNull()
      .references(() => channelAccounts.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('guesty_accounts_org_idx').on(t.organisationId),
    unique('guesty_accounts_key').on(t.organisationId, t.channel, t.accountKey),
  ],
);

/** Where each property is listed, per channel, as Guesty knows it: the listing to link after the move. */
export const guestyChannelListings = app.table(
  'guesty_channel_listings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'restrict' }),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'restrict' }),
    channel: channel('channel').notNull(),
    guestyAccountId: uuid('guesty_account_id')
      .notNull()
      .references(() => guestyAccounts.id, { onDelete: 'restrict' }),
    /** The listing's id on the channel (Airbnb room id, Booking.com hotel id, Vrbo property id). */
    externalListingId: text('external_listing_id').notNull(),
    /** Guesty's integration record, as sent. */
    raw: jsonb('raw').notNull(),
    importedAt: timestamp('imported_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  },
  (t) => [
    index('guesty_channel_listings_org_idx').on(t.organisationId),
    unique('guesty_channel_listings_key').on(t.propertyId, t.channel, t.externalListingId),
  ],
);

/** A Guesty reservation and the V-01 booking made from it. */
export const guestyReservations = app.table(
  'guesty_reservations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'restrict' }),
    reservationId: uuid('reservation_id')
      .notNull()
      .references(() => reservations.id, { onDelete: 'restrict' }),
    guestyReservationId: text('guesty_reservation_id').notNull(),
    importedAt: timestamp('imported_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  },
  (t) => [
    index('guesty_reservations_org_idx').on(t.organisationId),
    unique('guesty_reservations_guesty_key').on(t.guestyReservationId),
    unique('guesty_reservations_reservation_key').on(t.reservationId),
  ],
);

/**
 * Access tokens for outside services, kept so a worker restart never asks for a new one: Guesty
 * allows five tokens a day per client. Worker-only, like `worker_runs`; never shown to anyone.
 */
export const integrationTokens = app.table(
  'integration_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: text('provider').notNull(),
    /** The client id the token was issued to, so a changed key never reuses an old token. */
    clientId: text('client_id').notNull(),
    accessToken: text('access_token').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' }).notNull(),
    /** How many more tokens the service will issue today, when it says. */
    remainingToday: integer('remaining_today'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('integration_tokens_key').on(t.provider, t.clientId),
    index('integration_tokens_expiry_idx').on(t.expiresAt),
  ],
);
