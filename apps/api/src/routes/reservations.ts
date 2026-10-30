import {
  appUsers,
  guests,
  organisationSettings,
  properties,
  reservationCharges,
  reservationPayments,
  reservations,
  type Tx,
} from '@v01/db';
import {
  ChargeCreateSchema,
  PaymentCreateSchema,
  type PaymentMethod,
  RESERVATION_LIST_LIMIT,
  type Reservation,
  ReservationCancelSchema,
  ReservationCreateSchema,
  type ReservationList,
  ReservationListQuerySchema,
  ReservationListSchema,
  ReservationSchema,
  ReservationUpdateSchema,
  todayIn,
} from '@v01/shared';
import { and, asc, desc, eq, gte, ilike, lt, ne, or, type SQL, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { pgConstraint, type RequestScope, toIso } from '../context.ts';
import { HttpError } from '../errors.ts';

const ReservationParams = z.object({ id: z.uuid() });
const ChargeParams = z.object({ id: z.uuid(), chargeId: z.uuid() });
const PaymentParams = z.object({ id: z.uuid(), paymentId: z.uuid() });

const personName = sql<string>`coalesce(${appUsers.fullName}, ${appUsers.email})`;

const notFound = () =>
  new HttpError(404, 'reservation_not_found', 'That booking does not exist in this workspace.');

/** Today where the operator is. Row-level security leaves exactly one settings row in scope. */
async function operatorToday(tx: Tx): Promise<string> {
  const [row] = await tx.select({ timeZone: organisationSettings.timeZone }).from(organisationSettings);
  return todayIn(row?.timeZone ?? 'Europe/London');
}

/** A search typed by a person, safe inside LIKE: its own % and _ match only themselves. */
const contains = (text: string) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

const summary = {
  id: reservations.id,
  propertyId: reservations.propertyId,
  propertyName: properties.name,
  status: reservations.status,
  channel: reservations.channel,
  channelReference: reservations.channelReference,
  checkIn: reservations.checkIn,
  checkOut: reservations.checkOut,
  guestName: guests.fullName,
  adults: reservations.adults,
  children: reservations.children,
  infants: reservations.infants,
  currency: reservations.currency,
  totalMinor: reservations.totalMinor,
  createdAt: reservations.createdAt,
};

/** "15:00:00" as stored, "15:00" as shown. */
const clock = (value: string | null) => (value ? value.slice(0, 5) : null);

async function loadReservation(tx: Tx, id: string): Promise<Reservation> {
  // Row-level security limits this to the operator in scope: another operator's booking is not found.
  const [row] = await tx
    .select({
      ...summary,
      propertyCode: properties.internalCode,
      propertyCheckInTime: properties.checkInTime,
      propertyCheckOutTime: properties.checkOutTime,
      checkInTime: reservations.checkInTime,
      checkOutTime: reservations.checkOutTime,
      guestEmail: guests.email,
      guestPhone: guests.phone,
      payoutMinor: reservations.payoutMinor,
      notes: reservations.notes,
      cancelledAt: reservations.cancelledAt,
      cancellationReason: reservations.cancellationReason,
      cancelledBy: reservations.cancelledBy,
      updatedAt: reservations.updatedAt,
    })
    .from(reservations)
    .innerJoin(properties, eq(properties.id, reservations.propertyId))
    .leftJoin(guests, eq(guests.id, reservations.guestId))
    .where(eq(reservations.id, id));
  if (!row) throw notFound();
  const chargeRows = await tx
    .select({ c: reservationCharges, by: personName })
    .from(reservationCharges)
    .leftJoin(appUsers, eq(appUsers.id, reservationCharges.createdBy))
    .where(eq(reservationCharges.reservationId, id))
    .orderBy(asc(reservationCharges.createdAt));
  const paymentRows = await tx
    .select({ p: reservationPayments, by: personName })
    .from(reservationPayments)
    .leftJoin(appUsers, eq(appUsers.id, reservationPayments.recordedBy))
    .where(eq(reservationPayments.reservationId, id))
    .orderBy(asc(reservationPayments.paidOn), asc(reservationPayments.createdAt));
  const charges = chargeRows.map(({ c, by }) => ({
    id: c.id,
    label: c.label,
    amountMinor: c.amountMinor,
    createdBy: c.createdBy ? by : null,
    createdAt: toIso(c.createdAt),
  }));
  const payments = paymentRows.map(({ p, by }) => ({
    id: p.id,
    amountMinor: p.amountMinor,
    method: p.method as PaymentMethod,
    paidOn: p.paidOn,
    note: p.note,
    recordedBy: p.recordedBy ? by : null,
    createdAt: toIso(p.createdAt),
  }));
  const chargesMinor = charges.reduce((sum, c) => sum + c.amountMinor, 0);
  const paidMinor = payments.reduce((sum, p) => sum + p.amountMinor, 0);
  let cancelledByName: string | null = null;
  if (row.cancelledBy) {
    const [who] = await tx
      .select({ name: personName })
      .from(appUsers)
      .where(eq(appUsers.id, row.cancelledBy));
    cancelledByName = who?.name ?? null;
  }
  return {
    ...row,
    propertyCheckInTime: clock(row.propertyCheckInTime) ?? '15:00',
    propertyCheckOutTime: clock(row.propertyCheckOutTime) ?? '10:00',
    checkInTime: clock(row.checkInTime),
    checkOutTime: clock(row.checkOutTime),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    cancelledAt: row.cancelledAt ? toIso(row.cancelledAt) : null,
    cancelledBy: cancelledByName,
    charges,
    payments,
    chargesMinor,
    paidMinor,
    balanceMinor: row.totalMinor === null ? null : row.totalMinor + chargesMinor - paidMinor,
    today: await operatorToday(tx),
  };
}

/** An empty value clears a detail. */
const orNull = (value: string | null | undefined) => (value === undefined ? undefined : value || null);

export function reservationRoutes(app: FastifyInstance, deps: { scope: RequestScope }) {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/v1/reservations',
    { schema: { querystring: ReservationListQuerySchema, response: { 200: ReservationListSchema } } },
    async (req) =>
      deps.scope.inOrg(req, 'reservations.read', async (tx): Promise<ReservationList> => {
        const { view, q } = req.query;
        const today = await operatorToday(tx);
        const notCancelled = ne(reservations.status, 'cancelled');
        // Upcoming includes everyone staying now: a stay leaving today is still on.
        const which: SQL | undefined =
          view === 'cancelled'
            ? eq(reservations.status, 'cancelled')
            : view === 'past'
              ? and(notCancelled, lt(reservations.checkOut, today))
              : and(notCancelled, gte(reservations.checkOut, today));
        const search = q
          ? or(
              ilike(guests.fullName, contains(q)),
              ilike(reservations.channelReference, contains(q)),
              ilike(properties.name, contains(q)),
            )
          : undefined;
        const order =
          view === 'upcoming'
            ? [asc(reservations.checkIn), asc(reservations.createdAt)]
            : view === 'past'
              ? [desc(reservations.checkIn), desc(reservations.createdAt)]
              : [desc(sql`coalesce(${reservations.cancelledAt}, ${reservations.updatedAt})`)];
        const rows = await tx
          .select(summary)
          .from(reservations)
          .innerJoin(properties, eq(properties.id, reservations.propertyId))
          .leftJoin(guests, eq(guests.id, reservations.guestId))
          .where(and(which, search))
          .orderBy(...order)
          .limit(RESERVATION_LIST_LIMIT + 1);
        return {
          today,
          reservations: rows
            .slice(0, RESERVATION_LIST_LIMIT)
            .map((row) => ({ ...row, createdAt: toIso(row.createdAt) })),
          more: rows.length > RESERVATION_LIST_LIMIT,
        };
      }),
  );

  /** A booking made by the team: a direct or repeat guest. Holds the nights like any other booking. */
  typed.post(
    '/v1/reservations',
    { schema: { body: ReservationCreateSchema, response: { 201: ReservationSchema } } },
    async (req, reply) =>
      deps.scope.inOrg(req, 'reservations.write', async (tx, ctx) => {
        const b = req.body;
        const [property] = await tx
          .select({ id: properties.id, name: properties.name })
          .from(properties)
          .where(and(eq(properties.id, b.propertyId), sql`${properties.archivedAt} is null`));
        if (!property) throw new HttpError(404, 'property_not_found', 'That property does not exist here.');
        const [settings] = await tx
          .select({ currency: organisationSettings.currency })
          .from(organisationSettings);
        const [guest] = await tx
          .insert(guests)
          .values({
            organisationId: ctx.orgId,
            fullName: b.guestName,
            email: b.guestEmail?.toLowerCase() || null,
            phone: b.guestPhone || null,
          })
          .returning({ id: guests.id });
        let row: { id: string } | undefined;
        try {
          [row] = await tx
            .insert(reservations)
            .values({
              organisationId: ctx.orgId,
              propertyId: property.id,
              channel: 'direct',
              channelReference: null,
              status: 'confirmed',
              checkIn: b.checkIn,
              checkOut: b.checkOut,
              adults: b.adults,
              children: b.children,
              infants: b.infants,
              currency: settings?.currency ?? 'GBP',
              totalMinor: b.totalMinor ?? null,
              checkInTime: b.checkInTime ?? null,
              checkOutTime: b.checkOutTime ?? null,
              notes: b.notes || null,
              guestId: guest?.id ?? null,
            })
            .returning({ id: reservations.id });
        } catch (error) {
          // The nights are taken: a booking or a block already holds them. Say so; make nothing.
          if (pgConstraint(error) === 'occupancies_no_overlap') {
            throw new HttpError(
              409,
              'nights_taken',
              `${property.name} is not free for ${b.checkIn} to ${b.checkOut}: another booking or a block holds those nights.`,
            );
          }
          throw error;
        }
        if (!row) throw new Error('Inserting the booking returned nothing.');
        reply.code(201);
        return await loadReservation(tx, row.id);
      }),
  );

  typed.get(
    '/v1/reservations/:id',
    { schema: { params: ReservationParams, response: { 200: ReservationSchema } } },
    async (req) => deps.scope.inOrg(req, 'reservations.read', (tx) => loadReservation(tx, req.params.id)),
  );

  typed.patch(
    '/v1/reservations/:id',
    {
      schema: {
        params: ReservationParams,
        body: ReservationUpdateSchema,
        response: { 200: ReservationSchema },
      },
    },
    async (req) =>
      deps.scope.inOrg(req, 'reservations.write', async (tx, ctx) => {
        const [booking] = await tx
          .select({ id: reservations.id, guestId: reservations.guestId })
          .from(reservations)
          .where(eq(reservations.id, req.params.id));
        if (!booking) throw notFound();
        const change = req.body;

        // The guest's details. A booking with no guest yet gets one.
        const guest = {
          fullName: orNull(change.guestName),
          email: orNull(change.guestEmail),
          phone: orNull(change.guestPhone),
        };
        const touchesGuest = Object.values(guest).some((v) => v !== undefined);
        let guestId = booking.guestId;
        if (touchesGuest && guestId) {
          await tx.update(guests).set(guest).where(eq(guests.id, guestId));
        } else if (touchesGuest && Object.values(guest).some(Boolean)) {
          const [row] = await tx
            .insert(guests)
            .values({ organisationId: ctx.orgId, ...guest })
            .returning({ id: guests.id });
          guestId = row?.id ?? null;
        }

        const stay = {
          checkInTime: change.checkInTime,
          checkOutTime: change.checkOutTime,
          notes: orNull(change.notes),
          ...(guestId !== booking.guestId ? { guestId } : {}),
        };
        if (Object.values(stay).some((v) => v !== undefined)) {
          await tx.update(reservations).set(stay).where(eq(reservations.id, booking.id));
        }
        return loadReservation(tx, booking.id);
      }),
  );
  // Money for the record: extra charges and payments, and the balance they make. Nothing is charged from here.

  typed.post(
    '/v1/reservations/:id/charges',
    { schema: { params: ReservationParams, body: ChargeCreateSchema, response: { 201: ReservationSchema } } },
    async (req, reply) =>
      deps.scope.inOrg(req, 'money.write', async (tx, ctx) => {
        await loadReservation(tx, req.params.id);
        await tx.insert(reservationCharges).values({
          organisationId: ctx.orgId,
          reservationId: req.params.id,
          label: req.body.label,
          amountMinor: req.body.amountMinor,
          createdBy: ctx.userId,
        });
        reply.code(201);
        return await loadReservation(tx, req.params.id);
      }),
  );

  typed.delete(
    '/v1/reservations/:id/charges/:chargeId',
    { schema: { params: ChargeParams, response: { 200: ReservationSchema } } },
    async (req) =>
      deps.scope.inOrg(req, 'money.write', async (tx) => {
        const gone = await tx
          .delete(reservationCharges)
          .where(
            and(
              eq(reservationCharges.id, req.params.chargeId),
              eq(reservationCharges.reservationId, req.params.id),
            ),
          )
          .returning({ id: reservationCharges.id });
        if (gone.length === 0)
          throw new HttpError(404, 'charge_not_found', 'That charge is not on this booking.');
        return loadReservation(tx, req.params.id);
      }),
  );

  typed.post(
    '/v1/reservations/:id/payments',
    {
      schema: { params: ReservationParams, body: PaymentCreateSchema, response: { 201: ReservationSchema } },
    },
    async (req, reply) =>
      deps.scope.inOrg(req, 'money.write', async (tx, ctx) => {
        await loadReservation(tx, req.params.id);
        await tx.insert(reservationPayments).values({
          organisationId: ctx.orgId,
          reservationId: req.params.id,
          amountMinor: req.body.amountMinor,
          method: req.body.method,
          paidOn: req.body.paidOn,
          note: req.body.note || null,
          recordedBy: ctx.userId,
        });
        reply.code(201);
        return await loadReservation(tx, req.params.id);
      }),
  );

  typed.delete(
    '/v1/reservations/:id/payments/:paymentId',
    { schema: { params: PaymentParams, response: { 200: ReservationSchema } } },
    async (req) =>
      deps.scope.inOrg(req, 'money.write', async (tx) => {
        const gone = await tx
          .delete(reservationPayments)
          .where(
            and(
              eq(reservationPayments.id, req.params.paymentId),
              eq(reservationPayments.reservationId, req.params.id),
            ),
          )
          .returning({ id: reservationPayments.id });
        if (gone.length === 0)
          throw new HttpError(404, 'payment_not_found', 'That payment is not on this booking.');
        return loadReservation(tx, req.params.id);
      }),
  );

  /**
   * Cancelling a booking made here, with a reason. The nights come free at once (and go to the
   * channels for a property V-01 runs). A channel's booking is cancelled on the channel, which
   * then tells V-01; cancelling it here would leave the two disagreeing.
   */
  typed.post(
    '/v1/reservations/:id/cancel',
    {
      schema: {
        params: ReservationParams,
        body: ReservationCancelSchema,
        response: { 200: ReservationSchema },
      },
    },
    async (req) =>
      deps.scope.inOrg(req, 'reservations.write', async (tx, ctx) => {
        const current = await loadReservation(tx, req.params.id);
        if (current.channel !== 'direct') {
          throw new HttpError(
            400,
            'cancel_on_channel',
            `This booking came from ${current.channel === 'booking_com' ? 'Booking.com' : current.channel === 'airbnb' ? 'Airbnb' : 'the channel'}; cancel it there and it arrives here.`,
          );
        }
        if (current.status === 'cancelled')
          throw new HttpError(400, 'already_cancelled', 'This booking is already cancelled.');
        await tx
          .update(reservations)
          .set({
            status: 'cancelled',
            cancelledAt: sql`now()`,
            cancellationReason: req.body.reason,
            cancelledBy: ctx.userId,
          })
          .where(eq(reservations.id, req.params.id));
        return loadReservation(tx, req.params.id);
      }),
  );
}
