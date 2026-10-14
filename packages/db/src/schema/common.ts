import {
  CHANNEL_ACCOUNT_STATUSES,
  CHANNELS,
  LISTING_STATUSES,
  MANAGED_BY,
  MEMBER_ROLES,
  OUTBOX_KINDS,
  OUTBOX_STATUSES,
  PLATFORM_ROLES,
  PRICE_OWNERS,
  RESERVATION_STATUSES,
  SPACE_TYPES,
} from '@v01/shared';
import { customType, pgSchema, timestamp } from 'drizzle-orm/pg-core';

/**
 * Everything lives in the `app` schema, not `public`. Supabase exposes `public`
 * through its Data API; `app` is reached only through our own API and worker.
 */
export const app = pgSchema('app');

export const memberRole = app.enum('member_role', MEMBER_ROLES);
export const channel = app.enum('channel', CHANNELS);
export const reservationStatus = app.enum('reservation_status', RESERVATION_STATUSES);
export const listingStatus = app.enum('listing_status', LISTING_STATUSES);
export const channelAccountStatus = app.enum('channel_account_status', CHANNEL_ACCOUNT_STATUSES);
export const managedBy = app.enum('managed_by', MANAGED_BY);
export const priceOwner = app.enum('price_owner', PRICE_OWNERS);
export const outboxKind = app.enum('outbox_kind', OUTBOX_KINDS);
export const outboxStatus = app.enum('outbox_status', OUTBOX_STATUSES);
export const platformRole = app.enum('platform_role', PLATFORM_ROLES);
export const spaceType = app.enum('space_type', SPACE_TYPES);

/** Postgres daterange, read back as text such as "[2026-11-13,2026-11-15)". */
export const daterange = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'daterange';
  },
});

export const createdAt = () =>
  timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow();
export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow();
