import { randomUUID } from 'node:crypto';
import {
  appUsers,
  cardRequests,
  guests,
  organisationSettings,
  properties,
  reservationCharges,
  reservationPayments,
  reservations,
  type Tx,
} from '@v01/db';
import { CardError, type CardGateway } from '@v01/integrations';
import {
  CardKeepSchema,
  type CardRequest,
  CardRequestCreateSchema,
  type CardRequestList,
  CardRequestListSchema,
} from '@v01/shared';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { type RequestScope, toIso } from '../context.ts';
import { HttpError } from '../errors.ts';
import { operatorToday } from './reservations.ts';
import { settleSiteBooking } from './site.ts';

/**
 * Card payments and deposits through Stripe (1 Nov 2026). The team makes a link on a booking; the
 * guest pays (or lets a deposit be held) on Stripe's page; V-01 learns the outcome from Stripe's
 * webhook or, failing that, by asking Stripe whenever the booking's card requests are read. Either
 * way the same `settle` runs, under a row lock, so nothing is recorded twice.
 */

export type Row = typeof cardRequests.$inferSelect;

const personName = sql<string>`coalesce(${appUsers.fullName}, ${appUsers.email})`;

const off = () =>
  new HttpError(503, 'cards_off', 'Card payments aren’t switched on yet. Add the Stripe key first.');

function cardFailure(error: unknown): never {
  if (error instanceof CardError) throw new HttpError(error.status, 'card_provider', error.message);
  throw error;
}

function view(row: Row, by: string | null): CardRequest {
  return {
    id: row.id,
    kind: row.kind as CardRequest['kind'],
    status: row.status as CardRequest['status'],
    amountMinor: row.amountMinor,
    currency: row.currency,
    url: row.status === 'open' ? row.url : null,
    keptMinor: row.keptMinor,
    keptReason: row.keptReason,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    createdBy: row.createdBy ? by : null,
    createdAt: toIso(String(row.createdAt)),
    settledAt: row.settledAt ? row.settledAt.toISOString() : null,
  };
}

const note = (row: Row, words: string) => `${words}${row.live ? '' : ', test'}`;

/** What the booking owes now for a kept deposit: a charge and a matching card payment. */
async function recordKept(tx: Tx, row: Row, amountMinor: number, reason: string, today: string) {
  const [charge] = await tx
    .insert(reservationCharges)
    .values({
      organisationId: row.organisationId,
      reservationId: row.reservationId,
      label: reason.slice(0, 80),
      amountMinor,
      createdBy: row.createdBy,
    })
    .returning({ id: reservationCharges.id });
  const [payment] = await tx
    .insert(reservationPayments)
    .values({
      organisationId: row.organisationId,
      reservationId: row.reservationId,
      amountMinor,
      method: 'card',
      paidOn: today,
      note: note(row, 'Deposit'),
      recordedBy: row.createdBy,
    })
    .returning({ id: reservationPayments.id });
  return { chargeId: charge?.id ?? null, paymentId: payment?.id ?? null };
}

/**
 * Money from the guest for a damage claim (2 Nov 2026): the claim is marked paid with it, received
 * today (so it reaches the owner's statement this month), and filed with the guest if it wasn't filed.
 */
export async function creditClaim(
  tx: Tx,
  claimId: string,
  amountMinor: number,
  today: string,
): Promise<void> {
  await tx.execute(sql`
    update app.claims
       set received_minor = coalesce(received_minor, 0) + ${amountMinor},
           received_on = coalesce(received_on, ${today}::date),
           filed_on = coalesce(filed_on, ${today}::date),
           status = case when status = 'closed' then status else 'paid' end
     where id = ${claimId}::uuid`);
}

/** Keeps some or all of a held deposit: charged at Stripe, recorded on the booking. */
export async function keepHeld(
  tx: Tx,
  gateway: CardGateway,
  row: Row,
  amountMinor: number,
  reason: string,
): Promise<void> {
  if (row.status !== 'held' || !row.paymentIntentId)
    throw new HttpError(409, 'not_held', 'Nothing is held on the guest’s card for this.');
  if (amountMinor > row.amountMinor)
    throw new HttpError(400, 'too_much', 'That is more than the deposit held.');
  await gateway.capture(row.paymentIntentId, amountMinor).catch(cardFailure);
  const ids = await recordKept(tx, row, amountMinor, reason, await operatorToday(tx));
  await tx
    .update(cardRequests)
    .set({ status: 'kept', keptMinor: amountMinor, keptReason: reason, ...ids, settledAt: new Date() })
    .where(eq(cardRequests.id, row.id));
}

/**
 * Brings one request up to date with Stripe. Locks the row first, so the webhook and a page load
 * arriving together record a payment once.
 */
export async function settle(tx: Tx, gateway: CardGateway, id: string): Promise<void> {
  const [row] = await tx.select().from(cardRequests).where(eq(cardRequests.id, id)).for('update');
  if (!row || (row.status !== 'open' && row.status !== 'held')) return;
  const state = await gateway.checkout(row.sessionId);
  const now = new Date();
  if (row.status === 'open') {
    if (state.session === 'expired') {
      await tx
        .update(cardRequests)
        .set({ status: 'expired', settledAt: now })
        .where(eq(cardRequests.id, row.id));
      return;
    }
    if (state.session !== 'complete') return;
    if (row.kind === 'payment' && state.intent === 'succeeded' && state.receivedMinor > 0) {
      const [payment] = await tx
        .insert(reservationPayments)
        .values({
          organisationId: row.organisationId,
          reservationId: row.reservationId,
          amountMinor: state.receivedMinor,
          method: 'card',
          paidOn: await operatorToday(tx),
          note: note(row, row.claimId ? 'Stripe, damage claim' : 'Stripe'),
          recordedBy: row.createdBy,
        })
        .returning({ id: reservationPayments.id });
      if (row.claimId) await creditClaim(tx, row.claimId, state.receivedMinor, await operatorToday(tx));
      await tx
        .update(cardRequests)
        .set({
          status: 'paid',
          paymentIntentId: state.paymentIntentId,
          paymentId: payment?.id ?? null,
          settledAt: now,
        })
        .where(eq(cardRequests.id, row.id));
      return;
    }
    if (row.kind === 'deposit' && state.intent === 'requires_capture') {
      await tx
        .update(cardRequests)
        .set({ status: 'held', paymentIntentId: state.paymentIntentId })
        .where(eq(cardRequests.id, row.id));
    }
    return;
  }
  // Held: let go in Stripe, or the card's hold ran out (about 7 days).
  if (state.intent === 'canceled') {
    await tx
      .update(cardRequests)
      .set({ status: 'released', settledAt: now })
      .where(eq(cardRequests.id, row.id));
    return;
  }
  // Kept in Stripe's own dashboard rather than here: record it all the same.
  if (state.intent === 'succeeded' && state.receivedMinor > 0) {
    const ids = await recordKept(
      tx,
      row,
      state.receivedMinor,
      'Damage deposit kept',
      await operatorToday(tx),
    );
    await tx
      .update(cardRequests)
      .set({
        status: 'kept',
        keptMinor: state.receivedMinor,
        keptReason: 'Damage deposit kept',
        ...ids,
        settledAt: now,
      })
      .where(eq(cardRequests.id, row.id));
  }
}

async function listFor(tx: Tx, reservationId: string): Promise<CardRequest[]> {
  const rows = await tx
    .select({ r: cardRequests, by: personName })
    .from(cardRequests)
    .leftJoin(appUsers, eq(appUsers.id, cardRequests.createdBy))
    .where(eq(cardRequests.reservationId, reservationId))
    .orderBy(desc(cardRequests.createdAt));
  return rows.map(({ r, by }) => view(r, by));
}

async function requestOf(tx: Tx, id: string): Promise<Row> {
  const [row] = await tx.select().from(cardRequests).where(eq(cardRequests.id, id)).for('update');
  if (!row) throw new HttpError(404, 'card_request_not_found', 'That card request isn’t here.');
  return row;
}

/**
 * Makes a Stripe link for a booking and records it. Used by the team (a payment or a deposit) and
 * by the guest's own page (the deposit), where nobody is signed in and `createdBy` is null.
 */
export async function createCardRequest(
  tx: Tx,
  gateway: CardGateway,
  input: {
    orgId: string;
    reservationId: string;
    kind: 'payment' | 'deposit';
    amountMinor: number;
    createdBy: string | null;
    successUrl: string;
    cancelUrl: string;
    /** For a damage claim: what the guest sees on Stripe's page, and the claim it pays. */
    claimId?: string;
    description?: string;
  },
): Promise<Row> {
  const [b] = await tx
    .select({
      id: reservations.id,
      status: reservations.status,
      currency: reservations.currency,
      checkIn: reservations.checkIn,
      checkOut: reservations.checkOut,
      home: properties.name,
      email: guests.email,
    })
    .from(reservations)
    .innerJoin(properties, eq(properties.id, reservations.propertyId))
    .leftJoin(guests, eq(guests.id, reservations.guestId))
    .where(eq(reservations.id, input.reservationId));
  if (!b) throw new HttpError(404, 'reservation_not_found', 'That booking does not exist here.');
  if (b.status === 'cancelled')
    throw new HttpError(409, 'reservation_cancelled', 'This booking is cancelled.');
  const [settings] = await tx.select({ currency: organisationSettings.currency }).from(organisationSettings);
  const currency = b.currency ?? settings?.currency ?? 'GBP';
  const id = randomUUID();
  const created = await gateway
    .createCheckout({
      kind: input.kind,
      amountMinor: input.amountMinor,
      currency,
      description: input.description ?? `Stay at ${b.home}, ${b.checkIn} to ${b.checkOut}`,
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
      customerEmail: b.email,
      metadata: { v01_org: input.orgId, v01_request: id },
      idempotencyKey: `v01-${id}`,
    })
    .catch(cardFailure);
  const [row] = await tx
    .insert(cardRequests)
    .values({
      id,
      organisationId: input.orgId,
      reservationId: b.id,
      kind: input.kind,
      amountMinor: input.amountMinor,
      currency,
      sessionId: created.sessionId,
      url: created.url,
      expiresAt: created.expiresAt,
      live: gateway.live,
      createdBy: input.createdBy,
      claimId: input.claimId ?? null,
    })
    .returning();
  if (!row) throw new Error('Saving the card request returned nothing.');
  return row;
}

const ReservationParams = z.object({ id: z.uuid() });
const RequestParams = z.object({ requestId: z.uuid() });

export function cardRoutes(
  app: FastifyInstance,
  deps: { scope: RequestScope; gateway: CardGateway | null; appUrl: string },
) {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const { gateway } = deps;
  const list = async (tx: Tx, reservationId: string): Promise<CardRequestList> => {
    const [home] = await tx
      .select({
        channel: reservations.channel,
        ask: properties.depositAsk,
        amountMinor: properties.securityDepositMinor,
        onAirbnb: properties.depositOnAirbnb,
      })
      .from(reservations)
      .innerJoin(properties, eq(properties.id, reservations.propertyId))
      .where(eq(reservations.id, reservationId));
    return {
      enabled: gateway !== null,
      testMode: gateway ? !gateway.live : true,
      requests: await listFor(tx, reservationId),
      // By hand a deposit can be asked whatever the home's own setting, but never on an Airbnb
      // booking unless the home says its Airbnb listing states the deposit.
      depositAllowed: home ? home.channel !== 'airbnb' || home.onAirbnb : false,
      depositMinor: home?.amountMinor ?? null,
    };
  };

  typed.get(
    '/v1/reservations/:id/card-requests',
    { schema: { params: ReservationParams, response: { 200: CardRequestListSchema } } },
    async (req) =>
      deps.scope.inOrg(req, 'reservations.read', async (tx, ctx) => {
        const [booking] = await tx
          .select({ id: reservations.id })
          .from(reservations)
          .where(eq(reservations.id, req.params.id));
        if (!booking) throw new HttpError(404, 'reservation_not_found', 'That booking does not exist here.');
        if (gateway && !ctx.supportGrantId) {
          const waiting = await tx
            .select({ id: cardRequests.id })
            .from(cardRequests)
            .where(
              and(
                eq(cardRequests.reservationId, booking.id),
                sql`${cardRequests.status} in ('open', 'held')`,
              ),
            );
          for (const { id } of waiting.slice(0, 10)) {
            try {
              await tx.transaction((inner) => settle(inner, gateway, id));
            } catch (error) {
              // Stripe slow or down: show what we know; the next read or the webhook catches up.
              req.log.warn({ err: error, cardRequest: id }, 'Could not check a card request with Stripe');
            }
          }
        }
        return list(tx, booking.id);
      }),
  );

  typed.post(
    '/v1/reservations/:id/card-requests',
    {
      schema: {
        params: ReservationParams,
        body: CardRequestCreateSchema,
        response: { 201: CardRequestListSchema },
      },
    },
    async (req, reply) =>
      deps.scope.inOrg(req, 'money.write', async (tx, ctx) => {
        if (!gateway) throw off();
        const [b] = await tx
          .select({
            id: reservations.id,
            channel: reservations.channel,
            onAirbnb: properties.depositOnAirbnb,
          })
          .from(reservations)
          .innerJoin(properties, eq(properties.id, reservations.propertyId))
          .where(eq(reservations.id, req.params.id));
        if (!b) throw new HttpError(404, 'reservation_not_found', 'That booking does not exist here.');
        if (req.body.kind === 'deposit' && b.channel === 'airbnb' && !b.onAirbnb)
          throw new HttpError(
            409,
            'deposit_airbnb',
            'Airbnb doesn’t allow a deposit taken outside Airbnb unless the listing states it. Damage on an Airbnb stay goes through Airbnb (a claim).',
          );
        await createCardRequest(tx, gateway, {
          orgId: ctx.orgId,
          reservationId: b.id,
          kind: req.body.kind,
          amountMinor: req.body.amountMinor,
          createdBy: ctx.userId,
          successUrl: `${deps.appUrl}/paid`,
          cancelUrl: `${deps.appUrl}/paid?not=1`,
        });
        reply.code(201);
        return list(tx, b.id);
      }),
  );

  typed.post(
    '/v1/card-requests/:requestId/cancel',
    { schema: { params: RequestParams, response: { 200: CardRequestListSchema } } },
    async (req) =>
      deps.scope.inOrg(req, 'money.write', async (tx) => {
        if (!gateway) throw off();
        const row = await requestOf(tx, req.params.requestId);
        if (row.status !== 'open')
          throw new HttpError(409, 'card_request_closed', 'That link is no longer open.');
        // Paid in the last moment? Settle first, so a payment is never thrown away.
        const state = await gateway.checkout(row.sessionId).catch(cardFailure);
        if (state.session === 'open') await gateway.expireCheckout(row.sessionId).catch(cardFailure);
        await tx.transaction((inner) => settle(inner, gateway, row.id));
        const [after] = await tx.select().from(cardRequests).where(eq(cardRequests.id, row.id));
        if (after?.status === 'open') {
          await tx
            .update(cardRequests)
            .set({ status: 'expired', settledAt: new Date() })
            .where(eq(cardRequests.id, row.id));
        }
        return list(tx, row.reservationId);
      }),
  );

  typed.post(
    '/v1/card-requests/:requestId/keep',
    { schema: { params: RequestParams, body: CardKeepSchema, response: { 200: CardRequestListSchema } } },
    async (req) =>
      deps.scope.inOrg(req, 'money.write', async (tx) => {
        if (!gateway) throw off();
        const row = await requestOf(tx, req.params.requestId);
        await keepHeld(tx, gateway, row, req.body.amountMinor, req.body.reason);
        return list(tx, row.reservationId);
      }),
  );

  typed.post(
    '/v1/card-requests/:requestId/release',
    { schema: { params: RequestParams, response: { 200: CardRequestListSchema } } },
    async (req) =>
      deps.scope.inOrg(req, 'money.write', async (tx) => {
        if (!gateway) throw off();
        const row = await requestOf(tx, req.params.requestId);
        if (row.status !== 'held' || !row.paymentIntentId)
          throw new HttpError(409, 'not_held', 'Nothing is held on the guest’s card for this.');
        await gateway.release(row.paymentIntentId).catch(cardFailure);
        await tx
          .update(cardRequests)
          .set({ status: 'released', settledAt: new Date() })
          .where(eq(cardRequests.id, row.id));
        return list(tx, row.reservationId);
      }),
  );
}

/**
 * Stripe's webhook, already signature-checked. Our ids ride in the session's metadata; the
 * request is then settled by asking Stripe, so the event's own body is never trusted for money.
 */
export async function handleStripeEvent(
  db: { withOrg<T>(scope: { orgId: string }, fn: (tx: Tx) => Promise<T>): Promise<T> },
  gateway: CardGateway,
  event: unknown,
  log: FastifyBaseLogger,
): Promise<void> {
  const parsed = z
    .object({
      type: z.string(),
      data: z.object({
        object: z.object({
          object: z.string().optional(),
          metadata: z.record(z.string(), z.string()).nullish(),
        }),
      }),
    })
    .safeParse(event);
  if (!parsed.success) return;
  const meta = parsed.data.data.object.metadata ?? {};
  const orgId = meta.v01_org;
  const requestId = meta.v01_request;
  const uuid = z.uuid();
  const siteBooking = meta.v01_site_booking;
  if (orgId && siteBooking && uuid.safeParse(orgId).success && uuid.safeParse(siteBooking).success) {
    await db.withOrg({ orgId }, (tx) => settleSiteBooking(tx, gateway, siteBooking, log));
    log.info({ type: parsed.data.type, siteBooking }, 'Stripe event settled');
    return;
  }
  if (!orgId || !requestId || !uuid.safeParse(orgId).success || !uuid.safeParse(requestId).success) return;
  await db.withOrg({ orgId }, (tx) => settle(tx, gateway, requestId));
  log.info({ type: parsed.data.type, cardRequest: requestId }, 'Stripe event settled');
}
