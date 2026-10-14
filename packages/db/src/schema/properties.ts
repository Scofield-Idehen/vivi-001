import { sql } from 'drizzle-orm';
import {
  char,
  check,
  index,
  integer,
  numeric,
  text,
  time,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { app, createdAt, managedBy, priceOwner, spaceType, updatedAt } from './common.ts';
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
    /** House, flat, cottage and so on (PROPERTY_TYPES in @v01/shared). Text, so the list can grow. */
    propertyType: text('property_type'),
    /** What guests get: the whole place, a private room or a shared room. */
    spaceType: spaceType('space_type').notNull().default('entire_place'),
    bedrooms: integer('bedrooms'),
    beds: integer('beds'),
    /** In halves: 1.5 means one full bathroom and one with a toilet and basin only. */
    bathrooms: numeric('bathrooms', { precision: 3, scale: 1, mode: 'number' }),
    maxGuests: integer('max_guests').notNull(),
    checkInTime: time('check_in_time').notNull().default('15:00'),
    checkOutTime: time('check_out_time').notNull().default('10:00'),
    slackChannel: text('slack_channel'),
    /**
     * Who runs the property's channel listings: Guesty, V-01, or nobody yet (`none`, added in V-01).
     * Only `v01` properties send anything to Channex, and a trigger stops the API and worker from
     * setting `v01` (migration 0007): only the move-over step may.
     */
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
    check('properties_beds_range', sql`${t.beds} is null or ${t.beds} between 0 and 100`),
    check(
      'properties_bathrooms_halves',
      sql`${t.bathrooms} is null or (${t.bathrooms} >= 0 and ${t.bathrooms} * 2 = trunc(${t.bathrooms} * 2))`,
    ),
    check(
      'properties_price_limits',
      sql`${t.minPriceMinor} is null or ${t.maxPriceMinor} is null or ${t.minPriceMinor} <= ${t.maxPriceMinor}`,
    ),
  ],
);
