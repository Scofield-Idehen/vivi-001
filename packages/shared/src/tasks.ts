import { z } from 'zod';
import { MEMBER_ROLES, TASK_KINDS, TASK_STATUSES } from './enums.ts';

/**
 * Tasks: cleans, maintenance and inspections for the field team (design roadmap, Phase 2). The
 * office makes and assigns them; the crew ticks them off on a phone. A check-out clean is made by
 * the worker for every booking.
 */

const Uuid = z.uuid();
const Timestamp = z.string();
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'A date like 2026-11-05');
const Clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'A time like 15:00');

export const ChecklistItemSchema = z.object({ text: z.string(), done: z.boolean() });
export type ChecklistItem = z.infer<typeof ChecklistItemSchema>;

/** `before` and `after` a clean; `found` for what the crew came across (damage, a repair). */
export const PHOTO_STAGES = ['before', 'after', 'found'] as const;
export type PhotoStage = (typeof PHOTO_STAGES)[number];

export const PHOTO_STAGE_LABELS: Record<PhotoStage, string> = {
  before: 'Before',
  after: 'After',
  found: 'Found',
};

export const TaskPhotoSchema = z.object({
  id: Uuid,
  /** Where to see it. Task photos are private: this address works for about an hour. */
  url: z.string(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  takenBy: z.string().nullable(),
  stage: z.enum(PHOTO_STAGES),
  /** The words burned into the picture: when, where, who. */
  stamp: z.string().nullable(),
  at: Timestamp,
});
export type TaskPhoto = z.infer<typeof TaskPhotoSchema>;

/** Registering a task photo once it has uploaded: the listing photo's shape, plus its stage and stamp. */
export const TaskPhotoRegisterSchema = z.object({
  path: z.string().min(1).max(300),
  width: z.number().int().positive().max(20_000),
  height: z.number().int().positive().max(20_000),
  stage: z.enum(PHOTO_STAGES).default('found'),
  stamp: z.string().trim().max(300).optional(),
});
export type TaskPhotoRegister = z.input<typeof TaskPhotoRegisterSchema>;

export const TaskSchema = z.object({
  id: Uuid,
  propertyId: Uuid,
  propertyName: z.string(),
  /** The address on one line, for the stamp on photos. */
  propertyAddress: z.string().nullable(),
  reservationId: Uuid.nullable(),
  kind: z.enum(TASK_KINDS),
  /** `check_out`: the worker, from a booking; `manual`: the office; `report`: the crew reporting damage. */
  source: z.enum(['check_out', 'manual', 'report']),
  title: z.string(),
  notes: z.string().nullable(),
  status: z.enum(TASK_STATUSES),
  dueOn: Day,
  /** "15:00", or null for by the end of the day. */
  dueTime: z.string().nullable(),
  assignee: z.object({ id: Uuid, name: z.string() }).nullable(),
  checklist: z.array(ChecklistItemSchema),
  /** The crew's photos: proof of a clean, or what they found. */
  photos: z.array(TaskPhotoSchema),
  /** For a check-out clean: when the guest leaves and when the next one arrives, if today. */
  guestLeavesAt: z.string().nullable(),
  nextArrivalAt: z.string().nullable(),
  doneBy: z.string().nullable(),
  doneAt: Timestamp.nullable(),
  createdAt: Timestamp,
});
export type Task = z.infer<typeof TaskSchema>;

export const TASK_VIEWS = ['today', 'upcoming', 'open', 'done'] as const;
export type TaskView = (typeof TASK_VIEWS)[number];

export const TaskListQuerySchema = z.object({
  view: z.enum(TASK_VIEWS).default('today'),
  propertyId: Uuid.optional(),
  assigneeId: Uuid.optional(),
  /** Only tasks assigned to me, or to nobody yet. */
  mine: z.enum(['1']).optional(),
});
export type TaskListQuery = z.infer<typeof TaskListQuerySchema>;

export const TaskListSchema = z.object({
  today: Day,
  tasks: z.array(TaskSchema),
  /** How many are open today, upcoming and done, for the tabs. */
  counts: z.object({ today: z.number().int(), upcoming: z.number().int(), open: z.number().int() }),
});
export type TaskList = z.infer<typeof TaskListSchema>;

export const TaskCreateSchema = z.object({
  propertyId: Uuid,
  kind: z.enum(TASK_KINDS),
  title: z.string().trim().min(1).max(120).optional(),
  notes: z.string().trim().max(4000).optional(),
  dueOn: Day,
  dueTime: Clock.optional(),
  assigneeId: Uuid.nullable().optional(),
  /** Left out: the kind's template checklist. */
  checklist: z.array(z.string().trim().min(1).max(200)).max(40).optional(),
});
export type TaskCreate = z.infer<typeof TaskCreateSchema>;

/** The crew reporting damage from a job: a maintenance task on the same property, for the office. */
export const DamageReportSchema = z.object({
  what: z.string().trim().min(1).max(4000),
});
export type DamageReport = z.infer<typeof DamageReportSchema>;

export const TaskUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    notes: z.string().trim().max(4000).nullable().optional(),
    status: z.enum(TASK_STATUSES).optional(),
    dueOn: Day.optional(),
    dueTime: Clock.nullable().optional(),
    assigneeId: Uuid.nullable().optional(),
    checklist: z.array(ChecklistItemSchema).max(40).optional(),
  })
  .refine((u) => Object.keys(u).length > 0, { message: 'Nothing to change.' });
export type TaskUpdate = z.infer<typeof TaskUpdateSchema>;

export const TaskTemplateSchema = z.object({
  kind: z.enum(TASK_KINDS),
  title: z.string(),
  checklist: z.array(z.string()),
  automatic: z.boolean(),
});
export type TaskTemplate = z.infer<typeof TaskTemplateSchema>;

export const TaskTemplateListSchema = z.object({ templates: z.array(TaskTemplateSchema) });

export const TaskTemplateUpdateSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  checklist: z.array(z.string().trim().min(1).max(200)).max(40).optional(),
  automatic: z.boolean().optional(),
});
export type TaskTemplateUpdate = z.infer<typeof TaskTemplateUpdateSchema>;

/** The workspace's people, for assigning. */
export const TeamMemberSchema = z.object({
  id: Uuid,
  name: z.string(),
  email: z.string(),
  role: z.enum(MEMBER_ROLES),
});
export type TeamMember = z.infer<typeof TeamMemberSchema>;
export const TeamListSchema = z.object({ members: z.array(TeamMemberSchema) });
export type TeamList = z.infer<typeof TeamListSchema>;
