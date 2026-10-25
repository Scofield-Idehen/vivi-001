import { randomUUID } from 'node:crypto';
import {
  appUsers,
  customFields,
  memberships,
  organisationSettings,
  properties,
  propertyFieldValues,
  reservations,
  type Tx,
  taskPhotos,
  tasks,
  taskTemplates,
} from '@v01/db';
import type { SecretBox } from '@v01/integrations';
import {
  addDays,
  can,
  DamageReportSchema,
  PhotoUploadRequestSchema,
  PhotoUploadTicketSchema,
  type Task,
  TaskCreateSchema,
  type TaskList,
  TaskListQuerySchema,
  TaskListSchema,
  TaskPhotoRegisterSchema,
  TaskSchema,
  type TaskTemplate,
  TaskTemplateListSchema,
  TaskTemplateSchema,
  TaskTemplateUpdateSchema,
  TaskUpdateSchema,
  type TeamList,
  TeamListSchema,
  todayIn,
} from '@v01/shared';
import { and, asc, desc, eq, gt, gte, inArray, isNull, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { type RequestScope, toIso } from '../context.ts';
import { HttpError } from '../errors.ts';
import type { PhotoStore } from '../photos.ts';

const TaskParams = z.object({ id: z.uuid() });
const PhotoParams = z.object({ id: z.uuid(), photoId: z.uuid() });

/** Up to this many photos on one task: before and after a clean, and what was found. */
const TASK_PHOTO_MAX = 20;

const EXTENSIONS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

function taskPhotoPath(orgId: string, taskId: string, contentType: string): string {
  return `${orgId}/tasks/${taskId}/${randomUUID()}.${EXTENSIONS[contentType] ?? 'jpg'}`;
}

function taskPhotoPathBelongsTo(path: string, orgId: string, taskId: string): boolean {
  return (
    /^[0-9a-f-]{36}\/tasks\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(path) &&
    path.startsWith(`${orgId}/tasks/${taskId}/`)
  );
}
const KindParams = z.object({ kind: z.enum(['cleaning', 'maintenance', 'inspection']) });

const personName = sql<string>`coalesce(${appUsers.fullName}, ${appUsers.email})`;

/** "15:00" from Postgres's "15:00:00". */
const clock = (time: string | null) => (time ? time.slice(0, 5) : null);

async function todayOf(tx: Tx): Promise<string> {
  const [settings] = await tx.select({ timeZone: organisationSettings.timeZone }).from(organisationSettings);
  return todayIn(settings?.timeZone ?? 'Europe/London');
}

/** One task with its property, assignee, and for a check-out clean, the times around it. */
async function loadTasks(
  tx: Tx,
  where: ReturnType<typeof and>,
  order: 'asc' | 'desc' = 'asc',
  photoStore?: PhotoStore,
): Promise<Task[]> {
  const rows = await tx
    .select({
      task: tasks,
      propertyName: properties.name,
      propertyAddress: sql<
        string | null
      >`nullif(concat_ws(', ', ${properties.addressLine1}, ${properties.city}, ${properties.postcode}), '')`,
      propertyCheckOut: properties.checkOutTime,
      propertyCheckIn: properties.checkInTime,
      assigneeName: personName,
      leaving: reservations.checkOut,
      leavingTime: reservations.checkOutTime,
    })
    .from(tasks)
    .innerJoin(properties, eq(properties.id, tasks.propertyId))
    .leftJoin(appUsers, eq(appUsers.id, tasks.assigneeUserId))
    .leftJoin(reservations, eq(reservations.id, tasks.reservationId))
    .where(where)
    .orderBy(
      order === 'asc' ? asc(tasks.dueOn) : desc(tasks.dueOn),
      sql`${tasks.dueTime} nulls last`,
      asc(properties.name),
    );
  if (rows.length === 0) return [];

  // The next arrival at each property on the task's day, for a clean's deadline line.
  const propertyIds = [...new Set(rows.map((r) => r.task.propertyId))];
  const days = [...new Set(rows.map((r) => r.task.dueOn))];
  const arrivals = await tx
    .select({
      propertyId: reservations.propertyId,
      checkIn: reservations.checkIn,
      time: reservations.checkInTime,
    })
    .from(reservations)
    .where(
      and(
        inArray(reservations.propertyId, propertyIds),
        inArray(reservations.checkIn, days),
        eq(reservations.status, 'confirmed'),
      ),
    );
  const arrivalOn = new Map(arrivals.map((a) => [`${a.propertyId}|${a.checkIn}`, a.time]));

  const photoRows = await tx
    .select({
      id: taskPhotos.id,
      taskId: taskPhotos.taskId,
      url: taskPhotos.url,
      storagePath: taskPhotos.storagePath,
      width: taskPhotos.width,
      height: taskPhotos.height,
      takenBy: taskPhotos.takenBy,
      stage: taskPhotos.stage,
      stamp: taskPhotos.stamp,
      at: taskPhotos.createdAt,
    })
    .from(taskPhotos)
    .where(
      inArray(
        taskPhotos.taskId,
        rows.map((r) => r.task.id),
      ),
    )
    .orderBy(asc(taskPhotos.createdAt));

  const names = new Map<string, string>();
  const people = [
    ...new Set(
      [...rows.map((r) => r.task.doneBy), ...photoRows.map((p) => p.takenBy)].filter((v): v is string =>
        Boolean(v),
      ),
    ),
  ];
  if (people.length) {
    const found = await tx
      .select({ id: appUsers.id, name: personName })
      .from(appUsers)
      .where(inArray(appUsers.id, people));
    for (const p of found) names.set(p.id, p.name);
  }
  const doneNames = names;
  // Task photos are private: each gets an address that works for a while.
  const viewUrls = photoStore ? await photoStore.viewUrls(photoRows.map((p) => p.storagePath)) : null;
  const urlOf = new Map(photoRows.map((p, i) => [p.id, viewUrls?.[i] ?? p.url]));

  return rows.map((r) => {
    const t = r.task;
    const arrivalKey = `${t.propertyId}|${t.dueOn}`;
    const nextArrival = arrivalOn.has(arrivalKey) ? (arrivalOn.get(arrivalKey) ?? r.propertyCheckIn) : null;
    return {
      id: t.id,
      propertyId: t.propertyId,
      propertyName: r.propertyName,
      propertyAddress: r.propertyAddress,
      reservationId: t.reservationId,
      kind: t.kind,
      source: t.source as 'check_out' | 'manual' | 'report',
      title: t.title,
      notes: t.notes,
      status: t.status,
      dueOn: t.dueOn,
      dueTime: clock(t.dueTime),
      assignee: t.assigneeUserId && r.assigneeName ? { id: t.assigneeUserId, name: r.assigneeName } : null,
      checklist: t.checklist,
      photos: photoRows
        .filter((p) => p.taskId === t.id)
        .map((p) => ({
          id: p.id,
          url: urlOf.get(p.id) ?? p.url,
          width: p.width,
          height: p.height,
          takenBy: p.takenBy ? (names.get(p.takenBy) ?? null) : null,
          stage: p.stage as 'before' | 'after' | 'found',
          stamp: p.stamp,
          at: toIso(p.at),
        })),
      guestLeavesAt:
        t.source === 'check_out' && r.leaving === t.dueOn ? clock(r.leavingTime ?? r.propertyCheckOut) : null,
      nextArrivalAt: t.kind === 'cleaning' ? clock(nextArrival) : null,
      doneBy: t.doneBy ? (doneNames.get(t.doneBy) ?? null) : null,
      doneAt: t.doneAt ? toIso(t.doneAt) : null,
      createdAt: toIso(t.createdAt),
      access: [],
    };
  });
}

/**
 * Getting in, for one job: the property's fields marked for the crew, with secrets opened. Only for
 * someone who may work the job (the API has already checked that), only while it is open, and only
 * from its day: a code isn't handed out a week early or after the job is done.
 */
async function accessFor(
  tx: Tx,
  task: Task,
  today: string,
  box: SecretBox | undefined,
): Promise<Task['access']> {
  if (task.status === 'done' || task.status === 'cancelled' || task.dueOn > today) return [];
  const rows = await tx
    .select({
      name: customFields.name,
      kind: customFields.kind,
      value: propertyFieldValues.value,
      secret: propertyFieldValues.secret,
    })
    .from(customFields)
    .leftJoin(
      propertyFieldValues,
      and(
        eq(propertyFieldValues.fieldId, customFields.id),
        eq(propertyFieldValues.propertyId, task.propertyId),
      ),
    )
    .where(eq(customFields.crewVisible, true))
    .orderBy(asc(customFields.position));
  const fields = rows.map((r) => ({
    name: r.name,
    kind: r.kind,
    value: r.secret ? (box ? box.open(Buffer.from(r.secret)) : null) : (r.value ?? null),
  }));
  // The job's own code from the smart lock, for its day only, once the lock holds it.
  const [door] = (
    await tx.execute<{ code_sealed: Buffer; locks: string }>(sql`
      select (array_agg(c.code_sealed))[1] as code_sealed, string_agg(l.name, ', ' order by l.name) as locks
        from app.lock_codes c join app.locks l on l.id = c.lock_id
       where c.task_id = ${task.id} and c.status = 'set' and c.ends_at > now()
       group by c.task_id`)
  ).rows;
  const code = door && box ? box.open(Buffer.from(door.code_sealed)) : null;
  return code
    ? [{ name: `Door code (${door?.locks}), today only`, kind: 'secret', value: code }, ...fields]
    : fields;
}

function toTemplate(row: typeof taskTemplates.$inferSelect): TaskTemplate {
  return { kind: row.kind, title: row.title, checklist: row.checklist, automatic: row.automatic };
}

export function taskRoutes(
  app: FastifyInstance,
  deps: { scope: RequestScope; photos: PhotoStore; bucket?: string; box?: SecretBox },
) {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/v1/tasks',
    { schema: { querystring: TaskListQuerySchema, response: { 200: TaskListSchema } } },
    async (req) =>
      deps.scope.inOrg(req, 'tasks.read', async (tx, ctx): Promise<TaskList> => {
        const today = await todayOf(tx);
        const q = req.query;
        const open = inArray(tasks.status, ['open', 'in_progress']);
        const byView =
          q.view === 'today'
            ? and(open, sql`${tasks.dueOn} <= ${today}`)
            : q.view === 'upcoming'
              ? and(open, gt(tasks.dueOn, today), sql`${tasks.dueOn} <= ${addDays(today, 14)}`)
              : q.view === 'open'
                ? open
                : and(eq(tasks.status, 'done'), gte(tasks.dueOn, addDays(today, -30)));
        // The field team sees their own jobs and the unassigned ones, never a colleague's.
        const crewOnly = ctx.role === 'field' || q.mine === '1';
        const where = and(
          byView,
          q.propertyId ? eq(tasks.propertyId, q.propertyId) : undefined,
          q.assigneeId ? eq(tasks.assigneeUserId, q.assigneeId) : undefined,
          crewOnly ? or(eq(tasks.assigneeUserId, ctx.userId), isNull(tasks.assigneeUserId)) : undefined,
        );
        const list = await loadTasks(tx, where, q.view === 'done' ? 'desc' : 'asc', deps.photos);
        const [counts] = await tx
          .select({
            today: sql<number>`(count(*) filter (where ${tasks.dueOn} <= ${today}))::int`,
            upcoming: sql<number>`(count(*) filter (where ${tasks.dueOn} > ${today} and ${tasks.dueOn} <= ${addDays(today, 14)}))::int`,
            open: sql<number>`count(*)::int`,
          })
          .from(tasks)
          .where(
            and(
              open,
              crewOnly ? or(eq(tasks.assigneeUserId, ctx.userId), isNull(tasks.assigneeUserId)) : undefined,
            ),
          );
        return {
          today,
          tasks: list,
          counts: { today: counts?.today ?? 0, upcoming: counts?.upcoming ?? 0, open: counts?.open ?? 0 },
        };
      }),
  );

  typed.get('/v1/tasks/:id', { schema: { params: TaskParams, response: { 200: TaskSchema } } }, async (req) =>
    deps.scope.inOrg(req, 'tasks.read', async (tx, ctx) => {
      const [task] = await loadTasks(tx, eq(tasks.id, req.params.id), 'asc', deps.photos);
      if (!task) throw new HttpError(404, 'task_not_found', 'That task does not exist in this workspace.');
      if (ctx.role === 'field' && task.assignee && task.assignee.id !== ctx.userId) {
        throw new HttpError(404, 'task_not_found', 'That task does not exist in this workspace.');
      }
      // The crew working it, and the office roles that may see codes anyway; never accounts or support.
      if (ctx.role === 'field' || can(ctx.role, 'secrets.read')) {
        task.access = await accessFor(tx, task, await todayOf(tx), deps.box);
      }
      return task;
    }),
  );

  typed.post(
    '/v1/tasks',
    { schema: { body: TaskCreateSchema, response: { 201: TaskSchema } } },
    async (req, reply) =>
      deps.scope.inOrg(req, 'tasks.manage', async (tx, ctx) => {
        const [property] = await tx
          .select({
            id: properties.id,
            cleaner: properties.cleanerUserId,
            maintainer: properties.maintainerUserId,
          })
          .from(properties)
          .where(and(eq(properties.id, req.body.propertyId), isNull(properties.archivedAt)));
        if (!property) throw new HttpError(404, 'property_not_found', 'That property does not exist here.');
        if (req.body.assigneeId) await assertMember(tx, ctx.orgId, req.body.assigneeId);
        // Unassigned, it goes to the property's usual person for that kind of job.
        const usual =
          req.body.kind === 'cleaning'
            ? property.cleaner
            : req.body.kind === 'maintenance'
              ? property.maintainer
              : null;
        const [template] = await tx.select().from(taskTemplates).where(eq(taskTemplates.kind, req.body.kind));
        const checklist = (req.body.checklist ?? template?.checklist ?? []).map((text) => ({
          text,
          done: false,
        }));
        const [row] = await tx
          .insert(tasks)
          .values({
            organisationId: ctx.orgId,
            propertyId: req.body.propertyId,
            kind: req.body.kind,
            source: 'manual',
            title: req.body.title ?? template?.title ?? 'Task',
            notes: req.body.notes || null,
            dueOn: req.body.dueOn,
            dueTime: req.body.dueTime ?? null,
            assigneeUserId: req.body.assigneeId ?? usual ?? null,
            checklist,
            createdBy: ctx.userId,
          })
          .returning({ id: tasks.id });
        if (!row) throw new Error('Inserting the task returned nothing.');
        const [task] = await loadTasks(tx, eq(tasks.id, row.id), 'asc', deps.photos);
        if (!task) throw new Error('The task was not found after insert.');
        return reply.code(201).send(task);
      }),
  );

  typed.patch(
    '/v1/tasks/:id',
    { schema: { params: TaskParams, body: TaskUpdateSchema, response: { 200: TaskSchema } } },
    async (req) =>
      deps.scope.inOrg(req, 'tasks.write', async (tx, ctx) => {
        const [current] = await tx.select().from(tasks).where(eq(tasks.id, req.params.id));
        if (!current)
          throw new HttpError(404, 'task_not_found', 'That task does not exist in this workspace.');
        const crew = ctx.role === 'field';
        if (crew) {
          // The crew works their own jobs: start, tick off, note, finish. Assigning and moving is the office's.
          if (current.assigneeUserId && current.assigneeUserId !== ctx.userId) {
            throw new HttpError(404, 'task_not_found', 'That task does not exist in this workspace.');
          }
          const allowed = new Set(['status', 'checklist', 'notes']);
          const extra = Object.keys(req.body).filter((k) => !allowed.has(k));
          if (extra.length)
            throw new HttpError(403, 'not_allowed', 'The field team can start, tick off and finish a task.');
          if (req.body.status === 'cancelled')
            throw new HttpError(403, 'not_allowed', 'Only the office cancels a task.');
        }
        if (req.body.assigneeId) await assertMember(tx, ctx.orgId, req.body.assigneeId);
        const b = req.body;
        const finishing = b.status === 'done' && current.status !== 'done';
        const reopening = b.status !== undefined && b.status !== 'done' && current.status === 'done';
        await tx
          .update(tasks)
          .set({
            ...(b.title !== undefined ? { title: b.title } : {}),
            ...(b.notes !== undefined ? { notes: b.notes || null } : {}),
            ...(b.status !== undefined ? { status: b.status } : {}),
            ...(b.dueOn !== undefined ? { dueOn: b.dueOn } : {}),
            ...(b.dueTime !== undefined ? { dueTime: b.dueTime } : {}),
            ...(b.assigneeId !== undefined ? { assigneeUserId: b.assigneeId } : {}),
            ...(b.checklist !== undefined ? { checklist: b.checklist } : {}),
            ...(finishing
              ? {
                  doneBy: ctx.userId,
                  doneAt: sql`now()`,
                  checklist: (b.checklist ?? current.checklist).map((c) => ({ ...c, done: true })),
                }
              : {}),
            ...(reopening ? { doneBy: null, doneAt: null } : {}),
            // A crew member who ticks a job off (and takes an unassigned one) is its assignee from then on.
            ...(crew && !current.assigneeUserId && b.status && b.status !== 'open'
              ? { assigneeUserId: ctx.userId }
              : {}),
          })
          .where(eq(tasks.id, current.id));
        // A finished clean means the property is clean, by the person who did it.
        if (finishing && current.kind === 'cleaning') {
          await tx
            .update(properties)
            .set({ cleaningStatus: 'clean', cleaningChangedAt: sql`now()`, cleaningChangedBy: ctx.userId })
            .where(eq(properties.id, current.propertyId));
        }
        const [task] = await loadTasks(tx, eq(tasks.id, current.id), 'asc', deps.photos);
        if (!task) throw new Error('The task was not found after update.');
        return task;
      }),
  );

  /** The crew reporting damage from a job: a maintenance task on the same property, for the office to assign. */
  typed.post(
    '/v1/tasks/:id/report',
    { schema: { params: TaskParams, body: DamageReportSchema, response: { 201: TaskSchema } } },
    async (req, reply) =>
      deps.scope.inOrg(req, 'tasks.write', async (tx, ctx) => {
        const from = await ownTask(tx, ctx, req.params.id);
        const [template] = await tx.select().from(taskTemplates).where(eq(taskTemplates.kind, 'maintenance'));
        const [property] = await tx
          .select({ maintainer: properties.maintainerUserId })
          .from(properties)
          .where(eq(properties.id, from.propertyId));
        const [row] = await tx
          .insert(tasks)
          .values({
            organisationId: ctx.orgId,
            propertyId: from.propertyId,
            kind: 'maintenance',
            source: 'report',
            title: 'Damage reported',
            notes: req.body.what,
            dueOn: from.dueOn,
            assigneeUserId: property?.maintainer ?? null,
            checklist: (template?.checklist ?? []).map((text) => ({ text, done: false })),
            createdBy: ctx.userId,
          })
          .returning({ id: tasks.id });
        if (!row) throw new Error('Inserting the report returned nothing.');
        const [task] = await loadTasks(tx, eq(tasks.id, row.id), 'asc', deps.photos);
        if (!task) throw new Error('The report was not found after insert.');
        return reply.code(201).send(task);
      }),
  );

  // Photos: the crew's proof of a clean, or what they found. Same upload flow as listing photos.

  typed.post(
    '/v1/tasks/:id/photos/uploads',
    {
      schema: {
        params: TaskParams,
        body: PhotoUploadRequestSchema,
        response: { 200: PhotoUploadTicketSchema },
      },
    },
    async (req) =>
      deps.scope.inOrg(req, 'tasks.write', async (tx, ctx) => {
        if (!deps.photos.ready) {
          throw new HttpError(
            503,
            'photo_storage_not_ready',
            "Photo storage isn't set up yet, so photos can't be added.",
          );
        }
        const task = await ownTask(tx, ctx, req.params.id);
        const [row] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(taskPhotos)
          .where(eq(taskPhotos.taskId, task.id));
        if ((row?.count ?? 0) >= TASK_PHOTO_MAX) {
          throw new HttpError(409, 'too_many_photos', `A task can have up to ${TASK_PHOTO_MAX} photos.`);
        }
        try {
          return await deps.photos.ticket(
            taskPhotoPath(ctx.orgId, task.id, req.body.contentType),
            req.body.contentType,
          );
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          req.log.error({ error: reason }, 'Photo storage refused an upload ticket');
          throw new HttpError(
            503,
            'photo_storage_refused',
            `Photo storage refused the upload: ${reason}. Check a private bucket named "${deps.bucket}" exists, and that the API has the service role key.`,
          );
        }
      }),
  );

  typed.post(
    '/v1/tasks/:id/photos',
    { schema: { params: TaskParams, body: TaskPhotoRegisterSchema, response: { 201: TaskSchema } } },
    async (req, reply) =>
      deps.scope.inOrg(req, 'tasks.write', async (tx, ctx) => {
        const task = await ownTask(tx, ctx, req.params.id);
        const { path } = req.body;
        if (!taskPhotoPathBelongsTo(path, ctx.orgId, task.id)) {
          throw new HttpError(400, 'invalid_request', 'That photo was not uploaded for this task.');
        }
        if (!(await deps.photos.exists(path))) {
          throw new HttpError(409, 'photo_not_uploaded', "The photo hasn't finished uploading. Try again.");
        }
        await tx.insert(taskPhotos).values({
          organisationId: ctx.orgId,
          taskId: task.id,
          storagePath: path,
          url: deps.photos.publicUrl(path),
          width: req.body.width,
          height: req.body.height,
          takenBy: ctx.userId,
          stage: req.body.stage,
          stamp: req.body.stamp || null,
        });
        const [full] = await loadTasks(tx, eq(tasks.id, task.id), 'asc', deps.photos);
        if (!full) throw new Error('The task was not found after adding the photo.');
        return reply.code(201).send(full);
      }),
  );

  typed.delete(
    '/v1/tasks/:id/photos/:photoId',
    { schema: { params: PhotoParams, response: { 200: TaskSchema } } },
    async (req) =>
      deps.scope.inOrg(req, 'tasks.write', async (tx, ctx) => {
        const task = await ownTask(tx, ctx, req.params.id);
        const [photo] = await tx
          .select({ id: taskPhotos.id, storagePath: taskPhotos.storagePath, takenBy: taskPhotos.takenBy })
          .from(taskPhotos)
          .where(and(eq(taskPhotos.id, req.params.photoId), eq(taskPhotos.taskId, task.id)));
        if (!photo) throw new HttpError(404, 'photo_not_found', 'That photo is not on this task.');
        // The crew removes their own photos; the office removes any.
        if (ctx.role === 'field' && photo.takenBy !== ctx.userId) {
          throw new HttpError(
            403,
            'not_allowed',
            'Only the person who took a photo, or the office, removes it.',
          );
        }
        await tx.delete(taskPhotos).where(eq(taskPhotos.id, photo.id));
        await deps.photos.remove(photo.storagePath).catch(() => {});
        const [full] = await loadTasks(tx, eq(tasks.id, task.id), 'asc', deps.photos);
        if (!full) throw new Error('The task was not found after removing the photo.');
        return full;
      }),
  );

  typed.get('/v1/task-templates', { schema: { response: { 200: TaskTemplateListSchema } } }, async (req) =>
    deps.scope.inOrg(req, 'tasks.read', async (tx) => ({
      templates: (await tx.select().from(taskTemplates).orderBy(asc(taskTemplates.kind))).map(toTemplate),
    })),
  );

  typed.patch(
    '/v1/task-templates/:kind',
    { schema: { params: KindParams, body: TaskTemplateUpdateSchema, response: { 200: TaskTemplateSchema } } },
    async (req) =>
      deps.scope.inOrg(req, 'tasks.manage', async (tx) => {
        const [row] = await tx
          .update(taskTemplates)
          .set({
            ...(req.body.title !== undefined ? { title: req.body.title } : {}),
            ...(req.body.checklist !== undefined ? { checklist: req.body.checklist } : {}),
            ...(req.body.automatic !== undefined ? { automatic: req.body.automatic } : {}),
          })
          .where(eq(taskTemplates.kind, req.params.kind))
          .returning();
        if (!row) throw new HttpError(404, 'template_not_found', 'That kind of task has no template here.');
        return toTemplate(row);
      }),
  );

  typed.get('/v1/team', { schema: { response: { 200: TeamListSchema } } }, async (req) =>
    deps.scope.inOrg(req, 'workspace.read', async (tx, ctx): Promise<TeamList> => {
      const rows = await tx
        .select({ id: appUsers.id, name: personName, email: appUsers.email, role: memberships.role })
        .from(memberships)
        .innerJoin(appUsers, eq(appUsers.id, memberships.userId))
        .where(eq(memberships.organisationId, ctx.orgId))
        .orderBy(sql`lower(${personName}) collate "C"`);
      // Email addresses are for the office; the crew and support see names.
      const hide = !can(ctx.role, 'members.manage') && ctx.role !== 'operations';
      return { members: rows.map((r) => ({ ...r, email: hide ? '' : r.email })) };
    }),
  );
}

/** The task, when the caller may work on it: anyone from the office; the crew only their own or unassigned. */
async function ownTask(
  tx: Tx,
  ctx: { role: string; userId: string },
  taskId: string,
): Promise<typeof tasks.$inferSelect> {
  const [task] = await tx.select().from(tasks).where(eq(tasks.id, taskId));
  if (!task) throw new HttpError(404, 'task_not_found', 'That task does not exist in this workspace.');
  if (ctx.role === 'field' && task.assigneeUserId && task.assigneeUserId !== ctx.userId) {
    throw new HttpError(404, 'task_not_found', 'That task does not exist in this workspace.');
  }
  return task;
}

async function assertMember(tx: Tx, orgId: string, userId: string): Promise<void> {
  const [member] = await tx
    .select({ id: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.organisationId, orgId), eq(memberships.userId, userId)));
  if (!member) throw new HttpError(400, 'not_a_member', 'That person is not a member of this workspace.');
}
