import { randomUUID } from 'node:crypto';
import {
  appUsers,
  claimFiles,
  claimItems,
  claims,
  guests,
  organisationSettings,
  properties,
  reservations,
  type Tx,
} from '@v01/db';
import {
  addDays,
  type Channel,
  CLAIM_DAYS,
  CLAIM_FILE_MAX,
  type Claim,
  ClaimCreateSchema,
  ClaimFileRegisterSchema,
  ClaimFileUploadRequestSchema,
  ClaimItemInputSchema,
  type ClaimList,
  ClaimListQuerySchema,
  ClaimListSchema,
  ClaimSchema,
  type ClaimSummary,
  ClaimUpdateSchema,
  claimDeadline,
  claimPlaceFor,
  PhotoUploadTicketSchema,
  todayIn,
} from '@v01/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { type RequestScope, toIso } from '../context.ts';
import { HttpError } from '../errors.ts';
import type { PhotoStore } from '../photos.ts';
import { claimExpenses } from './owners.ts';

/**
 * Damage claims (built 30 Oct 2026): one per booking. The team lists what was damaged and what it
 * costs, adds receipts and their own photos (kept as uploaded), and V-01 gathers the photos from
 * the cleans before and after the stay. Filing is done by a person on the channel; V-01 keeps the
 * deadline in front of them and records where it went and what came back.
 */

const Params = z.object({ id: z.uuid() });
const ItemParams = z.object({ id: z.uuid(), itemId: z.uuid() });
const FileParams = z.object({ id: z.uuid(), fileId: z.uuid() });

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'application/pdf': 'pdf',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
};

const claimFilePath = (orgId: string, claimId: string, contentType: string) =>
  `${orgId}/claims/${claimId}/${randomUUID()}.${EXTENSIONS[contentType] ?? 'bin'}`;

const claimFilePathBelongsTo = (path: string, orgId: string, claimId: string) =>
  /^[0-9a-f-]{36}\/claims\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp|heic|pdf|mp4|mov)$/.test(path) &&
  path.startsWith(`${orgId}/claims/${claimId}/`);

const personName = sql<string>`coalesce(${appUsers.fullName}, ${appUsers.email})`;

async function settingsOf(tx: Tx, now: Date = new Date()): Promise<{ today: string; currency: string }> {
  const [s] = await tx
    .select({ timeZone: organisationSettings.timeZone, currency: organisationSettings.currency })
    .from(organisationSettings);
  return { today: todayIn(s?.timeZone ?? 'Europe/London', now), currency: s?.currency ?? 'GBP' };
}

/** The next confirmed arrival at the home after this stay ends, if any. */
async function nextCheckIn(tx: Tx, propertyId: string, checkOut: string): Promise<string | null> {
  const [row] = (
    await tx.execute<{ check_in: string }>(sql`
      select check_in::text from app.reservations
       where property_id = ${propertyId} and status = 'confirmed' and check_in >= ${checkOut}::date
       order by check_in limit 1`)
  ).rows;
  return row?.check_in ?? null;
}

const summaryColumns = {
  id: claims.id,
  reservationId: claims.reservationId,
  propertyId: reservations.propertyId,
  propertyName: properties.name,
  guestName: guests.fullName,
  channel: reservations.channel,
  channelReference: reservations.channelReference,
  checkIn: reservations.checkIn,
  checkOut: reservations.checkOut,
  status: claims.status,
  place: claims.place,
  deadline: claims.deadline,
  currency: reservations.currency,
  receivedMinor: claims.receivedMinor,
  createdAt: claims.createdAt,
  claimedMinor: sql<number>`coalesce((select sum(i.amount_minor) from app.claim_items i where i.claim_id = ${claims.id}), 0)::bigint`,
};

type SummaryRow = {
  [K in keyof typeof summaryColumns]: unknown;
};

function toSummary(r: SummaryRow, currency: string): ClaimSummary {
  return {
    id: r.id as string,
    reservationId: r.reservationId as string,
    propertyId: r.propertyId as string,
    propertyName: r.propertyName as string,
    guestName: (r.guestName as string | null) ?? null,
    channel: r.channel as Channel,
    channelReference: (r.channelReference as string | null) ?? null,
    checkIn: r.checkIn as string,
    checkOut: r.checkOut as string,
    status: r.status as ClaimSummary['status'],
    place: r.place as ClaimSummary['place'],
    deadline: r.deadline as string,
    currency: (r.currency as string | null) ?? currency,
    claimedMinor: Number(r.claimedMinor ?? 0),
    receivedMinor: r.receivedMinor === null || r.receivedMinor === undefined ? null : Number(r.receivedMinor),
    createdAt: toIso(String(r.createdAt)),
  };
}

function summaries(tx: Tx) {
  return tx
    .select(summaryColumns)
    .from(claims)
    .innerJoin(reservations, eq(reservations.id, claims.reservationId))
    .innerJoin(properties, eq(properties.id, reservations.propertyId))
    .leftJoin(guests, eq(guests.id, reservations.guestId));
}

async function loadClaim(tx: Tx, id: string, store: PhotoStore): Promise<Claim> {
  const { currency } = await settingsOf(tx);
  const [row] = await summaries(tx).where(eq(claims.id, id));
  if (!row) throw new HttpError(404, 'claim_not_found', 'That claim does not exist in this workspace.');
  const [extra] = await tx
    .select({
      summary: claims.summary,
      filedOn: claims.filedOn,
      filedReference: claims.filedReference,
      outcome: claims.outcome,
      createdBy: personName,
    })
    .from(claims)
    .leftJoin(appUsers, eq(appUsers.id, claims.createdBy))
    .where(eq(claims.id, id));
  const base = toSummary(row, currency);

  const items = await tx
    .select({ id: claimItems.id, description: claimItems.description, amountMinor: claimItems.amountMinor })
    .from(claimItems)
    .where(eq(claimItems.claimId, id))
    .orderBy(asc(claimItems.position), asc(claimItems.createdAt));

  const fileRows = await tx
    .select({
      id: claimFiles.id,
      kind: claimFiles.kind,
      fileName: claimFiles.fileName,
      contentType: claimFiles.contentType,
      bytes: claimFiles.bytes,
      storagePath: claimFiles.storagePath,
      uploadedBy: personName,
      createdAt: claimFiles.createdAt,
    })
    .from(claimFiles)
    .leftJoin(appUsers, eq(appUsers.id, claimFiles.uploadedBy))
    .where(eq(claimFiles.claimId, id))
    .orderBy(asc(claimFiles.createdAt));

  // The team's photos around the stay: the last clean before the guest arrived (the home as it
  // was), and every job at the home from check-out until the next guest or 14 days (as they left it).
  const next = await nextCheckIn(tx, base.propertyId, base.checkOut);
  const afterUntil =
    next && next < addDays(base.checkOut, CLAIM_DAYS) ? next : addDays(base.checkOut, CLAIM_DAYS);
  const photoRows = (
    await tx.execute<{
      id: string;
      storage_path: string;
      url: string;
      stage: 'before' | 'after' | 'found';
      stamp: string | null;
      created_at: string;
      taken_by: string | null;
      task_id: string;
      title: string;
      due_on: string;
      side: 'before' | 'after';
    }>(sql`
      with prior as (
        select t.id from app.tasks t
         where t.property_id = ${base.propertyId} and t.kind = 'cleaning'
           and t.due_on <= ${base.checkIn}::date and t.due_on >= ${base.checkIn}::date - 60
           and exists (select 1 from app.task_photos p where p.task_id = t.id)
         order by t.due_on desc, t.created_at desc limit 1
      ), around as (
        select t.id from app.tasks t
         where t.property_id = ${base.propertyId}
           and (t.reservation_id = ${base.reservationId}
                or (t.due_on >= ${base.checkOut}::date and t.due_on <= ${afterUntil}::date))
           and not exists (select 1 from prior where prior.id = t.id)
      )
      select p.id, p.storage_path, p.url, p.stage, p.stamp, p.created_at::text, coalesce(u.full_name, u.email) as taken_by,
             t.id as task_id, t.title, t.due_on::text,
             case when t.id in (select id from prior) then 'before' else 'after' end as side
        from app.task_photos p
        join app.tasks t on t.id = p.task_id
        left join app.app_users u on u.id = p.taken_by
       where t.id in (select id from prior) or t.id in (select id from around)
       order by t.due_on, p.created_at`)
  ).rows;

  const reports = (
    await tx.execute<{ task_id: string; due_on: string; notes: string | null; by: string | null }>(sql`
      select t.id as task_id, t.due_on::text, t.notes, coalesce(u.full_name, u.email) as by
        from app.tasks t left join app.app_users u on u.id = t.created_by
       where t.property_id = ${base.propertyId} and t.source = 'report'
         and (t.reservation_id = ${base.reservationId}
              or (t.due_on >= ${base.checkOut}::date and t.due_on <= ${afterUntil}::date))
       order by t.due_on, t.created_at`)
  ).rows;

  const signed = await store.viewUrls([
    ...fileRows.map((f) => f.storagePath),
    ...photoRows.map((p) => p.storage_path),
  ]);
  const fileUrl = (i: number) => signed[i] ?? store.publicUrl(fileRows[i]?.storagePath ?? '');
  const photoUrl = (i: number) => signed[fileRows.length + i] ?? photoRows[i]?.url ?? '';
  const photo = (p: (typeof photoRows)[number], i: number) => ({
    id: p.id,
    url: photoUrl(i),
    stage: p.stage,
    stamp: p.stamp,
    takenAt: toIso(p.created_at),
    takenBy: p.taken_by,
    taskId: p.task_id,
    taskTitle: p.title,
    taskDay: p.due_on,
  });
  const allPhotos = photoRows.map(photo);

  return {
    ...base,
    summary: extra?.summary ?? null,
    filedOn: extra?.filedOn ?? null,
    filedReference: extra?.filedReference ?? null,
    outcome: extra?.outcome ?? null,
    createdBy: extra?.createdBy ?? null,
    items: items.map((i) => ({ id: i.id, description: i.description, amountMinor: Number(i.amountMinor) })),
    files: fileRows.map((f, i) => ({
      id: f.id,
      kind: f.kind as 'photo' | 'receipt' | 'other',
      fileName: f.fileName,
      contentType: f.contentType,
      bytes: Number(f.bytes),
      url: fileUrl(i),
      uploadedBy: f.uploadedBy ?? null,
      createdAt: toIso(String(f.createdAt)),
    })),
    before: allPhotos.filter((_, i) => photoRows[i]?.side === 'before'),
    after: allPhotos.filter((_, i) => photoRows[i]?.side === 'after'),
    reports: reports.map((r) => ({ taskId: r.task_id, day: r.due_on, what: r.notes, by: r.by })),
    nextCheckIn: next,
    costs: await claimExpenses(tx, id, store),
  };
}

async function ownClaim(tx: Tx, id: string): Promise<typeof claims.$inferSelect> {
  const [claim] = await tx.select().from(claims).where(eq(claims.id, id));
  if (!claim) throw new HttpError(404, 'claim_not_found', 'That claim does not exist in this workspace.');
  return claim;
}

export function claimRoutes(
  app: FastifyInstance,
  deps: { scope: RequestScope; files: PhotoStore; bucket: string; now?: () => Date },
) {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/v1/claims',
    { schema: { querystring: ClaimListQuerySchema, response: { 200: ClaimListSchema } } },
    async (req) =>
      deps.scope.inOrg(req, 'claims.read', async (tx): Promise<ClaimList> => {
        const { today, currency } = await settingsOf(tx, deps.now?.());
        const active = req.query.view === 'active';
        const rows = await summaries(tx)
          .where(inArray(claims.status, active ? ['open', 'filed'] : ['paid', 'closed']))
          .orderBy(active ? asc(claims.deadline) : sql`${claims.updatedAt} desc`);
        const [counts] = (
          await tx.execute<{ active: number; done: number }>(sql`
            select count(*) filter (where status in ('open', 'filed'))::int as active,
                   count(*) filter (where status in ('paid', 'closed'))::int as done
              from app.claims`)
        ).rows;

        // Damage the team reported in the last weeks, on a stay with no claim yet.
        const suggestions = (
          await tx.execute<{
            reservation_id: string;
            property_name: string;
            guest_name: string | null;
            channel: Channel;
            check_out: string;
            next_check_in: string | null;
            reports: number;
          }>(sql`
            with reported as (
              select coalesce(t.reservation_id, (
                       select r.id from app.reservations r
                        where r.property_id = t.property_id and r.status = 'confirmed'
                          and r.check_out <= t.due_on and r.check_out >= t.due_on - ${CLAIM_DAYS}::int
                        order by r.check_out desc limit 1)) as reservation_id
                from app.tasks t
               where t.source = 'report' and t.due_on >= ${today}::date - ${CLAIM_DAYS + 7}::int
            )
            select r.id as reservation_id, p.name as property_name, g.full_name as guest_name, r.channel,
                   r.check_out::text,
                   (select n.check_in::text from app.reservations n
                     where n.property_id = r.property_id and n.status = 'confirmed' and n.check_in >= r.check_out
                     order by n.check_in limit 1) as next_check_in,
                   count(*)::int as reports
              from reported x
              join app.reservations r on r.id = x.reservation_id
              join app.properties p on p.id = r.property_id
              left join app.guests g on g.id = r.guest_id
             where not exists (select 1 from app.claims c where c.reservation_id = r.id)
               and r.check_out <= ${today}::date
             group by r.id, p.name, g.full_name
             order by r.check_out desc`)
        ).rows.map((s) => ({
          reservationId: s.reservation_id,
          propertyName: s.property_name,
          guestName: s.guest_name,
          channel: s.channel,
          checkOut: s.check_out,
          deadline: claimDeadline(s.channel, s.check_out, s.next_check_in),
          reports: s.reports,
        }));

        return {
          today,
          claims: rows.map((r) => toSummary(r, currency)),
          suggestions,
          counts: { active: counts?.active ?? 0, done: counts?.done ?? 0 },
        };
      }),
  );

  typed.post(
    '/v1/claims',
    { schema: { body: ClaimCreateSchema, response: { 200: ClaimSchema, 201: ClaimSchema } } },
    async (req, reply) =>
      deps.scope.inOrg(req, 'claims.write', async (tx, ctx) => {
        const [booking] = await tx
          .select({
            id: reservations.id,
            propertyId: reservations.propertyId,
            channel: reservations.channel,
            checkOut: reservations.checkOut,
            status: reservations.status,
          })
          .from(reservations)
          .where(eq(reservations.id, req.body.reservationId));
        if (!booking) {
          throw new HttpError(404, 'reservation_not_found', 'That booking does not exist in this workspace.');
        }
        const [existing] = await tx
          .select({ id: claims.id })
          .from(claims)
          .where(eq(claims.reservationId, booking.id));
        // One claim per booking: asking again opens the one there is.
        if (existing) {
          reply.code(200);
          return await loadClaim(tx, existing.id, deps.files);
        }
        const next = await nextCheckIn(tx, booking.propertyId, booking.checkOut);
        const [row] = await tx
          .insert(claims)
          .values({
            organisationId: ctx.orgId,
            reservationId: booking.id,
            place: claimPlaceFor(booking.channel),
            deadline: claimDeadline(booking.channel, booking.checkOut, next),
            createdBy: ctx.userId,
          })
          .returning({ id: claims.id });
        if (!row) throw new Error('Inserting the claim returned nothing.');
        reply.code(201);
        return await loadClaim(tx, row.id, deps.files);
      }),
  );

  typed.get('/v1/claims/:id', { schema: { params: Params, response: { 200: ClaimSchema } } }, async (req) =>
    deps.scope.inOrg(req, 'claims.read', async (tx) => loadClaim(tx, req.params.id, deps.files)),
  );

  typed.patch(
    '/v1/claims/:id',
    { schema: { params: Params, body: ClaimUpdateSchema, response: { 200: ClaimSchema } } },
    async (req) =>
      deps.scope.inOrg(req, 'claims.write', async (tx) => {
        const claim = await ownClaim(tx, req.params.id);
        const b = req.body;
        const blank = (v: string | null | undefined) =>
          v === undefined ? undefined : v?.trim() ? v.trim() : null;
        // Marking it filed records the day, unless the team gave one.
        const filedOn =
          b.filedOn !== undefined
            ? b.filedOn
            : b.status === 'filed' && !claim.filedOn
              ? (await settingsOf(tx, deps.now?.())).today
              : undefined;
        await tx
          .update(claims)
          .set({
            ...(b.status !== undefined ? { status: b.status } : {}),
            ...(b.place !== undefined ? { place: b.place } : {}),
            ...(b.deadline !== undefined ? { deadline: b.deadline } : {}),
            ...(b.summary !== undefined ? { summary: blank(b.summary) } : {}),
            ...(filedOn !== undefined ? { filedOn } : {}),
            ...(b.filedReference !== undefined ? { filedReference: blank(b.filedReference) } : {}),
            ...(b.receivedMinor !== undefined ? { receivedMinor: b.receivedMinor } : {}),
            ...(b.outcome !== undefined ? { outcome: blank(b.outcome) } : {}),
          })
          .where(eq(claims.id, claim.id));
        return loadClaim(tx, claim.id, deps.files);
      }),
  );

  // What was damaged, line by line.

  typed.post(
    '/v1/claims/:id/items',
    { schema: { params: Params, body: ClaimItemInputSchema, response: { 201: ClaimSchema } } },
    async (req, reply) =>
      deps.scope.inOrg(req, 'claims.write', async (tx, ctx) => {
        const claim = await ownClaim(tx, req.params.id);
        const [pos] = (
          await tx.execute<{ n: number }>(
            sql`select coalesce(max(position), -1)::int + 1 as n from app.claim_items where claim_id = ${claim.id}`,
          )
        ).rows;
        await tx.insert(claimItems).values({
          organisationId: ctx.orgId,
          claimId: claim.id,
          description: req.body.description,
          amountMinor: req.body.amountMinor,
          position: pos?.n ?? 0,
        });
        reply.code(201);
        return await loadClaim(tx, claim.id, deps.files);
      }),
  );

  typed.patch(
    '/v1/claims/:id/items/:itemId',
    { schema: { params: ItemParams, body: ClaimItemInputSchema, response: { 200: ClaimSchema } } },
    async (req) =>
      deps.scope.inOrg(req, 'claims.write', async (tx) => {
        const claim = await ownClaim(tx, req.params.id);
        const updated = await tx
          .update(claimItems)
          .set({ description: req.body.description, amountMinor: req.body.amountMinor })
          .where(and(eq(claimItems.id, req.params.itemId), eq(claimItems.claimId, claim.id)))
          .returning({ id: claimItems.id });
        if (!updated.length) throw new HttpError(404, 'item_not_found', 'That line is not on this claim.');
        return loadClaim(tx, claim.id, deps.files);
      }),
  );

  typed.delete(
    '/v1/claims/:id/items/:itemId',
    { schema: { params: ItemParams, response: { 200: ClaimSchema } } },
    async (req) =>
      deps.scope.inOrg(req, 'claims.write', async (tx) => {
        const claim = await ownClaim(tx, req.params.id);
        await tx
          .delete(claimItems)
          .where(and(eq(claimItems.id, req.params.itemId), eq(claimItems.claimId, claim.id)));
        return loadClaim(tx, claim.id, deps.files);
      }),
  );

  // Files: photos, videos, receipts and invoices, kept exactly as uploaded in the private bucket.

  typed.post(
    '/v1/claims/:id/files/uploads',
    {
      schema: {
        params: Params,
        body: ClaimFileUploadRequestSchema,
        response: { 200: PhotoUploadTicketSchema },
      },
    },
    async (req) =>
      deps.scope.inOrg(req, 'claims.write', async (tx, ctx) => {
        if (!deps.files.ready) {
          throw new HttpError(
            503,
            'photo_storage_not_ready',
            "File storage isn't set up yet, so files can't be added.",
          );
        }
        const claim = await ownClaim(tx, req.params.id);
        const [row] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(claimFiles)
          .where(eq(claimFiles.claimId, claim.id));
        if ((row?.count ?? 0) >= CLAIM_FILE_MAX) {
          throw new HttpError(409, 'too_many_files', `A claim can have up to ${CLAIM_FILE_MAX} files.`);
        }
        try {
          return await deps.files.ticket(
            claimFilePath(ctx.orgId, claim.id, req.body.contentType),
            req.body.contentType,
          );
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          req.log.error({ error: reason }, 'File storage refused an upload ticket');
          throw new HttpError(
            503,
            'photo_storage_refused',
            `File storage refused the upload: ${reason}. Check a private bucket named "${deps.bucket}" exists.`,
          );
        }
      }),
  );

  typed.post(
    '/v1/claims/:id/files',
    { schema: { params: Params, body: ClaimFileRegisterSchema, response: { 201: ClaimSchema } } },
    async (req, reply) =>
      deps.scope.inOrg(req, 'claims.write', async (tx, ctx) => {
        const claim = await ownClaim(tx, req.params.id);
        const { path } = req.body;
        if (!claimFilePathBelongsTo(path, ctx.orgId, claim.id)) {
          throw new HttpError(400, 'invalid_request', 'That file was not uploaded for this claim.');
        }
        if (!(await deps.files.exists(path))) {
          throw new HttpError(409, 'file_not_uploaded', "The file hasn't finished uploading. Try again.");
        }
        await tx.insert(claimFiles).values({
          organisationId: ctx.orgId,
          claimId: claim.id,
          kind: req.body.kind,
          storagePath: path,
          fileName: req.body.fileName,
          contentType: req.body.contentType,
          bytes: req.body.bytes,
          uploadedBy: ctx.userId,
        });
        reply.code(201);
        return await loadClaim(tx, claim.id, deps.files);
      }),
  );

  typed.delete(
    '/v1/claims/:id/files/:fileId',
    { schema: { params: FileParams, response: { 200: ClaimSchema } } },
    async (req) =>
      deps.scope.inOrg(req, 'claims.write', async (tx) => {
        const claim = await ownClaim(tx, req.params.id);
        const [file] = await tx
          .select({ id: claimFiles.id, storagePath: claimFiles.storagePath })
          .from(claimFiles)
          .where(and(eq(claimFiles.id, req.params.fileId), eq(claimFiles.claimId, claim.id)));
        if (!file) throw new HttpError(404, 'file_not_found', 'That file is not on this claim.');
        await tx.delete(claimFiles).where(eq(claimFiles.id, file.id));
        await deps.files.remove(file.storagePath).catch(() => {});
        return loadClaim(tx, claim.id, deps.files);
      }),
  );
}
