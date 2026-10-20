import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  text,
  time,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { reservations } from './bookings.ts';
import { app, createdAt, updatedAt } from './common.ts';
import { appUsers, organisations } from './operators.ts';
import { properties } from './properties.ts';

/**
 * The Inbox (design roadmap, Phase 2): one thread per booking, whichever site the guest booked on.
 * A thread is made with its booking (a trigger); messages from the guest arrive through Channex
 * for the sites' chats, or by email for direct guests; the team's replies and the automatic
 * messages are queued here and sent by the worker, which keeps the record of what went and what
 * is waiting. Counts and previews on the thread are kept by a trigger on messages.
 */

export const messageThreads = app.table(
  'message_threads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'restrict' }),
    reservationId: uuid('reservation_id')
      .notNull()
      .references(() => reservations.id, { onDelete: 'cascade' }),
    propertyId: uuid('property_id').notNull(),
    /** `done`: handled for now; a new message from the guest opens it again. */
    status: text('status').notNull().default('open'),
    /** The site's own id for the conversation (Channex), once connected. */
    externalThreadId: text('external_thread_id'),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true, mode: 'string' }),
    lastDirection: text('last_direction'),
    lastPreview: text('last_preview'),
    /** Messages from the guest nobody has opened yet. */
    unreadCount: integer('unread_count').notNull().default(0),
    /** When the guest last wrote and nobody has replied since; null once answered. */
    awaitingSince: timestamp('awaiting_since', { withTimezone: true, mode: 'string' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('message_threads_reservation_key').on(t.reservationId),
    index('message_threads_org_last_idx').on(t.organisationId, t.lastMessageAt),
    index('message_threads_org_status_idx').on(t.organisationId, t.status),
    foreignKey({
      name: 'message_threads_property_fk',
      columns: [t.organisationId, t.propertyId],
      foreignColumns: [properties.organisationId, properties.id],
    }).onDelete('restrict'),
    check('message_threads_status', sql`${t.status} in ('open', 'done')`),
    check(
      'message_threads_last_direction',
      sql`${t.lastDirection} is null or ${t.lastDirection} in ('in', 'out')`,
    ),
  ],
);

/**
 * What a message goes out as, or came in by. One per trigger per workspace for the automatic
 * ones (made with the workspace); saved replies (`manual`) as many as the team wants.
 */
export const messageTemplates = app.table(
  'message_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    trigger: text('trigger').notNull(),
    /** For the day triggers: when that day, where the operator is. */
    sendTime: time('send_time'),
    body: text('body').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    position: integer('position').notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('message_templates_org_idx').on(t.organisationId, t.position),
    uniqueIndex('message_templates_trigger_once')
      .on(t.organisationId, t.trigger)
      .where(sql`${t.trigger} <> 'manual'`),
    check(
      'message_templates_trigger',
      sql`${t.trigger} in ('booking_confirmed', 'before_arrival', 'arrival_day', 'before_departure', 'manual')`,
    ),
    check('message_templates_name_length', sql`char_length(${t.name}) between 1 and 80`),
    check('message_templates_body_length', sql`char_length(${t.body}) between 1 and 8000`),
  ],
);

export const messages = app.table(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'restrict' }),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => messageThreads.id, { onDelete: 'cascade' }),
    direction: text('direction').notNull(),
    /** A site's chat (airbnb, booking_com, vrbo, expedia), or email or sms from V-01. */
    via: text('via').notNull(),
    body: text('body').notNull(),
    /** received | queued | sent | waiting | failed. */
    status: text('status').notNull(),
    /** Why it is waiting or failed, in words for the team. */
    note: text('note'),
    sentBy: uuid('sent_by').references(() => appUsers.id, { onDelete: 'set null' }),
    /** Sent by the worker from this template; once per template per thread. */
    templateId: uuid('template_id').references(() => messageTemplates.id, { onDelete: 'set null' }),
    automatic: boolean('automatic').notNull().default(false),
    /** The site's or sender's own id for it, so the same message is never stored twice. */
    externalId: text('external_id'),
    sentAt: timestamp('sent_at', { withTimezone: true, mode: 'string' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('messages_thread_idx').on(t.threadId, t.createdAt),
    index('messages_org_status_idx').on(t.organisationId, t.status),
    unique('messages_external_key').on(t.organisationId, t.via, t.externalId),
    uniqueIndex('messages_template_once').on(t.threadId, t.templateId).where(sql`${t.automatic}`),
    check('messages_direction', sql`${t.direction} in ('in', 'out')`),
    check('messages_via', sql`${t.via} in ('airbnb', 'booking_com', 'vrbo', 'expedia', 'email', 'sms')`),
    check('messages_status', sql`${t.status} in ('received', 'queued', 'sent', 'waiting', 'failed')`),
    check('messages_body_length', sql`char_length(${t.body}) between 1 and 8000`),
  ],
);
