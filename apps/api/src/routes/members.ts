import { appUsers, invitations, memberships, type Tx } from '@v01/db';
import {
  INVITATION_DAYS,
  type Invitation,
  InvitationListSchema,
  InviteResultSchema,
  InviteSchema,
  MemberRoleUpdateSchema,
  type TeamMember,
  TeamMemberSchema,
} from '@v01/shared';
import { and, desc, eq, gt, isNull, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { type RequestScope, toIso } from '../context.ts';
import { HttpError } from '../errors.ts';
import { type InviteMailer, NO_INVITE_MAILER } from '../invites.ts';

/**
 * The team (admins only): invite a colleague by email and role, change a role, remove someone.
 * The first time an invited email signs in, `/v1/me` turns the invitation into a membership. The
 * last admin can't be removed or demoted, and nobody changes their own role, so a workspace is
 * never left without someone who can manage it.
 */

const InvitationParams = z.object({ id: z.uuid() });
const MemberParams = z.object({ userId: z.uuid() });

const personName = sql<string>`coalesce(${appUsers.fullName}, ${appUsers.email})`;

async function openInvitations(tx: Tx): Promise<Invitation[]> {
  const rows = await tx
    .select({ i: invitations, invitedBy: personName })
    .from(invitations)
    .leftJoin(appUsers, eq(appUsers.id, invitations.invitedBy))
    .where(
      and(
        isNull(invitations.acceptedAt),
        or(isNull(invitations.expiresAt), gt(invitations.expiresAt, sql`now()`)),
      ),
    )
    .orderBy(desc(invitations.createdAt));
  return rows.map(({ i, invitedBy }) => ({
    id: i.id,
    email: i.email,
    role: i.role,
    invitedBy: i.invitedBy ? invitedBy : null,
    createdAt: toIso(i.createdAt),
    expiresAt: i.expiresAt ? toIso(i.expiresAt) : null,
  }));
}

async function memberOr404(tx: Tx, orgId: string, userId: string): Promise<TeamMember> {
  const [row] = await tx
    .select({ id: appUsers.id, name: personName, email: appUsers.email, role: memberships.role })
    .from(memberships)
    .innerJoin(appUsers, eq(appUsers.id, memberships.userId))
    .where(and(eq(memberships.organisationId, orgId), eq(memberships.userId, userId)));
  if (!row) throw new HttpError(404, 'member_not_found', 'That person is not in this workspace.');
  return row;
}

async function admins(tx: Tx, orgId: string): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(memberships)
    .where(and(eq(memberships.organisationId, orgId), eq(memberships.role, 'admin')));
  return row?.n ?? 0;
}

export function memberRoutes(
  app: FastifyInstance,
  deps: { scope: RequestScope; mailer: InviteMailer; appUrl: string },
) {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get('/v1/invitations', { schema: { response: { 200: InvitationListSchema } } }, async (req) =>
    deps.scope.inOrg(req, 'members.manage', async (tx) => ({ invitations: await openInvitations(tx) })),
  );

  typed.post(
    '/v1/invitations',
    { schema: { body: InviteSchema, response: { 201: InviteResultSchema } } },
    async (req, reply) =>
      deps.scope.inOrg(req, 'members.manage', async (tx, ctx) => {
        const email = req.body.email.trim().toLowerCase();
        const [already] = await tx
          .select({ id: memberships.userId })
          .from(memberships)
          .innerJoin(appUsers, eq(appUsers.id, memberships.userId))
          .where(and(eq(memberships.organisationId, ctx.orgId), sql`lower(${appUsers.email}) = ${email}`));
        if (already) throw new HttpError(409, 'already_member', `${email} is already in this workspace.`);
        // One open invitation per email: inviting again renews it with the new role.
        await tx
          .update(invitations)
          .set({ acceptedAt: sql`now()` })
          .where(and(sql`lower(${invitations.email}) = ${email}`, isNull(invitations.acceptedAt)));
        const [row] = await tx
          .insert(invitations)
          .values({
            organisationId: ctx.orgId,
            email,
            role: req.body.role,
            invitedBy: ctx.userId,
            expiresAt: sql`now() + interval '${sql.raw(String(INVITATION_DAYS))} days'`,
          })
          .returning({ id: invitations.id });
        if (!row) throw new Error('Inserting the invitation returned nothing.');
        let sent: Awaited<ReturnType<InviteMailer['send']>> = 'none';
        let reason: string | null =
          deps.mailer === NO_INVITE_MAILER
            ? 'The API has no Supabase service key, so it cannot ask for emails.'
            : null;
        try {
          sent = await deps.mailer.send(email, `${deps.appUrl}/`);
        } catch (error) {
          reason = error instanceof Error ? error.message : String(error);
          req.log.warn({ err: error, email }, "The invitation email couldn't be sent");
        }
        const invitation = (await openInvitations(tx)).find((i) => i.id === row.id);
        if (!invitation) throw new Error('The invitation was not found after insert.');
        return reply.code(201).send({ invitation, email: sent, reason: sent === 'none' ? reason : null });
      }),
  );

  typed.delete(
    '/v1/invitations/:id',
    { schema: { params: InvitationParams, response: { 204: z.null() } } },
    async (req, reply) =>
      deps.scope.inOrg(req, 'members.manage', async (tx) => {
        const gone = await tx
          .delete(invitations)
          .where(and(eq(invitations.id, req.params.id), isNull(invitations.acceptedAt)))
          .returning({ id: invitations.id });
        if (gone.length === 0)
          throw new HttpError(404, 'invitation_not_found', 'That invitation is no longer open.');
        return reply.code(204).send(null);
      }),
  );

  typed.patch(
    '/v1/members/:userId',
    { schema: { params: MemberParams, body: MemberRoleUpdateSchema, response: { 200: TeamMemberSchema } } },
    async (req) =>
      deps.scope.inOrg(req, 'members.manage', async (tx, ctx) => {
        if (req.params.userId === ctx.userId)
          throw new HttpError(400, 'own_role', 'Ask another admin to change your role.');
        const member = await memberOr404(tx, ctx.orgId, req.params.userId);
        if (member.role === 'admin' && req.body.role !== 'admin' && (await admins(tx, ctx.orgId)) <= 1) {
          throw new HttpError(400, 'last_admin', 'The workspace needs at least one admin.');
        }
        await tx
          .update(memberships)
          .set({ role: req.body.role })
          .where(and(eq(memberships.organisationId, ctx.orgId), eq(memberships.userId, req.params.userId)));
        return memberOr404(tx, ctx.orgId, req.params.userId);
      }),
  );

  typed.delete(
    '/v1/members/:userId',
    { schema: { params: MemberParams, response: { 204: z.null() } } },
    async (req, reply) =>
      deps.scope.inOrg(req, 'members.manage', async (tx, ctx) => {
        if (req.params.userId === ctx.userId)
          throw new HttpError(400, 'own_membership', 'Ask another admin to remove you.');
        const member = await memberOr404(tx, ctx.orgId, req.params.userId);
        if (member.role === 'admin' && (await admins(tx, ctx.orgId)) <= 1) {
          throw new HttpError(400, 'last_admin', 'The workspace needs at least one admin.');
        }
        await tx
          .delete(memberships)
          .where(and(eq(memberships.organisationId, ctx.orgId), eq(memberships.userId, req.params.userId)));
        return reply.code(204).send(null);
      }),
  );
}
