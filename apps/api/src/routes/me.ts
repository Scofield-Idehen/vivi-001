import type { ApiDatabase } from '@v01/db';
import { appUsers, memberships, organisations } from '@v01/db';
import { MeSchema } from '@v01/shared';
import { asc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { pgErrorCode, type RequestScope } from '../context.ts';
import { HttpError } from '../errors.ts';

/**
 * The web app calls this first after sign-in. It records the person, turns any
 * invitations for their email into memberships, and lists the operators they can open.
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
        const [profile] = await tx.select().from(appUsers).where(eq(appUsers.id, user.id));
        return {
          user: { id: user.id, email: user.email, fullName: profile?.fullName ?? null },
          memberships: rows,
        };
      });
    });
}
