import { appUsers, channexMappings, channexSetups, properties, type Tx } from '@v01/db';
import { type ChannexState, ChannexStateSchema } from '@v01/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { type RequestScope, toIso } from '../context.ts';
import { HttpError } from '../errors.ts';

const PropertyParams = z.object({ id: z.uuid() });

/** Where a property stands with Channex, from its mapping and its latest request. */
export async function channexStateOf(tx: Tx, propertyId: string): Promise<ChannexState> {
  const [mapping] = await tx
    .select({ channexPropertyId: channexMappings.channexPropertyId, createdAt: channexMappings.createdAt })
    .from(channexMappings)
    .where(eq(channexMappings.propertyId, propertyId));
  const [setup] = await tx
    .select({
      status: channexSetups.status,
      attempts: channexSetups.attempts,
      lastError: channexSetups.lastError,
      createdAt: channexSetups.createdAt,
      finishedAt: channexSetups.finishedAt,
      requestedBy: sql<string | null>`coalesce(${appUsers.fullName}, ${appUsers.email})`,
    })
    .from(channexSetups)
    .leftJoin(appUsers, eq(appUsers.id, channexSetups.requestedBy))
    .where(eq(channexSetups.propertyId, propertyId));
  const base = {
    channexPropertyId: mapping?.channexPropertyId ?? null,
    requestedBy: setup?.requestedBy ?? null,
    requestedAt: setup ? toIso(setup.createdAt) : null,
    finishedAt: setup?.finishedAt ? toIso(setup.finishedAt) : mapping ? toIso(mapping.createdAt) : null,
    error: setup?.lastError ?? null,
    attempts: setup?.attempts ?? 0,
  };
  if (mapping) return { ...base, status: 'connected', error: null };
  if (!setup) return { ...base, status: 'not_connected' };
  return { ...base, status: setup.status === 'failed' ? 'failed' : 'connecting' };
}

/**
 * Connecting a property to the channel manager (integration step 3). The request is queued here;
 * the worker makes the property in Channex and stores its ids. Asking again after a failure starts
 * the attempts over.
 */
export function channexRoutes(app: FastifyInstance, deps: { scope: RequestScope }) {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.post(
    '/v1/properties/:id/channex',
    { schema: { params: PropertyParams, response: { 200: ChannexStateSchema } } },
    async (req) =>
      deps.scope.inOrg(req, 'channels.manage', async (tx, ctx) => {
        const [property] = await tx
          .select({ id: properties.id })
          .from(properties)
          .where(and(eq(properties.id, req.params.id), isNull(properties.archivedAt)));
        if (!property)
          throw new HttpError(404, 'property_not_found', 'That property does not exist in this workspace.');
        const state = await channexStateOf(tx, property.id);
        if (state.status === 'connected') {
          throw new HttpError(409, 'already_connected', 'This property is already connected to Channex.');
        }
        if (state.status === 'connecting') return state;
        await tx
          .insert(channexSetups)
          .values({ organisationId: ctx.orgId, propertyId: property.id, requestedBy: ctx.userId })
          .onConflictDoUpdate({
            target: channexSetups.propertyId,
            set: {
              status: 'queued',
              attempts: 0,
              nextAttemptAt: sql`now()`,
              lockedAt: null,
              lastError: null,
              finishedAt: null,
              requestedBy: ctx.userId,
              createdAt: sql`now()`,
            },
          });
        return channexStateOf(tx, property.id);
      }),
  );
}
