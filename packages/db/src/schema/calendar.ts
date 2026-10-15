import { sql } from 'drizzle-orm';
import { boolean, check, date, foreignKey, index, integer, unique, uuid } from 'drizzle-orm/pg-core';
import { app, createdAt, updatedAt } from './common.ts';
import { organisations } from './operators.ts';
import { properties } from './properties.ts';

/**
 * A night's price and stay rules where they differ from the property's usual ones. Only the
 * differences are stored: a night with no row uses the property's usual price (its weekend price
 * on Friday and Saturday nights) and usual minimum stay, and a row that goes back to the usual
 * values is removed. Blocked nights are `blocks`, and bookings are `reservations`.
 *
 * Every change queues the property's nights for the channels in the same transaction (migration 0012).
 */
export const calendarDays = app.table(
  'calendar_days',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'restrict' }),
    propertyId: uuid('property_id').notNull(),
    night: date('night', { mode: 'string' }).notNull(),
    /** The night's price in minor units. Null: the property's usual price. */
    priceMinor: integer('price_minor'),
    /** The shortest stay for guests arriving this night. Null: the property's usual minimum. */
    minNights: integer('min_nights'),
    /** Guests can't arrive on this date. */
    closedToArrival: boolean('closed_to_arrival').notNull().default(false),
    /** Guests can't leave on this date. */
    closedToDeparture: boolean('closed_to_departure').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('calendar_days_property_night_key').on(t.propertyId, t.night),
    index('calendar_days_org_night_idx').on(t.organisationId, t.night),
    foreignKey({
      name: 'calendar_days_property_fk',
      columns: [t.organisationId, t.propertyId],
      foreignColumns: [properties.organisationId, properties.id],
    }).onDelete('restrict'),
    check(
      'calendar_days_price_range',
      sql`${t.priceMinor} is null or ${t.priceMinor} between 1 and 100000000`,
    ),
    check('calendar_days_min_nights', sql`${t.minNights} is null or ${t.minNights} between 1 and 365`),
  ],
);
