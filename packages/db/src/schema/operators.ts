import { sql } from 'drizzle-orm';
import { char, check, index, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { app, createdAt, memberRole, updatedAt } from './common.ts';

/** One row per operator (Vivistays is the first). Created by V-01, not by sign-up. */
export const organisations = app.table(
  'organisations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    legalName: text('legal_name'),
    slug: text('slug').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('organisations_slug_key').on(t.slug),
    check('organisations_slug_format', sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
  ],
);

export const organisationSettings = app.table('organisation_settings', {
  organisationId: uuid('organisation_id')
    .primaryKey()
    .references(() => organisations.id, { onDelete: 'cascade' }),
  currency: char('currency', { length: 3 }).notNull().default('GBP'),
  timeZone: text('time_zone').notNull().default('Europe/London'),
  locale: text('locale').notNull().default('en-GB'),
  countryCode: char('country_code', { length: 2 }).notNull().default('GB'),
  vatNumber: text('vat_number'),
  updatedAt: updatedAt(),
});

/** The operator's outside brand: what guests, owners and contractors see. */
export const organisationBrand = app.table(
  'organisation_brand',
  {
    organisationId: uuid('organisation_id')
      .primaryKey()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    displayName: text('display_name').notNull(),
    logoLightUrl: text('logo_light_url'),
    logoDarkUrl: text('logo_dark_url'),
    accentHex: text('accent_hex'),
    senderName: text('sender_name'),
    senderEmail: text('sender_email'),
    emailDomain: text('email_domain'),
    legalFooter: text('legal_footer'),
    updatedAt: updatedAt(),
  },
  (t) => [check('organisation_brand_accent_hex', sql`${t.accentHex} ~ '^#[0-9A-Fa-f]{6}$'`)],
);

/** People who can sign in. The id is the Supabase Auth user id. */
export const appUsers = app.table(
  'app_users',
  {
    id: uuid('id').primaryKey(),
    email: text('email').notNull(),
    fullName: text('full_name'),
    createdAt: createdAt(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'string' }),
  },
  (t) => [unique('app_users_email_key').on(t.email)],
);

export const memberships = app.table(
  'memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => appUsers.id, { onDelete: 'cascade' }),
    role: memberRole('role').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('memberships_org_user_key').on(t.organisationId, t.userId),
    index('memberships_user_idx').on(t.userId),
  ],
);

/** Invitations turn into memberships when the invited email first signs in. */
export const invitations = app.table(
  'invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: memberRole('role').notNull(),
    invitedBy: uuid('invited_by').references(() => appUsers.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' }),
    acceptedAt: timestamp('accepted_at', { withTimezone: true, mode: 'string' }),
    acceptedBy: uuid('accepted_by').references(() => appUsers.id, { onDelete: 'set null' }),
  },
  (t) => [
    index('invitations_org_idx').on(t.organisationId),
    index('invitations_email_idx').on(sql`lower(${t.email})`),
  ],
);
