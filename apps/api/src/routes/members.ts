import { appUsers, guestyStaff, invitations, memberHomes, memberships, properties, type Tx } from '@v01/db';
import {
  GuestyPeopleAddedSchema,
  GuestyPeopleAddSchema,
  GuestyPeopleSchema,
  type GuestyPerson,
  INVITATION_DAYS,
  type Invitation,
  InvitationListSchema,
  InviteResultSchema,
  InviteSchema,
  MemberHomesSchema,
  MemberRoleUpdateSchema,
  MemberSkillsSchema,
  type Skill,
  type TeamMember,
  TeamMemberSchema,
} from '@v01/shared';
import { and, desc, eq, gt, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { type RequestScope, toIso } from '../context.ts';
import { HttpError } from '../errors.ts';
import { type InviteMailer, NO_INVITE_MAILER, NO_USER_DIRECTORY, type UserDirectory } from '../invites.ts';

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
        // Owners' log-ins are handled on the owner's page.
        ne(invitations.role, 'owner'),
      ),
    )
    .orderBy(desc(invitations.createdAt));
  return rows.map(({ i, invitedBy }) => ({
    id: i.id,
    email: i.email,
    name: i.fullName,
    role: i.role,
    invitedBy: i.invitedBy ? invitedBy : null,
    propertyIds: i.propertyIds ?? null,
    skills: i.skills as Skill[],
    createdAt: toIso(i.createdAt),
    expiresAt: i.expiresAt ? toIso(i.expiresAt) : null,
  }));
}

/** The homes each limited person may see; people missing from the map see every home. */
export async function homesByMember(tx: Tx, orgId: string): Promise<Map<string, string[]>> {
  const rows = await tx
    .select({ userId: memberships.userId, propertyId: memberHomes.propertyId })
    .from(memberships)
    .leftJoin(
      memberHomes,
      and(
        eq(memberHomes.organisationId, memberships.organisationId),
        eq(memberHomes.userId, memberships.userId),
      ),
    )
    .where(and(eq(memberships.organisationId, orgId), eq(memberships.homesLimited, true)));
  const map = new Map<string, string[]>();
  for (const r of rows) {
    const list = map.get(r.userId) ?? [];
    if (r.propertyId) list.push(r.propertyId);
    map.set(r.userId, list);
  }
  return map;
}

async function memberOr404(tx: Tx, orgId: string, userId: string): Promise<TeamMember> {
  const [row] = await tx
    .select({
      id: appUsers.id,
      name: personName,
      email: appUsers.email,
      role: memberships.role,
      skills: memberships.skills,
    })
    .from(memberships)
    .innerJoin(appUsers, eq(appUsers.id, memberships.userId))
    .where(and(eq(memberships.organisationId, orgId), eq(memberships.userId, userId)));
  if (!row) throw new HttpError(404, 'member_not_found', 'That person is not in this workspace.');
  return {
    ...row,
    skills: row.skills as Skill[],
    propertyIds: (await homesByMember(tx, orgId)).get(userId) ?? null,
  };
}

/** The homes asked for, checked: every one must be a home in this workspace. */
async function checkHomes(tx: Tx, ids: string[]): Promise<string[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return unique;
  const found = await tx.select({ id: properties.id }).from(properties).where(inArray(properties.id, unique));
  if (found.length !== unique.length)
    throw new HttpError(400, 'unknown_home', 'One of those homes is not in this workspace.');
  return unique;
}

async function setHomes(tx: Tx, orgId: string, userId: string, ids: string[] | null): Promise<void> {
  await tx
    .update(memberships)
    .set({ homesLimited: ids !== null })
    .where(and(eq(memberships.organisationId, orgId), eq(memberships.userId, userId)));
  await tx
    .delete(memberHomes)
    .where(and(eq(memberHomes.organisationId, orgId), eq(memberHomes.userId, userId)));
  if (ids?.length)
    await tx
      .insert(memberHomes)
      .values(ids.map((propertyId) => ({ organisationId: orgId, userId, propertyId })));
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
  deps: { scope: RequestScope; mailer: InviteMailer; appUrl: string; directory?: UserDirectory },
) {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const directory = deps.directory ?? NO_USER_DIRECTORY;

  typed.put(
    '/v1/members/:userId/skills',
    { schema: { params: MemberParams, body: MemberSkillsSchema, response: { 200: TeamMemberSchema } } },
    async (req) =>
      deps.scope.inOrg(req, 'members.manage', async (tx, ctx) => {
        const member = await memberOr404(tx, ctx.orgId, req.params.userId);
        if (member.role === 'owner')
          throw new HttpError(400, 'owner_login', 'An owner’s log-in doesn’t take jobs.');
        await tx
          .update(memberships)
          .set({ skills: [...new Set(req.body.skills)] })
          .where(and(eq(memberships.organisationId, ctx.orgId), eq(memberships.userId, req.params.userId)));
        return memberOr404(tx, ctx.orgId, req.params.userId);
      }),
  );

  /** The people on the Guesty account, and whether each is on the team here. */
  async function guestyPeople(tx: Tx, orgId: string): Promise<GuestyPerson[]> {
    const rows = await tx.select().from(guestyStaff).orderBy(sql`lower(${guestyStaff.fullName})`);
    const team = await tx
      .select({ id: memberships.userId, email: appUsers.email, role: memberships.role })
      .from(memberships)
      .innerJoin(appUsers, eq(appUsers.id, memberships.userId))
      .where(eq(memberships.organisationId, orgId));
    const byId = new Map(team.map((m) => [m.id, m]));
    const byEmail = new Map(team.map((m) => [m.email.toLowerCase(), m]));
    return rows.map((r) => {
      const m =
        (r.userId ? byId.get(r.userId) : undefined) ??
        (r.email ? byEmail.get(r.email.toLowerCase()) : undefined);
      return {
        id: r.id,
        name: r.fullName,
        email: r.email,
        tags: r.tags,
        skills: r.skills as Skill[],
        propertyIds: r.propertyIds ?? null,
        memberId: m?.id ?? null,
        memberRole: m?.role ?? null,
      };
    });
  }

  typed.get('/v1/team/guesty', { schema: { response: { 200: GuestyPeopleSchema } } }, async (req) =>
    deps.scope.inOrg(req, 'members.manage', async (tx, ctx) => ({
      people: await guestyPeople(tx, ctx.orgId),
    })),
  );

  /**
   * Brings people from Guesty onto the team as the field team, with their skills and homes, and
   * makes their sign-in without emailing them. Someone already here keeps their role; the skills
   * and homes from Guesty are added to theirs.
   */
  typed.post(
    '/v1/team/guesty',
    { schema: { body: GuestyPeopleAddSchema, response: { 200: GuestyPeopleAddedSchema } } },
    async (req) =>
      deps.scope.inOrg(req, 'members.manage', async (tx, ctx) => {
        const people = (await guestyPeople(tx, ctx.orgId)).filter((p) => req.body.ids.includes(p.id));
        const result = { added: 0, updated: 0, skipped: [] as { name: string; reason: string }[] };
        const homesNow = await homesByMember(tx, ctx.orgId);
        for (const p of people) {
          if (!p.email) {
            result.skipped.push({ name: p.name, reason: 'No email in Guesty.' });
            continue;
          }
          if (p.memberRole === 'owner' || p.memberRole === 'admin') {
            if (p.memberId)
              await tx.update(guestyStaff).set({ userId: p.memberId }).where(eq(guestyStaff.id, p.id));
            result.skipped.push({
              name: p.name,
              reason: p.memberRole === 'admin' ? 'Already an admin here.' : 'Has an owner’s log-in here.',
            });
            continue;
          }
          let userId = p.memberId;
          if (!userId) {
            let signInId: string;
            try {
              signInId = await directory.ensure(p.email, p.name);
            } catch (error) {
              req.log.warn({ err: error }, 'Could not make a sign-in for a colleague from Guesty');
              result.skipped.push({ name: p.name, reason: 'Their sign-in could not be made. Try again.' });
              continue;
            }
            const made = await tx.execute<{ id: string }>(
              sql`select app.ensure_colleague(${signInId}::uuid, ${p.email}, ${p.name}) as id`,
            );
            userId = made.rows[0]?.id ?? signInId;
            await tx
              .insert(memberships)
              .values({ organisationId: ctx.orgId, userId, role: 'field', skills: p.skills })
              .onConflictDoNothing();
            await setHomes(tx, ctx.orgId, userId, p.propertyIds);
            result.added += 1;
          } else {
            const [m] = await tx
              .select({ skills: memberships.skills })
              .from(memberships)
              .where(and(eq(memberships.organisationId, ctx.orgId), eq(memberships.userId, userId)));
            await tx
              .update(memberships)
              .set({ skills: [...new Set([...(m?.skills ?? []), ...p.skills])] })
              .where(and(eq(memberships.organisationId, ctx.orgId), eq(memberships.userId, userId)));
            const had = homesNow.get(userId);
            // Every home stays every home; otherwise Guesty's homes join theirs.
            if (had !== undefined)
              await setHomes(
                tx,
                ctx.orgId,
                userId,
                p.propertyIds === null ? null : [...new Set([...had, ...p.propertyIds])],
              );
            result.updated += 1;
          }
          await tx.update(guestyStaff).set({ userId }).where(eq(guestyStaff.id, p.id));
        }
        return result;
      }),
  );

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
        const limit = req.body.propertyIds ?? null;
        if (limit !== null && req.body.role === 'admin')
          throw new HttpError(400, 'admin_every_home', 'An admin always sees every home.');
        const propertyIds = limit === null ? null : await checkHomes(tx, limit);
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
            fullName: req.body.name,
            role: req.body.role,
            propertyIds,
            skills: [...new Set(req.body.skills ?? [])],
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
        reply.code(201);
        return { invitation, email: sent, reason: sent === 'none' ? reason : null };
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
        reply.code(204);
        return null;
      }),
  );

  typed.patch(
    '/v1/members/:userId',
    { schema: { params: MemberParams, body: MemberRoleUpdateSchema, response: { 200: TeamMemberSchema } } },
    async (req) =>
      deps.scope.inOrg(req, 'members.manage', async (tx, ctx) => {
        if (req.params.userId === ctx.userId && req.body.role !== undefined)
          throw new HttpError(400, 'own_role', 'Ask another admin to change your role.');
        const member = await memberOr404(tx, ctx.orgId, req.params.userId);
        if (req.body.role !== undefined) {
          if (member.role === 'owner')
            throw new HttpError(400, 'owner_login', "An owner's log-in is managed on the owner's page.");
          if (member.role === 'admin' && req.body.role !== 'admin' && (await admins(tx, ctx.orgId)) <= 1) {
            throw new HttpError(400, 'last_admin', 'The workspace needs at least one admin.');
          }
          // An admin sees every home.
          if (req.body.role === 'admin') await setHomes(tx, ctx.orgId, req.params.userId, null);
          await tx
            .update(memberships)
            .set({ role: req.body.role })
            .where(and(eq(memberships.organisationId, ctx.orgId), eq(memberships.userId, req.params.userId)));
        }
        if (req.body.name !== undefined) {
          await tx.execute(
            sql`select app.rename_member(${ctx.orgId}::uuid, ${req.params.userId}::uuid, ${req.body.name})`,
          );
        }
        return memberOr404(tx, ctx.orgId, req.params.userId);
      }),
  );

  typed.put(
    '/v1/members/:userId/homes',
    { schema: { params: MemberParams, body: MemberHomesSchema, response: { 200: TeamMemberSchema } } },
    async (req) =>
      deps.scope.inOrg(req, 'members.manage', async (tx, ctx) => {
        const member = await memberOr404(tx, ctx.orgId, req.params.userId);
        if (member.role === 'owner')
          throw new HttpError(
            400,
            'owner_login',
            "An owner sees their own homes; change them on the owner's page.",
          );
        if (member.role === 'admin' && req.body.propertyIds !== null)
          throw new HttpError(400, 'admin_every_home', 'An admin always sees every home.');
        const ids = req.body.propertyIds === null ? null : await checkHomes(tx, req.body.propertyIds);
        await setHomes(tx, ctx.orgId, req.params.userId, ids);
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
        reply.code(204);
        return null;
      }),
  );
}
