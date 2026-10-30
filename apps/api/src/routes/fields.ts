import { customFields, properties, propertyFieldValues, type Tx } from '@v01/db';
import type { SecretBox } from '@v01/integrations';
import {
  type CustomField,
  CustomFieldCreateSchema,
  type CustomFieldList,
  CustomFieldListSchema,
  CustomFieldSchema,
  CustomFieldUpdateSchema,
  can,
  FIELDS_MAX,
  isWebAddress,
  type PropertyField,
  PropertyFieldsUpdateSchema,
  type WorkspaceRole,
} from '@v01/shared';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { pgConstraint, type RequestScope } from '../context.ts';
import { HttpError } from '../errors.ts';

const FieldParams = z.object({ id: z.uuid() });
const PropertyParams = z.object({ id: z.uuid() });
const PropertyFieldsSchema = z.object({
  fields: z.array(CustomFieldSchema.extend({ value: z.string().nullable(), hidden: z.boolean() })),
});

type FieldRow = typeof customFields.$inferSelect;

const toField = (row: FieldRow): CustomField => ({
  id: row.id,
  name: row.name,
  kind: row.kind,
  position: row.position,
  guestVisible: row.guestVisible,
  crewVisible: row.crewVisible,
});

/** The workspace's fields in order. */
export async function listFields(tx: Tx): Promise<CustomField[]> {
  const rows = await tx
    .select()
    .from(customFields)
    .orderBy(asc(customFields.position), asc(customFields.createdAt));
  return rows.map(toField);
}

/**
 * Every field with its value on one property. Secrets are opened for roles that may see them; for
 * the others, and when the API has no key, a stored secret comes back hidden.
 */
export async function fieldsOf(
  tx: Tx,
  propertyId: string,
  role: WorkspaceRole,
  box: SecretBox | undefined,
): Promise<PropertyField[]> {
  const reveal = can(role, 'secrets.read') && box !== undefined;
  const rows = await tx
    .select({
      id: customFields.id,
      name: customFields.name,
      kind: customFields.kind,
      position: customFields.position,
      guestVisible: customFields.guestVisible,
      crewVisible: customFields.crewVisible,
      value: propertyFieldValues.value,
      secret: propertyFieldValues.secret,
    })
    .from(customFields)
    .leftJoin(
      propertyFieldValues,
      and(eq(propertyFieldValues.fieldId, customFields.id), eq(propertyFieldValues.propertyId, propertyId)),
    )
    .orderBy(asc(customFields.position), asc(customFields.createdAt));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    position: r.position,
    guestVisible: r.guestVisible,
    crewVisible: r.crewVisible,
    value: r.kind === 'secret' ? (reveal && r.secret ? box.open(r.secret) : null) : r.value,
    hidden: r.kind === 'secret' && r.secret !== null && !reveal,
  }));
}

/**
 * Custom fields: the team's own details on every property. Admins define them for the workspace;
 * anyone who edits properties fills them in. Secrets are encrypted by the database and shown only
 * to roles with `secrets.read`: never to accounts, and never to V-01 support.
 */
export function fieldRoutes(app: FastifyInstance, deps: { scope: RequestScope; box: SecretBox | undefined }) {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get('/v1/custom-fields', { schema: { response: { 200: CustomFieldListSchema } } }, async (req) =>
    deps.scope.inOrg(
      req,
      'properties.read',
      async (tx): Promise<CustomFieldList> => ({ fields: await listFields(tx) }),
    ),
  );

  typed.post(
    '/v1/custom-fields',
    { schema: { body: CustomFieldCreateSchema, response: { 201: CustomFieldSchema } } },
    async (req, reply) =>
      deps.scope.inOrg(req, 'fields.manage', async (tx, ctx) => {
        const [count] = await tx.select({ n: sql<number>`count(*)::int` }).from(customFields);
        if ((count?.n ?? 0) >= FIELDS_MAX) {
          throw new HttpError(409, 'too_many_fields', `A workspace can have ${FIELDS_MAX} custom fields.`);
        }
        try {
          const [row] = await tx
            .insert(customFields)
            .values({
              organisationId: ctx.orgId,
              name: req.body.name,
              kind: req.body.kind,
              guestVisible: req.body.guestVisible ?? false,
              crewVisible: req.body.crewVisible ?? false,
              position: sql`(select coalesce(max(position), -1) + 1 from ${customFields})`,
            })
            .returning();
          if (!row) throw new Error('insert returned nothing');
          reply.code(201);
          return toField(row);
        } catch (error) {
          if (pgConstraint(error) === 'custom_fields_org_name_key') {
            throw new HttpError(409, 'field_exists', `There is already a field called "${req.body.name}".`);
          }
          throw error;
        }
      }),
  );

  // Moving a field to a position shifts the others, so positions stay 0, 1, 2… in order.
  typed.patch(
    '/v1/custom-fields/:id',
    { schema: { params: FieldParams, body: CustomFieldUpdateSchema, response: { 200: CustomFieldSchema } } },
    async (req) =>
      deps.scope.inOrg(req, 'fields.manage', async (tx) => {
        const all = await tx
          .select()
          .from(customFields)
          .orderBy(asc(customFields.position), asc(customFields.createdAt));
        const moving = all.find((f) => f.id === req.params.id);
        if (!moving)
          throw new HttpError(404, 'field_not_found', 'That field does not exist in this workspace.');
        if (req.body.name !== undefined) {
          try {
            await tx.update(customFields).set({ name: req.body.name }).where(eq(customFields.id, moving.id));
          } catch (error) {
            if (pgConstraint(error) === 'custom_fields_org_name_key') {
              throw new HttpError(409, 'field_exists', `There is already a field called "${req.body.name}".`);
            }
            throw error;
          }
          moving.name = req.body.name;
        }
        if (req.body.guestVisible !== undefined) {
          await tx
            .update(customFields)
            .set({ guestVisible: req.body.guestVisible })
            .where(eq(customFields.id, moving.id));
          moving.guestVisible = req.body.guestVisible;
        }
        if (req.body.crewVisible !== undefined) {
          await tx
            .update(customFields)
            .set({ crewVisible: req.body.crewVisible })
            .where(eq(customFields.id, moving.id));
          moving.crewVisible = req.body.crewVisible;
        }
        if (req.body.position !== undefined) {
          const rest = all.filter((f) => f.id !== moving.id);
          rest.splice(Math.min(req.body.position, rest.length), 0, moving);
          for (const [index, field] of rest.entries()) {
            if (field.position !== index) {
              await tx.update(customFields).set({ position: index }).where(eq(customFields.id, field.id));
              field.position = index;
            }
          }
        }
        return toField(moving);
      }),
  );

  // Deleting a field removes its value from every property, secrets included. The audit log keeps them.
  typed.delete(
    '/v1/custom-fields/:id',
    { schema: { params: FieldParams, response: { 200: z.object({ deleted: z.literal(true) }) } } },
    async (req) =>
      deps.scope.inOrg(req, 'fields.manage', async (tx) => {
        const rows = await tx
          .delete(customFields)
          .where(eq(customFields.id, req.params.id))
          .returning({ id: customFields.id });
        if (!rows.length)
          throw new HttpError(404, 'field_not_found', 'That field does not exist in this workspace.');
        return { deleted: true as const };
      }),
  );

  typed.put(
    '/v1/properties/:id/fields',
    {
      schema: {
        params: PropertyParams,
        body: PropertyFieldsUpdateSchema,
        response: { 200: PropertyFieldsSchema },
      },
    },
    async (req) =>
      deps.scope.inOrg(req, 'properties.write', async (tx, ctx) => {
        const [property] = await tx
          .select({ id: properties.id })
          .from(properties)
          .where(and(eq(properties.id, req.params.id), isNull(properties.archivedAt)));
        if (!property)
          throw new HttpError(404, 'property_not_found', 'That property does not exist in this workspace.');

        const ids = Object.keys(req.body.values);
        const fields = await tx.select().from(customFields).where(inArray(customFields.id, ids));
        const byId = new Map(fields.map((f) => [f.id, f]));
        for (const id of ids) {
          const field = byId.get(id);
          if (!field)
            throw new HttpError(
              404,
              'field_not_found',
              'One of those fields does not exist in this workspace.',
            );
          const value = req.body.values[id] ?? '';
          if (value && field.kind === 'link' && !isWebAddress(value)) {
            throw new HttpError(
              422,
              'not_a_link',
              `"${field.name}" needs a web address starting with https://.`,
            );
          }
          if (value && field.kind === 'secret' && deps.box === undefined) {
            throw new HttpError(
              503,
              'secrets_unavailable',
              'Secrets can be saved once the API has its encryption key.',
            );
          }
          if (value && field.kind === 'secret' && !can(ctx.role, 'secrets.read')) {
            throw new HttpError(403, 'not_allowed', 'Your role does not allow setting secrets.');
          }
        }

        for (const id of ids) {
          const field = byId.get(id);
          if (!field) continue;
          const value = req.body.values[id] ?? '';
          if (!value) {
            await tx
              .delete(propertyFieldValues)
              .where(
                and(eq(propertyFieldValues.propertyId, property.id), eq(propertyFieldValues.fieldId, id)),
              );
            continue;
          }
          const stored =
            field.kind === 'secret' && deps.box
              ? { value: null, secret: deps.box.seal(value) }
              : { value, secret: null };
          await tx
            .insert(propertyFieldValues)
            .values({ organisationId: ctx.orgId, propertyId: property.id, fieldId: id, ...stored })
            .onConflictDoUpdate({
              target: [propertyFieldValues.propertyId, propertyFieldValues.fieldId],
              set: stored,
            });
        }
        return { fields: await fieldsOf(tx, property.id, ctx.role, deps.box) };
      }),
  );
}
