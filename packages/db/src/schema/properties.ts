import type { Bed } from '@v01/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  text,
  time,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  app,
  bytea,
  cancellationPolicy,
  checkInMethod,
  cleaningStatus,
  createdAt,
  fieldKind,
  managedBy,
  priceOwner,
  roomKind,
  spaceType,
  updatedAt,
} from './common.ts';
import { appUsers, organisations } from './operators.ts';

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
    // The listing: what guests read. Kept within the strictest channel's limits.
    title: text('title'),
    summary: text('summary'),
    theSpace: text('the_space'),
    guestAccess: text('guest_access'),
    neighbourhood: text('neighbourhood'),
    gettingAround: text('getting_around'),
    otherNotes: text('other_notes'),
    checkInMethod: checkInMethod('check_in_method'),
    // House rules.
    petsAllowed: boolean('pets_allowed').notNull().default(false),
    smokingAllowed: boolean('smoking_allowed').notNull().default(false),
    eventsAllowed: boolean('events_allowed').notNull().default(false),
    childrenAllowed: boolean('children_allowed').notNull().default(true),
    quietHoursStart: time('quiet_hours_start'),
    quietHoursEnd: time('quiet_hours_end'),
    houseRules: text('house_rules'),
    // Booking rules, as the channels take them.
    minNights: integer('min_nights').notNull().default(1),
    maxNights: integer('max_nights'),
    instantBook: boolean('instant_book').notNull().default(true),
    advanceNoticeHours: integer('advance_notice_hours').notNull().default(0),
    bookingWindowDays: integer('booking_window_days').default(365),
    preparationDays: integer('preparation_days').notNull().default(0),
    cancellationPolicy: cancellationPolicy('cancellation_policy').notNull().default('moderate'),
    // Prices and fees, in minor units of the operator's currency.
    basePriceMinor: integer('base_price_minor'),
    weekendPriceMinor: integer('weekend_price_minor'),
    cleaningFeeMinor: integer('cleaning_fee_minor'),
    extraGuestFeeMinor: integer('extra_guest_fee_minor'),
    /** Guests from this number on pay the extra guest fee. */
    extraGuestFrom: integer('extra_guest_from'),
    securityDepositMinor: integer('security_deposit_minor'),
    /** A short-term let licence or registration number, where the law asks for one (Scotland does). */
    licenceNumber: text('licence_number'),
    /** The team's own labels, such as an owner or a part of town, for finding and grouping properties. */
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    /** Dirty from a guest's check-out (the worker marks it) until someone marks it clean. */
    cleaningStatus: cleaningStatus('cleaning_status').notNull().default('clean'),
    cleaningChangedAt: timestamp('cleaning_changed_at', { withTimezone: true, mode: 'string' }),
    /** Who marked it; null when the worker did, at a check-out. */
    cleaningChangedBy: uuid('cleaning_changed_by').references(() => appUsers.id, { onDelete: 'set null' }),
    /** Who usually cleans it: the check-out clean is assigned to them. */
    cleanerUserId: uuid('cleaner_user_id').references(() => appUsers.id, { onDelete: 'set null' }),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'string' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('properties_org_idx').on(t.organisationId),
    unique('properties_org_code_key').on(t.organisationId, t.internalCode),
    // Lets a property's own rows (rooms, amenities, photos) prove they share its operator.
    unique('properties_org_id_key').on(t.organisationId, t.id),
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
    check('properties_title_length', sql`char_length(${t.title}) <= 50`),
    check('properties_tags_count', sql`cardinality(${t.tags}) <= 30`),
    check('properties_summary_length', sql`char_length(${t.summary}) <= 500`),
    check(
      'properties_stay_lengths',
      sql`${t.minNights} >= 1 and (${t.maxNights} is null or ${t.maxNights} >= ${t.minNights})`,
    ),
    check('properties_quiet_hours', sql`(${t.quietHoursStart} is null) = (${t.quietHoursEnd} is null)`),
    check(
      'properties_booking_rules',
      sql`${t.advanceNoticeHours} >= 0 and ${t.preparationDays} >= 0 and (${t.bookingWindowDays} is null or ${t.bookingWindowDays} > 0)`,
    ),
    check(
      'properties_fees_positive',
      sql`coalesce(${t.basePriceMinor}, 1) > 0 and coalesce(${t.weekendPriceMinor}, 1) > 0
          and coalesce(${t.cleaningFeeMinor}, 1) > 0 and coalesce(${t.extraGuestFeeMinor}, 1) > 0
          and coalesce(${t.securityDepositMinor}, 1) > 0 and coalesce(${t.extraGuestFrom}, 1) > 0`,
    ),
  ],
);

/** Bedrooms and other spaces, each with its beds, as the channels describe sleeping arrangements. */
export const propertyRooms = app.table(
  'property_rooms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'restrict' }),
    propertyId: uuid('property_id').notNull(),
    position: integer('position').notNull(),
    kind: roomKind('kind').notNull(),
    name: text('name'),
    /** [{ type: 'double', count: 1 }, ...] (BED_TYPES in @v01/shared). */
    beds: jsonb('beds').$type<Bed[]>().notNull().default(sql`'[]'::jsonb`),
    privateBathroom: boolean('private_bathroom').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('property_rooms_property_idx').on(t.propertyId, t.position),
    foreignKey({
      name: 'property_rooms_property_fk',
      columns: [t.organisationId, t.propertyId],
      foreignColumns: [properties.organisationId, properties.id],
    }).onDelete('restrict'),
    check('property_rooms_beds_array', sql`jsonb_typeof(${t.beds}) = 'array'`),
  ],
);

/** Amenity codes (AMENITIES in @v01/shared), stored as text so the list can grow. */
export const propertyAmenities = app.table(
  'property_amenities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'restrict' }),
    propertyId: uuid('property_id').notNull(),
    code: text('code').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('property_amenities_property_code_key').on(t.propertyId, t.code),
    foreignKey({
      name: 'property_amenities_property_fk',
      columns: [t.organisationId, t.propertyId],
      foreignColumns: [properties.organisationId, properties.id],
    }).onDelete('restrict'),
  ],
);

/**
 * Listing photos, in order: position 0 is the cover. The file lives in storage under
 * `{organisation}/{property}/`; listing photos are public, like the listings they appear on.
 */
export const propertyPhotos = app.table(
  'property_photos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'restrict' }),
    propertyId: uuid('property_id').notNull(),
    storagePath: text('storage_path').notNull(),
    url: text('url').notNull(),
    position: integer('position').notNull(),
    caption: text('caption'),
    roomId: uuid('room_id').references(() => propertyRooms.id, { onDelete: 'set null' }),
    width: integer('width'),
    height: integer('height'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('property_photos_property_idx').on(t.propertyId, t.position),
    foreignKey({
      name: 'property_photos_property_fk',
      columns: [t.organisationId, t.propertyId],
      foreignColumns: [properties.organisationId, properties.id],
    }).onDelete('restrict'),
    unique('property_photos_storage_path_key').on(t.storagePath),
    check('property_photos_caption_length', sql`char_length(${t.caption}) <= 200`),
  ],
);

/** The workspace's custom fields: the team's own details kept on every property. */
export const customFields = app.table(
  'custom_fields',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    kind: fieldKind('kind').notNull(),
    position: integer('position').notNull().default(0),
    /**
     * Shown on the guest's page for their stay. A secret marked visible (a lock code, the Wi-Fi
     * password) appears there only from the day of arrival until departure.
     */
    guestVisible: boolean('guest_visible').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('custom_fields_org_idx').on(t.organisationId),
    uniqueIndex('custom_fields_org_name_key').on(t.organisationId, sql`lower(${t.name})`),
    check('custom_fields_name_length', sql`char_length(${t.name}) between 1 and 60`),
  ],
);

/**
 * A field's value on one property. Secrets go in `secret`, encrypted by the API before they are
 * sent, never in `value`; the plain column stays null for them.
 */
export const propertyFieldValues = app.table(
  'property_field_values',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'restrict' }),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    fieldId: uuid('field_id')
      .notNull()
      .references(() => customFields.id, { onDelete: 'cascade' }),
    value: text('value'),
    secret: bytea('secret'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('property_field_values_org_idx').on(t.organisationId),
    index('property_field_values_property_idx').on(t.propertyId),
    unique('property_field_values_property_field_key').on(t.propertyId, t.fieldId),
    check('property_field_values_one_kind', sql`${t.value} is null or ${t.secret} is null`),
    check('property_field_values_value_length', sql`${t.value} is null or char_length(${t.value}) <= 4000`),
  ],
);
