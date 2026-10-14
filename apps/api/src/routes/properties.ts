import { properties } from '@v01/db';
import { type Property, PropertyCreateSchema, PropertyListSchema, PropertySchema } from '@v01/shared';
import { asc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { pgErrorCode, type RequestScope, toIso } from '../context.ts';
import { HttpError } from '../errors.ts';

type PropertyRow = typeof properties.$inferSelect;

function toProperty(row: PropertyRow): Property {
  return {
    id: row.id,
    name: row.name,
    internalCode: row.internalCode,
    addressLine1: row.addressLine1,
    city: row.city,
    postcode: row.postcode,
    countryCode: row.countryCode,
    area: row.area,
    bedrooms: row.bedrooms,
    maxGuests: row.maxGuests,
    checkInTime: row.checkInTime.slice(0, 5),
    checkOutTime: row.checkOutTime.slice(0, 5),
    managedBy: row.managedBy,
    priceOwner: row.priceOwner,
    minPriceMinor: row.minPriceMinor,
    maxPriceMinor: row.maxPriceMinor,
    createdAt: toIso(row.createdAt),
  };
}

export function propertyRoutes(app: FastifyInstance, deps: { scope: RequestScope }) {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get('/v1/properties', { schema: { response: { 200: PropertyListSchema } } }, async (req) =>
    deps.scope.inOrg(req, 'properties.read', async (tx) => {
      // No operator filter needed here: row-level security already limits rows to this operator.
      const rows = await tx
        .select()
        .from(properties)
        .where(isNull(properties.archivedAt))
        .orderBy(asc(properties.name));
      return { properties: rows.map(toProperty) };
    }),
  );

  typed.get(
    '/v1/properties/:id',
    { schema: { params: z.object({ id: z.uuid() }), response: { 200: PropertySchema } } },
    async (req) =>
      deps.scope.inOrg(req, 'properties.read', async (tx) => {
        const [row] = await tx.select().from(properties).where(eq(properties.id, req.params.id));
        if (!row)
          throw new HttpError(404, 'property_not_found', 'That property does not exist in this workspace.');
        return toProperty(row);
      }),
  );

  typed.post(
    '/v1/properties',
    { schema: { body: PropertyCreateSchema, response: { 201: PropertySchema } } },
    async (req, reply) =>
      deps.scope.inOrg(req, 'properties.write', async (tx, ctx) => {
        const input = req.body;
        const [row] = await tx
          .insert(properties)
          .values({
            organisationId: ctx.orgId,
            name: input.name,
            internalCode: input.internalCode ?? null,
            addressLine1: input.addressLine1 ?? null,
            city: input.city ?? null,
            postcode: input.postcode ?? null,
            countryCode: input.countryCode,
            area: input.area ?? null,
            bedrooms: input.bedrooms ?? null,
            maxGuests: input.maxGuests,
            ...(input.checkInTime ? { checkInTime: input.checkInTime } : {}),
            ...(input.checkOutTime ? { checkOutTime: input.checkOutTime } : {}),
            minPriceMinor: input.minPriceMinor ?? null,
            maxPriceMinor: input.maxPriceMinor ?? null,
          })
          .returning()
          .catch((error: unknown) => {
            if (pgErrorCode(error) === '23505') {
              throw new HttpError(409, 'code_in_use', `Another property already uses ${input.internalCode}.`);
            }
            throw error;
          });
        if (!row) throw new Error('Insert returned no row');
        reply.code(201);
        return toProperty(row);
      }),
  );
}
