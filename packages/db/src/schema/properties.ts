import { sql } from 'drizzle-orm';
import { char, check, index, integer, text, time, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { app, createdAt, managedBy, priceOwner, updatedAt } from './common.ts';
import { organisations } from './operators.ts';

export const properties = app.table(
  'properties',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    internalCode: text('internal_code'),
    addressLine1: text('address_line1'),
    addressLine2: text('address_line2'),
    city: text('city'),
    postcode: text('postcode'),
    countryCode: char('country_code', { length: 2 }).notNull(),
    area: text('area'),
    propertyType: text('property_type'),
    bedrooms: integer('bedrooms'),
    maxGuests: integer('max_guests').notNull(),
    checkInTime: time('check_in_time').notNull().default('15:00'),
    checkOutTime: time('check_out_time').notNull().default('10:00'),
    slackChannel: text('slack_channel'),
    /** During migration only `v01` properties send anything to Channex. */
    managedBy: managedBy('managed_by').notNull().default('guesty'),
    priceOwner: priceOwner('price_owner').notNull().default('v01'),
    minPriceMinor: integer('min_price_minor'),
    maxPriceMinor: integer('max_price_minor'),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'string' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('properties_org_idx').on(t.organisationId),
    unique('properties_org_code_key').on(t.organisationId, t.internalCode),
    check('properties_max_guests_positive', sql`${t.maxGuests} > 0`),
    check(
      'properties_price_limits',
      sql`${t.minPriceMinor} is null or ${t.maxPriceMinor} is null or ${t.minPriceMinor} <= ${t.maxPriceMinor}`,
    ),
  ],
);
