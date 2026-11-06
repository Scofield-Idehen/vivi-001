import { sql } from 'drizzle-orm';
import { boolean, char, check, index, integer, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { app, createdAt, memberRole, updatedAt } from './common.ts';

/** One row per operator (Vivistays is the first). Created by ViVi OS, not by sign-up. */
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
  /** The booking website (2 Nov 2026): guests book and pay for the homes put on it. */
  bookingSite: boolean('booking_site').notNull().default(false),
  /** A service fee on bookings made there, in hundredths of a percent (150 is 1.5%). Null: none. */
  bookingServiceFeeBp: integer('booking_service_fee_bp'),
  /** The terms guests accept before paying. */
  bookingTerms: text('booking_terms'),
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
    /** The number guests call during a stay, on their stay page. */
    guestPhone: text('guest_phone'),
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
    /**
     * Access by home (1 Nov 2026): when true, the person sees only the homes in `member_homes`.
     * Row-level security enforces it on every table that belongs to a home.
     */
    homesLimited: boolean('homes_limited').notNull().default(false),
    /** For the owner log-in: the owner this person is. They see only that owner's homes. FK in SQL. */
    ownerId: uuid('owner_id'),
    /**
     * What jobs the person does (1 Nov 2026): 'cleaning', 'maintenance'. A clean can be given only
     * to someone with cleaning; a repair only to someone with maintenance.
     */
    skills: text('skills').array().notNull().default(sql`'{}'::text[]`),
    createdAt: createdAt(),
  },
  (t) => [
    check('memberships_skills', sql`${t.skills} <@ array['cleaning', 'maintenance']::text[]`),
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
    /** The name the admin gave when inviting; becomes the person's name on first sign-in if they have none. */
    fullName: text('full_name'),
    invitedBy: uuid('invited_by').references(() => appUsers.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' }),
    acceptedAt: timestamp('accepted_at', { withTimezone: true, mode: 'string' }),
    acceptedBy: uuid('accepted_by').references(() => appUsers.id, { onDelete: 'set null' }),
    /** The homes the person will be limited to; null means every home. */
    propertyIds: uuid('property_ids').array(),
    /** For an owner's log-in: which owner. FK in SQL. */
    ownerId: uuid('owner_id'),
    /** The jobs the person will do; carried onto the membership. */
    skills: text('skills').array().notNull().default(sql`'{}'::text[]`),
  },
  (t) => [
    check('invitations_skills', sql`${t.skills} <@ array['cleaning', 'maintenance']::text[]`),
    index('invitations_org_idx').on(t.organisationId),
    index('invitations_email_idx').on(sql`lower(${t.email})`),
  ],
);
