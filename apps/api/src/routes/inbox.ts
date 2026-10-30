import {
  appUsers,
  guests,
  messages,
  messageTemplates,
  messageThreads,
  properties,
  reservations,
  type Tx,
} from '@v01/db';
import {
  type Message,
  MessageSendSchema,
  type MessageTemplate,
  MessageTemplateCreateSchema,
  type MessageTemplateList,
  MessageTemplateListSchema,
  MessageTemplateSchema,
  MessageTemplateUpdateSchema,
  type MessageVia,
  type Thread,
  type ThreadDetail,
  ThreadDetailSchema,
  type ThreadList,
  ThreadListQuerySchema,
  ThreadListSchema,
  ThreadSchema,
  ThreadUpdateSchema,
} from '@v01/shared';
import { and, asc, desc, eq, ilike, isNotNull, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { type RequestScope, toIso } from '../context.ts';
import { HttpError } from '../errors.ts';

const ThreadParams = z.object({ id: z.uuid() });
const TemplateParams = z.object({ id: z.uuid() });

const SITE_CHATS = new Set(['airbnb', 'booking_com', 'vrbo', 'expedia']);

/** How a reply reaches the guest: the site's chat for a channel booking, else email or a text. */
export function replyVia(channel: string, email: string | null, phone: string | null): MessageVia | null {
  if (SITE_CHATS.has(channel)) return channel as MessageVia;
  if (email) return 'email';
  if (phone) return 'sms';
  return null;
}

async function loadThreads(tx: Tx, where: ReturnType<typeof and>, limit = 500): Promise<Thread[]> {
  const rows = await tx
    .select({
      thread: messageThreads,
      propertyName: properties.name,
      guestName: guests.fullName,
      guestEmail: guests.email,
      guestPhone: guests.phone,
      channel: reservations.channel,
      reservationStatus: reservations.status,
      checkIn: reservations.checkIn,
      checkOut: reservations.checkOut,
    })
    .from(messageThreads)
    .innerJoin(reservations, eq(reservations.id, messageThreads.reservationId))
    .innerJoin(properties, eq(properties.id, messageThreads.propertyId))
    .leftJoin(guests, eq(guests.id, reservations.guestId))
    .where(where)
    .orderBy(sql`${messageThreads.lastMessageAt} desc nulls last`, desc(reservations.checkIn))
    .limit(limit);
  return rows.map((r) => {
    const t = r.thread;
    return {
      id: t.id,
      reservationId: t.reservationId,
      propertyId: t.propertyId,
      propertyName: r.propertyName,
      guestName: r.guestName,
      guestEmail: r.guestEmail,
      guestPhone: r.guestPhone,
      channel: r.channel,
      reservationStatus: r.reservationStatus,
      checkIn: r.checkIn,
      checkOut: r.checkOut,
      status: t.status as Thread['status'],
      via: replyVia(r.channel, r.guestEmail, r.guestPhone),
      lastMessageAt: t.lastMessageAt ? toIso(t.lastMessageAt) : null,
      lastMessage:
        t.lastMessageAt && t.lastDirection && t.lastPreview !== null
          ? {
              direction: t.lastDirection as 'in' | 'out',
              body: t.lastPreview,
              at: toIso(t.lastMessageAt),
            }
          : null,
      unread: t.unreadCount,
      awaitingSince: t.awaitingSince ? toIso(t.awaitingSince) : null,
    };
  });
}

async function loadMessages(tx: Tx, threadId: string): Promise<Message[]> {
  const rows = await tx
    .select({
      m: messages,
      sentBy: sql<string | null>`coalesce(${appUsers.fullName}, ${appUsers.email})`,
      templateName: messageTemplates.name,
    })
    .from(messages)
    .leftJoin(appUsers, eq(appUsers.id, messages.sentBy))
    .leftJoin(messageTemplates, eq(messageTemplates.id, messages.templateId))
    .where(eq(messages.threadId, threadId))
    .orderBy(asc(messages.createdAt), asc(messages.id));
  return rows.map(({ m, sentBy, templateName }) => ({
    id: m.id,
    threadId: m.threadId,
    direction: m.direction as Message['direction'],
    via: m.via as MessageVia,
    body: m.body,
    status: m.status as Message['status'],
    note: m.note,
    sentBy: m.automatic ? null : sentBy,
    automatic: m.automatic,
    templateName: m.automatic ? templateName : null,
    at: toIso(m.createdAt),
    sentAt: m.sentAt ? toIso(m.sentAt) : null,
  }));
}

function toTemplate(row: typeof messageTemplates.$inferSelect): MessageTemplate {
  return {
    id: row.id,
    name: row.name,
    trigger: row.trigger as MessageTemplate['trigger'],
    sendTime: row.sendTime ? row.sendTime.slice(0, 5) : null,
    body: row.body,
    enabled: row.enabled,
    position: row.position,
  };
}

async function threadOr404(tx: Tx, id: string): Promise<Thread> {
  const [thread] = await loadThreads(tx, eq(messageThreads.id, id), 1);
  if (!thread)
    throw new HttpError(404, 'thread_not_found', 'That conversation does not exist in this workspace.');
  return thread;
}

export function inboxRoutes(app: FastifyInstance, deps: { scope: RequestScope }) {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/v1/inbox/threads',
    { schema: { querystring: ThreadListQuerySchema, response: { 200: ThreadListSchema } } },
    async (req) =>
      deps.scope.inOrg(req, 'inbox.read', async (tx): Promise<ThreadList> => {
        const q = req.query;
        const search = q.q?.trim();
        const matches = search
          ? or(
              ilike(guests.fullName, `%${search}%`),
              ilike(properties.name, `%${search}%`),
              ilike(reservations.channelReference, `%${search}%`),
            )
          : undefined;
        // The whole inbox is every booking's thread; the open view is what still has words in it.
        const byView =
          q.view === 'awaiting'
            ? isNotNull(messageThreads.awaitingSince)
            : q.view === 'open'
              ? and(eq(messageThreads.status, 'open'), isNotNull(messageThreads.lastMessageAt))
              : undefined;
        const threads = await loadThreads(tx, and(byView, matches));
        const [counts] = await tx
          .select({
            awaiting: sql<number>`(count(*) filter (where ${messageThreads.awaitingSince} is not null))::int`,
            open: sql<number>`(count(*) filter (where ${messageThreads.status} = 'open' and ${messageThreads.lastMessageAt} is not null))::int`,
          })
          .from(messageThreads);
        return { threads, counts: { awaiting: counts?.awaiting ?? 0, open: counts?.open ?? 0 } };
      }),
  );

  typed.get(
    '/v1/inbox/threads/:id',
    { schema: { params: ThreadParams, response: { 200: ThreadDetailSchema } } },
    async (req) =>
      deps.scope.inOrg(req, 'inbox.read', async (tx): Promise<ThreadDetail> => {
        const thread = await threadOr404(tx, req.params.id);
        return { thread, messages: await loadMessages(tx, thread.id) };
      }),
  );

  /** The thread for a booking, from its page. */
  typed.get(
    '/v1/reservations/:id/thread',
    { schema: { params: ThreadParams, response: { 200: ThreadSchema } } },
    async (req) =>
      deps.scope.inOrg(req, 'inbox.read', async (tx): Promise<Thread> => {
        const [thread] = await loadThreads(tx, eq(messageThreads.reservationId, req.params.id), 1);
        if (!thread) throw new HttpError(404, 'thread_not_found', 'That booking has no conversation here.');
        return thread;
      }),
  );

  typed.patch(
    '/v1/inbox/threads/:id',
    { schema: { params: ThreadParams, body: ThreadUpdateSchema, response: { 200: ThreadSchema } } },
    async (req) =>
      deps.scope.inOrg(req, 'inbox.write', async (tx): Promise<Thread> => {
        await threadOr404(tx, req.params.id);
        const b = req.body;
        await tx
          .update(messageThreads)
          .set({
            ...(b.status !== undefined ? { status: b.status } : {}),
            ...(b.read ? { unreadCount: 0 } : {}),
          })
          .where(eq(messageThreads.id, req.params.id));
        return threadOr404(tx, req.params.id);
      }),
  );

  typed.post(
    '/v1/inbox/threads/:id/messages',
    { schema: { params: ThreadParams, body: MessageSendSchema, response: { 201: ThreadDetailSchema } } },
    async (req, reply) =>
      deps.scope.inOrg(req, 'inbox.write', async (tx, ctx) => {
        const thread = await threadOr404(tx, req.params.id);
        let via = thread.via;
        if (req.body.via && !SITE_CHATS.has(thread.channel)) {
          if (req.body.via === 'email' && !thread.guestEmail)
            throw new HttpError(400, 'no_email', 'There is no email for this guest. Add one on the booking.');
          if (req.body.via === 'sms' && !thread.guestPhone)
            throw new HttpError(
              400,
              'no_phone',
              'There is no phone number for this guest. Add one on the booking.',
            );
          via = req.body.via;
        }
        if (!via) {
          throw new HttpError(
            400,
            'no_way_to_reach',
            'There is no email or phone number for this guest yet. Add one on the booking, then write again.',
          );
        }
        await tx.insert(messages).values({
          organisationId: ctx.orgId,
          threadId: thread.id,
          direction: 'out',
          via,
          body: req.body.body,
          status: 'queued',
          sentBy: ctx.userId,
        });
        // Replying marks the guest's messages read and the thread open.
        await tx
          .update(messageThreads)
          .set({ unreadCount: 0, status: 'open' })
          .where(eq(messageThreads.id, thread.id));
        const fresh = await threadOr404(tx, thread.id);
        reply.code(201);
        return { thread: fresh, messages: await loadMessages(tx, thread.id) };
      }),
  );

  // Templates: the automatic messages, and saved replies.

  typed.get(
    '/v1/inbox/templates',
    { schema: { response: { 200: MessageTemplateListSchema } } },
    async (req) =>
      deps.scope.inOrg(req, 'inbox.read', async (tx): Promise<MessageTemplateList> => {
        const rows = await tx
          .select()
          .from(messageTemplates)
          .orderBy(asc(messageTemplates.position), asc(messageTemplates.name));
        return { templates: rows.map(toTemplate) };
      }),
  );

  typed.post(
    '/v1/inbox/templates',
    { schema: { body: MessageTemplateCreateSchema, response: { 201: MessageTemplateSchema } } },
    async (req, reply) =>
      deps.scope.inOrg(req, 'inbox.manage', async (tx, ctx) => {
        const b = req.body;
        if (b.trigger !== 'manual') {
          const [taken] = await tx
            .select({ id: messageTemplates.id })
            .from(messageTemplates)
            .where(eq(messageTemplates.trigger, b.trigger));
          if (taken)
            throw new HttpError(
              409,
              'trigger_taken',
              'There is already an automatic message for that moment.',
            );
        }
        const [last] = await tx
          .select({ next: sql<number>`coalesce(max(${messageTemplates.position}), 0)::int + 1` })
          .from(messageTemplates);
        const next = last?.next ?? 1;
        const [row] = await tx
          .insert(messageTemplates)
          .values({
            organisationId: ctx.orgId,
            name: b.name,
            trigger: b.trigger,
            sendTime:
              b.trigger === 'manual' || b.trigger === 'booking_confirmed' ? null : (b.sendTime ?? '10:00'),
            body: b.body,
            enabled: b.enabled ?? true,
            position: next,
          })
          .returning();
        if (!row) throw new Error('Inserting the template returned nothing.');
        reply.code(201);
        return toTemplate(row);
      }),
  );

  typed.patch(
    '/v1/inbox/templates/:id',
    {
      schema: {
        params: TemplateParams,
        body: MessageTemplateUpdateSchema,
        response: { 200: MessageTemplateSchema },
      },
    },
    async (req) =>
      deps.scope.inOrg(req, 'inbox.manage', async (tx) => {
        const [current] = await tx
          .select()
          .from(messageTemplates)
          .where(eq(messageTemplates.id, req.params.id));
        if (!current) throw new HttpError(404, 'template_not_found', 'That message does not exist here.');
        const b = req.body;
        if (b.trigger !== undefined && b.trigger !== current.trigger && current.trigger !== 'manual') {
          throw new HttpError(
            400,
            'trigger_fixed',
            'An automatic message keeps its moment; switch it off instead.',
          );
        }
        const [row] = await tx
          .update(messageTemplates)
          .set({
            ...(b.name !== undefined ? { name: b.name } : {}),
            ...(b.trigger !== undefined ? { trigger: b.trigger } : {}),
            ...(b.sendTime !== undefined ? { sendTime: b.sendTime } : {}),
            ...(b.body !== undefined ? { body: b.body } : {}),
            ...(b.enabled !== undefined ? { enabled: b.enabled } : {}),
          })
          .where(eq(messageTemplates.id, req.params.id))
          .returning();
        if (!row) throw new Error('Updating the template returned nothing.');
        return toTemplate(row);
      }),
  );

  typed.delete(
    '/v1/inbox/templates/:id',
    { schema: { params: TemplateParams, response: { 204: z.null() } } },
    async (req, reply) =>
      deps.scope.inOrg(req, 'inbox.manage', async (tx) => {
        const [current] = await tx
          .select()
          .from(messageTemplates)
          .where(eq(messageTemplates.id, req.params.id));
        if (!current) throw new HttpError(404, 'template_not_found', 'That message does not exist here.');
        if (current.trigger !== 'manual')
          throw new HttpError(400, 'standard_template', 'An automatic message is switched off, not removed.');
        await tx.delete(messageTemplates).where(eq(messageTemplates.id, req.params.id));
        reply.code(204);
        return null;
      }),
  );
}
