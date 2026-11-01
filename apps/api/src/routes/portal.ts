import type { Tx } from '@v01/db';
import {
  blocks,
  invitations,
  memberships,
  organisations,
  ownerStatements,
  owners,
  properties,
  reservations,
} from '@v01/db';
import {
  addDays,
  INVITATION_DAYS,
  type OwnerLoginBulkResult,
  OwnerLoginBulkResultSchema,
  OwnerLoginBulkSchema,
  OwnerLoginInviteSchema,
  type OwnerMonth,
  OwnerMonthSchema,
  OwnerSchema,
  type Portal,
  type PortalCalendar,
  PortalCalendarQuerySchema,
  PortalCalendarSchema,
  PortalSchema,
} from '@v01/shared';
import { and, asc, desc, eq, gt, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { OrgContext, RequestScope } from '../context.ts';
import { HttpError } from '../errors.ts';
import { type InviteMailer, NO_INVITE_MAILER } from '../invites.ts';
import type { PhotoStore } from '../photos.ts';
import { loadOwners, monthOf, oneOwner, savedStatement, settingsOf } from './owners.ts';

/**
 * The owner log-in (built 1 Nov 2026).
 *
 * The office gives an owner a log-in from the owner's page: an invitation to an email, which
 * becomes a membership with the role `owner`, tied to that owner. Signed in, the owner sees only
 * their own homes (row-level security works that out from `properties.owner_id`): when they are
 * booked, without guest names or contact details, and their finalised statements with receipts.
 * Every staff page refuses the owner role, so this is all they can reach.
 */

const Params = z.object({ id: z.uuid() });
const LoginParams = z.object({ id: z.uuid(), userId: z.uuid() });
const InviteParams = z.object({ id: z.uuid(), invitationId: z.uuid() });
const MonthParams = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) });

const MAX_CALENDAR_DAYS = 400;

async function ownerIdOf(tx: Tx, ctx: OrgContext): Promise<string> {
  const [m] = await tx
    .select({ ownerId: memberships.ownerId })
    .from(memberships)
    .where(and(eq(memberships.organisationId, ctx.orgId), eq(memberships.userId, ctx.userId)));
  if (!m?.ownerId)
    throw new HttpError(403, 'no_owner', 'This log-in is no longer tied to an owner. Ask the office.');
  return m.ownerId;
}

export function portalRoutes(
  app: FastifyInstance,
  deps: { scope: RequestScope; mailer: InviteMailer; appUrl: string; files: PhotoStore; now?: () => Date },
) {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  // The office side: give an owner a log-in, take it away. -------------------------------------

  /** Invites one owner; returns why not, or null when invited. */
  async function inviteOwner(
    tx: Tx,
    ctx: OrgContext,
    owner: { id: string; name: string },
    rawEmail: string,
    log: { warn(obj: object, msg: string): void },
  ): Promise<string | null> {
    const email = rawEmail.trim().toLowerCase();
    const [member] = (
      await tx.execute<{ role: string; owner_id: string | null }>(sql`
        select m.role::text as role, m.owner_id from app.memberships m join app.app_users u on u.id = m.user_id
         where m.organisation_id = ${ctx.orgId}::uuid and lower(u.email) = ${email}`)
    ).rows;
    if (member)
      return member.role === 'owner'
        ? `${email} already has an owner's log-in here.`
        : `${email} is on the team, so it can't be an owner's log-in too. Use another address.`;
    await tx
      .update(invitations)
      .set({ acceptedAt: sql`now()` })
      .where(and(sql`lower(${invitations.email}) = ${email}`, isNull(invitations.acceptedAt)));
    await tx.insert(invitations).values({
      organisationId: ctx.orgId,
      email,
      fullName: owner.name,
      role: 'owner',
      ownerId: owner.id,
      invitedBy: ctx.userId,
      expiresAt: sql`now() + interval '${sql.raw(String(INVITATION_DAYS))} days'`,
    });
    try {
      if (deps.mailer !== NO_INVITE_MAILER) await deps.mailer.send(email, `${deps.appUrl}/`);
    } catch (error) {
      log.warn({ err: error, email }, "The owner's invitation email couldn't be sent");
    }
    return null;
  }

  typed.post(
    '/v1/owners/:id/logins',
    { schema: { params: Params, body: OwnerLoginInviteSchema, response: { 201: OwnerSchema } } },
    async (req, reply) =>
      deps.scope.inOrg(req, 'owners.write', async (tx, ctx) => {
        const owner = await oneOwner(tx, req.params.id);
        const refused = await inviteOwner(tx, ctx, owner, req.body.email, req.log);
        if (refused) throw new HttpError(409, 'already_member', refused);
        reply.code(201);
        return oneOwner(tx, owner.id);
      }),
  );

  /** Every chosen owner with an email and no log-in yet gets an invitation. */
  typed.post(
    '/v1/owner-logins',
    { schema: { body: OwnerLoginBulkSchema, response: { 200: OwnerLoginBulkResultSchema } } },
    async (req) =>
      deps.scope.inOrg(req, 'owners.write', async (tx, ctx): Promise<OwnerLoginBulkResult> => {
        const all = await loadOwners(tx, inArray(owners.id, [...new Set(req.body.ownerIds)]));
        const result: OwnerLoginBulkResult = { invited: 0, skipped: [] };
        for (const o of all) {
          const why = !o.email
            ? 'No email on their record.'
            : o.logins.length
              ? 'Can already log in.'
              : o.invited.length
                ? 'Already invited.'
                : await inviteOwner(tx, ctx, o, o.email, req.log);
          if (why) result.skipped.push({ name: o.name, reason: why });
          else result.invited += 1;
        }
        return result;
      }),
  );

  typed.delete(
    '/v1/owners/:id/logins/:userId',
    { schema: { params: LoginParams, response: { 200: OwnerSchema } } },
    async (req) =>
      deps.scope.inOrg(req, 'owners.write', async (tx, ctx) => {
        const gone = await tx
          .delete(memberships)
          .where(
            and(
              eq(memberships.organisationId, ctx.orgId),
              eq(memberships.userId, req.params.userId),
              eq(memberships.role, 'owner'),
              eq(memberships.ownerId, req.params.id),
            ),
          )
          .returning({ id: memberships.id });
        if (!gone.length) throw new HttpError(404, 'login_not_found', 'That log-in is already gone.');
        return oneOwner(tx, req.params.id);
      }),
  );

  typed.delete(
    '/v1/owners/:id/invitations/:invitationId',
    { schema: { params: InviteParams, response: { 200: OwnerSchema } } },
    async (req) =>
      deps.scope.inOrg(req, 'owners.write', async (tx) => {
        const gone = await tx
          .delete(invitations)
          .where(
            and(
              eq(invitations.id, req.params.invitationId),
              eq(invitations.ownerId, req.params.id),
              isNull(invitations.acceptedAt),
            ),
          )
          .returning({ id: invitations.id });
        if (!gone.length)
          throw new HttpError(404, 'invitation_not_found', 'That invitation is no longer open.');
        return oneOwner(tx, req.params.id);
      }),
  );

  // The owner's side. ---------------------------------------------------------------------------

  typed.get('/v1/portal', { schema: { response: { 200: PortalSchema } } }, async (req) =>
    deps.scope.inOrg(req, 'portal.read', async (tx, ctx): Promise<Portal> => {
      const ownerId = await ownerIdOf(tx, ctx);
      const owner = await oneOwner(tx, ownerId);
      const { today, currency } = await settingsOf(tx, deps.now?.());
      const [org] = await tx
        .select({ name: organisations.name })
        .from(organisations)
        .where(eq(organisations.id, ctx.orgId));
      const homes = await tx
        .select({ id: properties.id, name: properties.name, area: properties.area })
        .from(properties)
        .where(isNull(properties.archivedAt))
        .orderBy(asc(properties.name));
      const month = today.slice(0, 7);
      const { first, next } = monthOf(month);
      // Row-level security keeps this to the owner's homes.
      const [m] = (
        await tx.execute<{ nights: number; minor: number }>(sql`
          select count(*)::int as nights,
                 coalesce(round(sum(r.total_minor::numeric / greatest(r.check_out - r.check_in, 1))), 0)::bigint as minor
            from app.reservations r
            cross join lateral generate_series(r.check_in, r.check_out - 1, interval '1 day') d
           where r.status = 'confirmed' and d >= ${first}::date and d < ${next}::date`)
      ).rows;
      const saved = await tx
        .select()
        .from(ownerStatements)
        .where(eq(ownerStatements.ownerId, ownerId))
        .orderBy(desc(ownerStatements.month));
      return {
        owner: { name: owner.name, company: owner.company },
        organisationName: org?.name ?? '',
        currency,
        today,
        homes,
        thisMonth: { month, bookedNights: Number(m?.nights ?? 0), earnedMinor: Number(m?.minor ?? 0) },
        statements: saved.map((s) => ({
          month: s.month,
          status: s.status as 'final' | 'paid',
          earnedMinor: Number(s.earnedMinor),
          feeMinor: Number(s.feeMinor),
          expensesMinor: Number(s.expensesMinor),
          netMinor: Number(s.netMinor),
          paidOn: s.paidOn,
        })),
      };
    }),
  );

  typed.get(
    '/v1/portal/calendar',
    { schema: { querystring: PortalCalendarQuerySchema, response: { 200: PortalCalendarSchema } } },
    async (req) =>
      deps.scope.inOrg(req, 'portal.read', async (tx, ctx): Promise<PortalCalendar> => {
        await ownerIdOf(tx, ctx);
        const { from, to } = req.query;
        if (to < from) throw new HttpError(400, 'invalid_request', 'The period ends before it starts.');
        if (Date.parse(to) - Date.parse(from) > MAX_CALENDAR_DAYS * 86_400_000)
          throw new HttpError(400, 'invalid_request', 'Choose a period of about a year or less.');
        const end = addDays(to, 1);
        const stays = await tx
          .select({
            id: reservations.id,
            propertyId: reservations.propertyId,
            checkIn: reservations.checkIn,
            checkOut: reservations.checkOut,
            channel: reservations.channel,
          })
          .from(reservations)
          .where(
            and(
              eq(reservations.status, 'confirmed'),
              lt(reservations.checkIn, end),
              gt(reservations.checkOut, from),
            ),
          )
          .orderBy(asc(reservations.checkIn));
        const held = await tx
          .select({
            id: blocks.id,
            propertyId: blocks.propertyId,
            startsOn: blocks.startsOn,
            endsOn: blocks.endsOn,
          })
          .from(blocks)
          .where(and(lt(blocks.startsOn, end), gt(blocks.endsOn, from)))
          .orderBy(asc(blocks.startsOn));
        return { from, to, stays, blocks: held };
      }),
  );

  typed.get(
    '/v1/portal/statements/:month',
    { schema: { params: MonthParams, response: { 200: OwnerMonthSchema } } },
    async (req) =>
      deps.scope.inOrg(req, 'portal.read', async (tx, ctx): Promise<OwnerMonth> => {
        const ownerId = await ownerIdOf(tx, ctx);
        const statement = await savedStatement(tx, ownerId, req.params.month, deps.files);
        if (!statement)
          throw new HttpError(404, 'statement_not_found', 'That month has no finalised statement yet.');
        // The office's notes about the owner, and who else logs in, stay with the office.
        return { ...statement, owner: { ...statement.owner, notes: null, logins: [], invited: [] } };
      }),
  );
}
