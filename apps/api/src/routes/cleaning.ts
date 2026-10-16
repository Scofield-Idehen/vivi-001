import { appUsers, properties } from '@v01/db';
import { type CleaningState, CleaningStateSchema, CleaningUpdateSchema } from '@v01/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { type RequestScope, toIso } from '../context.ts';
import { HttpError } from '../errors.ts';

const PropertyParams = z.object({ id: z.uuid() });

/**
 * Marking a property clean or dirty. A guest's check-out makes it dirty by itself (the worker); the
 * team, field staff included, marks it clean once it is ready, or dirty again if it isn't.
 */
export function cleaningRoutes(app: FastifyInstance, deps: { scope: RequestScope }) {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.put(
    '/v1/properties/:id/cleaning',
    {
      schema: { params: PropertyParams, body: CleaningUpdateSchema, response: { 200: CleaningStateSchema } },
    },
    async (req) =>
      deps.scope.inOrg(req, 'cleaning.write', async (tx, ctx): Promise<CleaningState> => {
        // Row-level security limits this to the operator in scope.
        const [row] = await tx
          .update(properties)
          .set({
            cleaningStatus: req.body.status,
            cleaningChangedAt: sql`now()`,
            cleaningChangedBy: ctx.userId,
          })
          .where(and(eq(properties.id, req.params.id), isNull(properties.archivedAt)))
          .returning({ status: properties.cleaningStatus, changedAt: properties.cleaningChangedAt });
        if (!row) {
          throw new HttpError(404, 'property_not_found', 'That property does not exist in this workspace.');
        }
        const [who] = await tx
          .select({ name: sql<string>`coalesce(${appUsers.fullName}, ${appUsers.email})` })
          .from(appUsers)
          .where(eq(appUsers.id, ctx.userId));
        return {
          status: row.status,
          changedAt: row.changedAt ? toIso(row.changedAt) : null,
          changedBy: who?.name ?? null,
        };
      }),
  );
}
