import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  text,
  time,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { reservations } from './bookings.ts';
import { app, createdAt, taskKind, taskStatus, updatedAt } from './common.ts';
import { appUsers, organisations } from './operators.ts';
import { properties } from './properties.ts';

/**
 * Tasks (design roadmap, Phase 2: "Operations in motion"): cleans, maintenance and inspections,
 * assigned to a person on the field team and ticked off on a phone. A clean is made by the worker
 * at every check-out (one per booking, so running again never doubles it); the rest are made by
 * hand. Photos and damage claims come next.
 */

export interface ChecklistItem {
  text: string;
  done: boolean;
}

export const tasks = app.table(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'restrict' }),
    propertyId: uuid('property_id').notNull(),
    /** The booking that made it (a check-out clean), when one did. */
    reservationId: uuid('reservation_id').references(() => reservations.id, { onDelete: 'set null' }),
    kind: taskKind('kind').notNull(),
    /** `check_out`: made by the worker from a booking; `manual`: by the office; `report`: the crew reporting damage. */
    source: text('source').notNull().default('manual'),
    title: text('title').notNull(),
    notes: text('notes'),
    status: taskStatus('status').notNull().default('open'),
    dueOn: date('due_on', { mode: 'string' }).notNull(),
    /** When it must be done by that day, such as the next guest's arrival; null means by the end of the day. */
    dueTime: time('due_time'),
    assigneeUserId: uuid('assignee_user_id').references(() => appUsers.id, { onDelete: 'set null' }),
    checklist: jsonb('checklist').$type<ChecklistItem[]>().notNull().default(sql`'[]'::jsonb`),
    createdBy: uuid('created_by').references(() => appUsers.id, { onDelete: 'set null' }),
    doneBy: uuid('done_by').references(() => appUsers.id, { onDelete: 'set null' }),
    doneAt: timestamp('done_at', { withTimezone: true, mode: 'string' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('tasks_org_due_idx').on(t.organisationId, t.dueOn),
    index('tasks_property_idx').on(t.propertyId, t.status),
    index('tasks_assignee_idx').on(t.assigneeUserId, t.dueOn),
    foreignKey({
      name: 'tasks_property_fk',
      columns: [t.organisationId, t.propertyId],
      foreignColumns: [properties.organisationId, properties.id],
    }).onDelete('restrict'),
    // One clean per booking from the worker; by hand, as many as the team wants.
    uniqueIndex('tasks_check_out_once').on(t.reservationId, t.kind).where(sql`${t.source} = 'check_out'`),
    check('tasks_source', sql`${t.source} in ('check_out', 'manual', 'report')`),
    check('tasks_title_length', sql`char_length(${t.title}) between 1 and 120`),
    check('tasks_notes_length', sql`${t.notes} is null or char_length(${t.notes}) <= 4000`),
  ],
);

/**
 * What a task of each kind starts with: its title and checklist. One per kind per workspace, made
 * with the workspace; an admin edits them on the Tasks page.
 */
export const taskTemplates = app.table(
  'task_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'restrict' }),
    kind: taskKind('kind').notNull(),
    title: text('title').notNull(),
    checklist: jsonb('checklist').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    /** Cleans only: whether the worker makes one at every check-out. */
    automatic: boolean('automatic').notNull().default(true),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('task_templates_org_kind_key').on(t.organisationId, t.kind),
    check('task_templates_title_length', sql`char_length(${t.title}) between 1 and 120`),
  ],
);

/** A photo on a task: the crew's proof of a clean, or what they found. Public bucket, like listing photos. */
export const taskPhotos = app.table(
  'task_photos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'restrict' }),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    storagePath: text('storage_path').notNull(),
    url: text('url').notNull(),
    width: integer('width'),
    height: integer('height'),
    takenBy: uuid('taken_by').references(() => appUsers.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('task_photos_task_idx').on(t.taskId),
    unique('task_photos_storage_path_key').on(t.storagePath),
  ],
);
