import type { ApiDatabase } from '@v01/db';
import { appUsers, memberships, organisations } from '@v01/db';
import { canPlatform, MeSchema, MeUpdateSchema, type PlatformRole } from '@v01/shared';
import { asc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { isoOrNull, pgErrorCode, type RequestScope } from '../context.ts';
import { HttpError } from '../errors.ts';

/**
 * The web app calls this first after sign-in. It records the person, turns any invitations
 * for their email into memberships, links them to V-01 staff if their email is on the staff
 * list, and returns the operators they can open (as members, or on an open support grant).
 */
export function meRoutes(app: FastifyInstance, deps: { db: ApiDatabase; scope: RequestScope }) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .get('/v1/me', { schema: { response: { 200: MeSchema } } }, async (req) => {
      const user = await deps.scope.user(req);
      return deps.db.withUser(user.id, async (tx) => {
        try {
          await tx
            .insert(appUsers)
            .values({ id: user.id, email: user.email })
            .onConflictDoUpdate({
              target: appUsers.id,
              set: { email: user.email, lastSeenAt: sql`now()` },
            });
        } catch (error) {
          if (pgErrorCode(error) === '23505') {
            throw new HttpError(
              409,
              'email_in_use',
              'This email is linked to a different sign-in. Contact support to merge them.',
            );
          }
          throw error;
        }
        await tx.execute(sql`select app.accept_invitations(${user.id}::uuid, ${user.email})`);
        const linked = await tx.execute(
          sql`select app.link_platform_staff(${user.id}::uuid, ${user.email}) as role`,
        );
        const platformRole = (linked.rows[0]?.role as PlatformRole | null | undefined) ?? null;

        const rows = await tx
          .select({
            organisationId: memberships.organisationId,
            organisationName: organisations.name,
            role: memberships.role,
          })
          .from(memberships)
          .innerJoin(organisations, eq(organisations.id, memberships.organisationId))
          .where(eq(memberships.userId, user.id))
          .orderBy(asc(organisations.name));

        const grants = canPlatform(platformRole, 'support.open')
          ? (await tx.execute(sql`select * from app.my_support_grants()`)).rows
          : [];

        const [profile] = await tx.select().from(appUsers).where(eq(appUsers.id, user.id));
        return {
          user: { id: user.id, email: user.email, fullName: profile?.fullName ?? null },
          memberships: rows,
          platformRole,
          supportAccess: grants.map((g) => ({
            grantId: String(g.id),
            organisationId: String(g.organisation_id),
            organisationName: String(g.organisation_name),
            expiresAt: isoOrNull(g.expires_at) ?? '',
          })),
        };
      });
    });

  // A person's own name, as the team sees it.
  app
    .withTypeProvider<ZodTypeProvider>()
    .patch(
      '/v1/me',
      { schema: { body: MeUpdateSchema, response: { 200: z.object({ fullName: z.string() }) } } },
      async (req) => {
        const user = await deps.scope.user(req);
        return deps.db.withUser(user.id, async (tx) => {
          await tx.update(appUsers).set({ fullName: req.body.fullName }).where(eq(appUsers.id, user.id));
          return { fullName: req.body.fullName };
        });
      },
    );
}
