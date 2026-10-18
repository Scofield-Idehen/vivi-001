import { sql } from 'drizzle-orm';
import {
  date,
  foreignKey,
  index,
  integer,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  app,
  channel,
  channelAccountStatus,
  channexSetupStatus,
  createdAt,
  listingStatus,
  updatedAt,
} from './common.ts';
import { appUsers, organisations } from './operators.ts';
import { properties } from './properties.ts';

/** One row per channel account, e.g. "Airbnb A", "Booking.com B", "Vrbo". */
export const channelAccounts = app.table(
  'channel_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'restrict' }),
    channel: channel('channel').notNull(),
    label: text('label').notNull(),
    loginHolder: text('login_holder'),
    twoFactorHolder: text('two_factor_holder'),
    status: channelAccountStatus('status').notNull().default('pending'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('channel_accounts_org_idx').on(t.organisationId),
    unique('channel_accounts_org_label_key').on(t.organisationId, t.label),
    // Lets listings carry the channel with a guarantee that it matches the account.
    unique('channel_accounts_id_channel_key').on(t.id, t.channel),
  ],
);

/**
 * Which listing sits on which account, with history. Listings are archived, never deleted,
 * so a property keeps its full history across every account it has been on.
 */
export const channelListings = app.table(
  'channel_listings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'restrict' }),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'restrict' }),
    channelAccountId: uuid('channel_account_id').notNull(),
    channel: channel('channel').notNull(),
    externalListingId: text('external_listing_id').notNull(),
    status: listingStatus('status').notNull().default('live'),
    liveFrom: date('live_from', { mode: 'string' }),
    closedAt: timestamp('closed_at', { withTimezone: true, mode: 'string' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('channel_listings_org_idx').on(t.organisationId),
    index('channel_listings_property_idx').on(t.propertyId),
    foreignKey({
      name: 'channel_listings_account_channel_fk',
      columns: [t.channelAccountId, t.channel],
      foreignColumns: [channelAccounts.id, channelAccounts.channel],
    }).onDelete('restrict'),
    unique('channel_listings_account_external_key').on(t.channelAccountId, t.externalListingId),
    // One live listing per property per channel. During a move the old one is `closing`.
    uniqueIndex('channel_listings_one_live_per_channel')
      .on(t.propertyId, t.channel)
      .where(sql`${t.status} = 'live'`),
  ],
);

/** Channex IDs live only in mapping tables, never in core tables. That is what makes the swap layer work. */
export const channexMappings = app.table(
  'channex_mappings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'restrict' }),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'restrict' }),
    channexPropertyId: text('channex_property_id').notNull(),
    channexRoomTypeId: text('channex_room_type_id'),
    channexRatePlanId: text('channex_rate_plan_id'),
    createdAt: createdAt(),
  },
  (t) => [
    index('channex_mappings_org_idx').on(t.organisationId),
    unique('channex_mappings_property_key').on(t.propertyId),
    unique('channex_mappings_channex_property_key').on(t.channexPropertyId),
  ],
);

export const channexChannels = app.table(
  'channex_channels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'restrict' }),
    channelAccountId: uuid('channel_account_id')
      .notNull()
      .references(() => channelAccounts.id, { onDelete: 'restrict' }),
    channexChannelId: text('channex_channel_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('channex_channels_org_idx').on(t.organisationId),
    unique('channex_channels_account_key').on(t.channelAccountId),
    unique('channex_channels_channex_key').on(t.channexChannelId),
  ],
);

/**
 * Each operator's properties sit in their own Channex group (playbook, Section 2). Made the first
 * time one of the operator's properties is connected; a Channex ID, so it lives here, not in
 * `organisations`.
 */
export const channexGroups = app.table(
  'channex_groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'restrict' }),
    channexGroupId: text('channex_group_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('channex_groups_org_key').on(t.organisationId),
    unique('channex_groups_channex_key').on(t.channexGroupId),
  ],
);

/**
 * A request to connect a property to Channex (integration step 3). The API writes it; the worker
 * makes the property, unit and rate plan, stores the mapping and marks it done. Retried with a
 * growing wait when Channex is busy; failed, for a person to look at, when it refuses.
 */
export const channexSetups = app.table(
  'channex_setups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'restrict' }),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'restrict' }),
    status: channexSetupStatus('status').notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    lockedAt: timestamp('locked_at', { withTimezone: true, mode: 'string' }),
    lastError: text('last_error'),
    requestedBy: uuid('requested_by').references(() => appUsers.id, { onDelete: 'set null' }),
    finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'string' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('channex_setups_org_idx').on(t.organisationId),
    unique('channex_setups_property_key').on(t.propertyId),
    index('channex_setups_due_idx').on(t.nextAttemptAt).where(sql`${t.status} in ('queued', 'working')`),
  ],
);
