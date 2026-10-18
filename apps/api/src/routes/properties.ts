import { properties, propertyAmenities, propertyPhotos, propertyRooms, type Tx } from '@v01/db';
import {
  AmenitiesUpdateSchema,
  AmenityCodesSchema,
  countBeds,
  PHOTO_MAX_COUNT,
  type Photo,
  PhotoOrderSchema,
  PhotoRegisterSchema,
  PhotoUpdateSchema,
  PhotoUploadRequestSchema,
  PhotoUploadTicketSchema,
  PROPERTY_TYPES,
  type Property,
  PropertyCreateSchema,
  type PropertyDetail,
  PropertyDetailSchema,
  PropertyListSchema,
  type PropertyType,
  PropertyUpdateSchema,
  type Room,
  RoomsUpdateSchema,
} from '@v01/shared';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { pgConstraint, pgErrorCode, type RequestScope, toIso } from '../context.ts';
import { HttpError } from '../errors.ts';
import { newPhotoPath, type PhotoStore, photoPathBelongsTo } from '../photos.ts';
import { channexStateOf } from './channex.ts';

type PropertyRow = typeof properties.$inferSelect;
type RoomRow = typeof propertyRooms.$inferSelect;
type PhotoRow = typeof propertyPhotos.$inferSelect;

/** Property types are stored as text so the list can grow; anything unknown reads as "other". */
function propertyType(value: string | null): PropertyType | null {
  if (value === null) return null;
  return (PROPERTY_TYPES as readonly string[]).includes(value) ? (value as PropertyType) : 'other';
}

const clock = (value: string | null): string | null => (value ? value.slice(0, 5) : null);

function toProperty(row: PropertyRow, photos: { cover: string | null; count: number }): Property {
  return {
    id: row.id,
    name: row.name,
    internalCode: row.internalCode,
    addressLine1: row.addressLine1,
    city: row.city,
    postcode: row.postcode,
    countryCode: row.countryCode,
    area: row.area,
    propertyType: propertyType(row.propertyType),
    spaceType: row.spaceType,
    bedrooms: row.bedrooms,
    beds: row.beds,
    bathrooms: row.bathrooms,
    maxGuests: row.maxGuests,
    checkInTime: row.checkInTime.slice(0, 5),
    checkOutTime: row.checkOutTime.slice(0, 5),
    managedBy: row.managedBy,
    priceOwner: row.priceOwner,
    minPriceMinor: row.minPriceMinor,
    maxPriceMinor: row.maxPriceMinor,
    coverPhotoUrl: photos.cover,
    photoCount: photos.count,
    tags: row.tags,
    createdAt: toIso(row.createdAt),
  };
}

function toRoom(row: RoomRow): Room {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    beds: row.beds,
    privateBathroom: row.privateBathroom,
  };
}

function toPhoto(row: PhotoRow): Photo {
  return {
    id: row.id,
    url: row.url,
    caption: row.caption,
    position: row.position,
    roomId: row.roomId,
    width: row.width,
    height: row.height,
  };
}

const NOT_FOUND = () =>
  new HttpError(404, 'property_not_found', 'That property does not exist in this workspace.');

async function findProperty(tx: Tx, id: string): Promise<PropertyRow> {
  // Row-level security already limits this to the operator in scope.
  const [row] = await tx
    .select()
    .from(properties)
    .where(and(eq(properties.id, id), isNull(properties.archivedAt)));
  if (!row) throw NOT_FOUND();
  return row;
}

async function loadDetail(tx: Tx, id: string): Promise<PropertyDetail> {
  const row = await findProperty(tx, id);
  const rooms = await tx
    .select()
    .from(propertyRooms)
    .where(eq(propertyRooms.propertyId, id))
    .orderBy(asc(propertyRooms.position));
  const amenities = await tx
    .select({ code: propertyAmenities.code })
    .from(propertyAmenities)
    .where(eq(propertyAmenities.propertyId, id))
    .orderBy(asc(propertyAmenities.code));
  const photos = await tx
    .select()
    .from(propertyPhotos)
    .where(eq(propertyPhotos.propertyId, id))
    .orderBy(asc(propertyPhotos.position), asc(propertyPhotos.createdAt));
  return {
    ...toProperty(row, { cover: photos[0]?.url ?? null, count: photos.length }),
    addressLine2: row.addressLine2,
    title: row.title,
    summary: row.summary,
    theSpace: row.theSpace,
    guestAccess: row.guestAccess,
    neighbourhood: row.neighbourhood,
    gettingAround: row.gettingAround,
    otherNotes: row.otherNotes,
    checkInMethod: row.checkInMethod,
    petsAllowed: row.petsAllowed,
    smokingAllowed: row.smokingAllowed,
    eventsAllowed: row.eventsAllowed,
    childrenAllowed: row.childrenAllowed,
    quietHoursStart: clock(row.quietHoursStart),
    quietHoursEnd: clock(row.quietHoursEnd),
    houseRules: row.houseRules,
    minNights: row.minNights,
    maxNights: row.maxNights,
    instantBook: row.instantBook,
    advanceNoticeHours: row.advanceNoticeHours,
    bookingWindowDays: row.bookingWindowDays,
    preparationDays: row.preparationDays,
    cancellationPolicy: row.cancellationPolicy,
    basePriceMinor: row.basePriceMinor,
    weekendPriceMinor: row.weekendPriceMinor,
    cleaningFeeMinor: row.cleaningFeeMinor,
    extraGuestFeeMinor: row.extraGuestFeeMinor,
    extraGuestFrom: row.extraGuestFrom,
    securityDepositMinor: row.securityDepositMinor,
    licenceNumber: row.licenceNumber,
    rooms: rooms.map(toRoom),
    amenities: amenities.map((a) => a.code),
    photos: photos.map(toPhoto),
    channex: await channexStateOf(tx, id),
    updatedAt: toIso(row.updatedAt),
  };
}

/** Database rules turned into messages a person can act on. */
const CONSTRAINT_MESSAGES: Record<string, string> = {
  properties_price_limits: 'The lowest price is above the highest.',
  properties_stay_lengths: 'The shortest stay is longer than the longest.',
  properties_quiet_hours: 'Give quiet hours a start and an end.',
  properties_title_length: 'Keep the title to 50 characters.',
  properties_summary_length: 'Keep the description to 500 characters.',
};

function explain(error: unknown, code?: string | null): never {
  const pg = pgErrorCode(error);
  if (pg === '23505' && pgConstraint(error) === 'properties_org_code_key') {
    throw new HttpError(409, 'code_in_use', `Another property already uses ${code ?? 'that code'}.`);
  }
  const message = CONSTRAINT_MESSAGES[pgConstraint(error) ?? ''];
  if (pg === '23514' && message) throw new HttpError(400, 'invalid_request', message);
  throw error;
}

/** Leaves out what wasn't sent; empty text becomes null, so clearing a field clears it. */
function cleaned<T extends Record<string, unknown>>(input: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    out[key] = typeof value === 'string' && value.trim() === '' ? null : value;
  }
  return out as Partial<T>;
}

async function setAmenities(tx: Tx, orgId: string, propertyId: string, codes: string[]): Promise<void> {
  const current = await tx
    .select({ code: propertyAmenities.code })
    .from(propertyAmenities)
    .where(eq(propertyAmenities.propertyId, propertyId));
  const wanted = new Set(codes);
  const gone = current.map((a) => a.code).filter((code) => !wanted.has(code));
  if (gone.length) {
    await tx
      .delete(propertyAmenities)
      .where(and(eq(propertyAmenities.propertyId, propertyId), inArray(propertyAmenities.code, gone)));
  }
  if (codes.length) {
    await tx
      .insert(propertyAmenities)
      .values(codes.map((code) => ({ organisationId: orgId, propertyId, code })))
      .onConflictDoNothing();
  }
}

/** Positions run 0, 1, 2… in the given order; 0 is the cover. */
async function renumberPhotos(tx: Tx, propertyId: string, orderedIds: string[]): Promise<void> {
  for (const [position, id] of orderedIds.entries()) {
    await tx
      .update(propertyPhotos)
      .set({ position })
      .where(and(eq(propertyPhotos.id, id), eq(propertyPhotos.propertyId, propertyId)));
  }
}

const PropertyParams = z.object({ id: z.uuid() });
const PhotoParams = z.object({ id: z.uuid(), photoId: z.uuid() });

export function propertyRoutes(app: FastifyInstance, deps: { scope: RequestScope; photos: PhotoStore }) {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get('/v1/properties', { schema: { response: { 200: PropertyListSchema } } }, async (req) =>
    deps.scope.inOrg(req, 'properties.read', async (tx) => {
      // No operator filter needed here: row-level security already limits rows to this operator.
      const rows = await tx
        .select()
        .from(properties)
        .where(isNull(properties.archivedAt))
        .orderBy(asc(properties.name));
      const ids = rows.map((r) => r.id);
      const covers = ids.length
        ? await tx
            .select({
              propertyId: propertyPhotos.propertyId,
              count: sql<number>`count(*)::int`,
              cover: sql<string>`(array_agg(${propertyPhotos.url} order by ${propertyPhotos.position}, ${propertyPhotos.createdAt}))[1]`,
            })
            .from(propertyPhotos)
            .where(inArray(propertyPhotos.propertyId, ids))
            .groupBy(propertyPhotos.propertyId)
        : [];
      const byProperty = new Map(covers.map((c) => [c.propertyId, c]));
      return {
        properties: rows.map((row) => {
          const photos = byProperty.get(row.id);
          return toProperty(row, { cover: photos?.cover ?? null, count: photos?.count ?? 0 });
        }),
      };
    }),
  );

  typed.get(
    '/v1/properties/:id',
    { schema: { params: PropertyParams, response: { 200: PropertyDetailSchema } } },
    async (req) => deps.scope.inOrg(req, 'properties.read', (tx) => loadDetail(tx, req.params.id)),
  );

  typed.post(
    '/v1/properties',
    { schema: { body: PropertyCreateSchema, response: { 201: PropertyDetailSchema } } },
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
            propertyType: input.propertyType ?? null,
            ...(input.spaceType ? { spaceType: input.spaceType } : {}),
            bedrooms: input.bedrooms ?? null,
            beds: input.beds ?? null,
            bathrooms: input.bathrooms ?? null,
            maxGuests: input.maxGuests,
            ...(input.checkInTime ? { checkInTime: input.checkInTime } : {}),
            ...(input.checkOutTime ? { checkOutTime: input.checkOutTime } : {}),
            ...(input.priceOwner ? { priceOwner: input.priceOwner } : {}),
            minPriceMinor: input.minPriceMinor ?? null,
            maxPriceMinor: input.maxPriceMinor ?? null,
            basePriceMinor: input.basePriceMinor ?? null,
            cleaningFeeMinor: input.cleaningFeeMinor ?? null,
            title: input.title ?? null,
            summary: input.summary ?? null,
            // Added here, so no channel listings are connected yet. V-01 sends nothing for it until
            // the move-over step, which the database keeps out of the API's reach.
            managedBy: 'none',
          })
          .returning()
          .catch((error: unknown) => explain(error, input.internalCode));
        if (!row) throw new Error('Insert returned no row');
        if (input.amenities?.length) await setAmenities(tx, ctx.orgId, row.id, input.amenities);
        reply.code(201);
        return loadDetail(tx, row.id);
      }),
  );

  typed.patch(
    '/v1/properties/:id',
    {
      schema: { params: PropertyParams, body: PropertyUpdateSchema, response: { 200: PropertyDetailSchema } },
    },
    async (req) =>
      deps.scope.inOrg(req, 'properties.write', async (tx) => {
        await findProperty(tx, req.params.id);
        const changes = cleaned(req.body);
        if (changes.name === null) throw new HttpError(400, 'invalid_request', 'A property needs a name.');
        await tx
          .update(properties)
          .set(changes as Partial<typeof properties.$inferInsert>)
          .where(eq(properties.id, req.params.id))
          .catch((error: unknown) => explain(error, req.body.internalCode));
        return loadDetail(tx, req.params.id);
      }),
  );

  typed.put(
    '/v1/properties/:id/rooms',
    { schema: { params: PropertyParams, body: RoomsUpdateSchema, response: { 200: PropertyDetailSchema } } },
    async (req) =>
      deps.scope.inOrg(req, 'properties.write', async (tx, ctx) => {
        const id = req.params.id;
        await findProperty(tx, id);
        const existing = await tx
          .select({ id: propertyRooms.id })
          .from(propertyRooms)
          .where(eq(propertyRooms.propertyId, id));
        const known = new Set(existing.map((r) => r.id));
        const keep = new Set<string>();
        for (const [position, room] of req.body.rooms.entries()) {
          const values = {
            position,
            kind: room.kind,
            name: room.name?.trim() || null,
            beds: room.beds,
            privateBathroom: room.privateBathroom,
          };
          if (room.id && known.has(room.id) && !keep.has(room.id)) {
            keep.add(room.id);
            await tx.update(propertyRooms).set(values).where(eq(propertyRooms.id, room.id));
          } else {
            await tx.insert(propertyRooms).values({ ...values, organisationId: ctx.orgId, propertyId: id });
          }
        }
        const gone = [...known].filter((roomId) => !keep.has(roomId));
        if (gone.length) await tx.delete(propertyRooms).where(inArray(propertyRooms.id, gone));
        // The counts the channels show follow the rooms, once there are rooms to count.
        if (req.body.rooms.length > 0) {
          await tx
            .update(properties)
            .set({
              bedrooms: req.body.rooms.filter((r) => r.kind === 'bedroom').length,
              beds: countBeds(req.body.rooms),
            })
            .where(eq(properties.id, id));
        }
        return loadDetail(tx, id);
      }),
  );

  typed.put(
    '/v1/properties/:id/amenities',
    {
      schema: {
        params: PropertyParams,
        body: AmenitiesUpdateSchema,
        response: { 200: PropertyDetailSchema },
      },
    },
    async (req) =>
      deps.scope.inOrg(req, 'properties.write', async (tx, ctx) => {
        await findProperty(tx, req.params.id);
        const codes = AmenityCodesSchema.safeParse(req.body.amenities);
        if (!codes.success) {
          throw new HttpError(400, 'invalid_request', 'One of those amenities is not on the list.');
        }
        await setAmenities(tx, ctx.orgId, req.params.id, codes.data);
        return loadDetail(tx, req.params.id);
      }),
  );

  // Photos ---------------------------------------------------------------------------------------

  typed.post(
    '/v1/properties/:id/photos/uploads',
    {
      schema: {
        params: PropertyParams,
        body: PhotoUploadRequestSchema,
        response: { 200: PhotoUploadTicketSchema },
      },
    },
    async (req) =>
      deps.scope.inOrg(req, 'properties.write', async (tx, ctx) => {
        if (!deps.photos.ready) {
          throw new HttpError(
            503,
            'photo_storage_not_ready',
            "Photo storage isn't set up yet, so photos can't be added.",
          );
        }
        await findProperty(tx, req.params.id);
        const [row] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(propertyPhotos)
          .where(eq(propertyPhotos.propertyId, req.params.id));
        if ((row?.count ?? 0) >= PHOTO_MAX_COUNT) {
          throw new HttpError(409, 'too_many_photos', `A property can have up to ${PHOTO_MAX_COUNT} photos.`);
        }
        return deps.photos.ticket(
          newPhotoPath(ctx.orgId, req.params.id, req.body.contentType),
          req.body.contentType,
        );
      }),
  );

  typed.post(
    '/v1/properties/:id/photos',
    {
      schema: { params: PropertyParams, body: PhotoRegisterSchema, response: { 201: PropertyDetailSchema } },
    },
    async (req, reply) =>
      deps.scope.inOrg(req, 'properties.write', async (tx, ctx) => {
        const id = req.params.id;
        await findProperty(tx, id);
        const { path } = req.body;
        if (!photoPathBelongsTo(path, ctx.orgId, id)) {
          throw new HttpError(400, 'invalid_request', 'That photo was not uploaded for this property.');
        }
        if (!(await deps.photos.exists(path))) {
          throw new HttpError(409, 'photo_not_uploaded', "The photo hasn't finished uploading. Try again.");
        }
        const [last] = await tx
          .select({ next: sql<number>`coalesce(max(${propertyPhotos.position}) + 1, 0)::int` })
          .from(propertyPhotos)
          .where(eq(propertyPhotos.propertyId, id));
        await tx
          .insert(propertyPhotos)
          .values({
            organisationId: ctx.orgId,
            propertyId: id,
            storagePath: path,
            url: deps.photos.publicUrl(path),
            position: last?.next ?? 0,
            caption: req.body.caption?.trim() || null,
            width: req.body.width,
            height: req.body.height,
          })
          .onConflictDoNothing({ target: propertyPhotos.storagePath });
        reply.code(201);
        return loadDetail(tx, id);
      }),
  );

  typed.patch(
    '/v1/properties/:id/photos/:photoId',
    { schema: { params: PhotoParams, body: PhotoUpdateSchema, response: { 200: PropertyDetailSchema } } },
    async (req) =>
      deps.scope.inOrg(req, 'properties.write', async (tx) => {
        const { id, photoId } = req.params;
        await findProperty(tx, id);
        if (req.body.roomId) {
          const [room] = await tx
            .select({ id: propertyRooms.id })
            .from(propertyRooms)
            .where(and(eq(propertyRooms.id, req.body.roomId), eq(propertyRooms.propertyId, id)));
          if (!room) throw new HttpError(400, 'invalid_request', 'That room is not in this property.');
        }
        const updated = await tx
          .update(propertyPhotos)
          .set(cleaned({ caption: req.body.caption, roomId: req.body.roomId }))
          .where(and(eq(propertyPhotos.id, photoId), eq(propertyPhotos.propertyId, id)))
          .returning({ id: propertyPhotos.id });
        if (updated.length === 0) {
          throw new HttpError(404, 'photo_not_found', 'That photo is not on this property.');
        }
        return loadDetail(tx, id);
      }),
  );

  typed.put(
    '/v1/properties/:id/photos/order',
    { schema: { params: PropertyParams, body: PhotoOrderSchema, response: { 200: PropertyDetailSchema } } },
    async (req) =>
      deps.scope.inOrg(req, 'properties.write', async (tx) => {
        const id = req.params.id;
        await findProperty(tx, id);
        const current = await tx
          .select({ id: propertyPhotos.id })
          .from(propertyPhotos)
          .where(eq(propertyPhotos.propertyId, id));
        const wanted = req.body.photoIds;
        const same =
          wanted.length === current.length &&
          new Set(wanted).size === wanted.length &&
          current.every((p) => wanted.includes(p.id));
        if (!same) {
          throw new HttpError(
            409,
            'photos_changed',
            'The photos changed while you were ordering them. Try again.',
          );
        }
        await renumberPhotos(tx, id, wanted);
        return loadDetail(tx, id);
      }),
  );

  typed.delete(
    '/v1/properties/:id/photos/:photoId',
    { schema: { params: PhotoParams, response: { 200: PropertyDetailSchema } } },
    async (req) => {
      const { id, photoId } = req.params;
      let removedPath: string | null = null;
      const detail = await deps.scope.inOrg(req, 'properties.write', async (tx) => {
        await findProperty(tx, id);
        const [removed] = await tx
          .delete(propertyPhotos)
          .where(and(eq(propertyPhotos.id, photoId), eq(propertyPhotos.propertyId, id)))
          .returning({ path: propertyPhotos.storagePath });
        if (!removed) throw new HttpError(404, 'photo_not_found', 'That photo is not on this property.');
        removedPath = removed.path;
        const rest = await tx
          .select({ id: propertyPhotos.id })
          .from(propertyPhotos)
          .where(eq(propertyPhotos.propertyId, id))
          .orderBy(asc(propertyPhotos.position), asc(propertyPhotos.createdAt));
        await renumberPhotos(
          tx,
          id,
          rest.map((p) => p.id),
        );
        return loadDetail(tx, id);
      });
      // The file goes once its row has gone: a failure here leaves an orphan file, never a broken photo.
      if (removedPath) await deps.photos.remove(removedPath).catch(() => {});
      return detail;
    },
  );
}
