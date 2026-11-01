import type { ApiDatabase } from '@v01/db';
import { reservations, type Tx } from '@v01/db';
import type { CardGateway, SecretBox } from '@v01/integrations';
import {
  addDays,
  DEPOSIT_DAYS_BEFORE,
  depositWanted,
  GuestDepositLinkSchema,
  type GuestLink,
  GuestLinkSchema,
  type GuestStay,
  GuestStaySchema,
  todayIn,
} from '@v01/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { RequestScope } from '../context.ts';
import { HttpError } from '../errors.ts';
import { createCardRequest, settle } from './cards.ts';

const KeyParams = z.object({ key: z.string().regex(/^[0-9a-f]{32}$/) });
const ReservationParams = z.object({ id: z.uuid() });

/** What the database function returns; the API shapes and gates it. */
interface RawStay {
  reservationId: string;
  guestName: string | null;
  checkIn: string;
  checkOut: string;
  checkInTime: string;
  checkOutTime: string;
  adults: number;
  children: number;
  infants: number;
  timeZone: string;
  property: GuestStay['property'];
  brand: GuestStay['brand'];
  fields: {
    name: string;
    kind: GuestStay['fields'][number]['kind'];
    value: string | null;
    secret: string | null;
  }[];
  doorCode: string | null;
}

/** What app.guest_deposit returns. */
interface RawDeposit {
  orgId: string;
  reservationId: string;
  channel: string;
  checkIn: string;
  checkOut: string;
  currency: string;
  amountMinor: number | null;
  ask: boolean;
  gates: boolean;
  onAirbnb: boolean;
  request: { id: string; status: string; url: string | null; expiresAt: string | null } | null;
}

const nightsBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/**
 * The guest's page (design roadmap: "get check-in details"). Public, by the private key in the
 * link; nothing else about the operator is reachable from it. Secrets open only from the day of
 * arrival to the day of departure, where the operator is.
 */
export function guestRoutes(
  app: FastifyInstance,
  deps: {
    db: ApiDatabase;
    scope: RequestScope;
    box: SecretBox | undefined;
    now?: () => Date;
    cards?: CardGateway | null;
    appUrl?: string;
  },
) {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const gateway = deps.cards ?? null;

  /**
   * The stay's deposit, brought up to date with Stripe first (an open link or a hold may have
   * changed). Null when this stay isn't asked for one.
   */
  async function depositOf(key: string): Promise<RawDeposit | null> {
    let d = (await deps.db.guestDeposit(key)) as RawDeposit | null;
    if (!d || !depositWanted(d, d.channel)) return null;
    const r = d.request;
    if (gateway && r && (r.status === 'open' || r.status === 'held')) {
      try {
        await deps.db.withOrg({ orgId: d.orgId }, (tx) => settle(tx, gateway, r.id));
        d = ((await deps.db.guestDeposit(key)) as RawDeposit | null) ?? d;
      } catch {
        // Stripe slow: show what we know.
      }
    }
    return d;
  }

  typed.get(
    '/v1/stay/:key',
    { schema: { params: KeyParams, response: { 200: GuestStaySchema } } },
    async (req) => {
      const raw = (await deps.db.guestStay(req.params.key)) as RawStay | null;
      if (!raw) throw new HttpError(404, 'stay_not_found', 'This link is not for a current stay.');
      const today = todayIn(raw.timeZone, deps.now?.() ?? new Date());
      const phase: GuestStay['phase'] =
        today < raw.checkIn ? 'before' : today <= raw.checkOut ? 'during' : 'after';
      const fields: GuestStay['fields'] = raw.fields.map((f) => {
        if (f.kind !== 'secret') return { name: f.name, kind: f.kind, value: f.value };
        if (phase !== 'during' || !f.secret || !deps.box) return { name: f.name, kind: f.kind, value: null };
        return { name: f.name, kind: f.kind, value: deps.box.open(Buffer.from(f.secret, 'base64')) };
      });
      const d = await depositOf(req.params.key);
      const opensOn = d ? addDays(d.checkIn, -DEPOSIT_DAYS_BEFORE) : null;
      const status: NonNullable<GuestStay['deposit']>['status'] | null = !d
        ? null
        : d.request?.status === 'held'
          ? 'held'
          : d.request?.status === 'kept' || d.request?.status === 'released'
            ? 'done'
            : today < (opensOn as string)
              ? 'later'
              : 'needed';
      // The home keeps its codes back until the deposit is held.
      const waiting = Boolean(d?.gates) && (status === 'later' || status === 'needed');
      const shownFields = waiting
        ? fields.map((f) => (f.kind === 'secret' ? { ...f, value: null } : f))
        : fields;
      return {
        guestName: raw.guestName,
        checkIn: raw.checkIn,
        checkOut: raw.checkOut,
        checkInTime: raw.checkInTime,
        checkOutTime: raw.checkOutTime,
        nights: nightsBetween(raw.checkIn, raw.checkOut),
        guests: raw.adults + raw.children,
        timeZone: raw.timeZone,
        phase,
        codesFrom: phase === 'before' ? raw.checkIn : null,
        property: raw.property,
        brand: raw.brand,
        fields: shownFields,
        doorCode:
          !waiting && phase === 'during' && raw.doorCode && deps.box
            ? deps.box.open(Buffer.from(raw.doorCode, 'base64'))
            : null,
        deposit:
          d && status && d.amountMinor
            ? { status, amountMinor: d.amountMinor, currency: d.currency, opensOn: opensOn as string }
            : null,
        codesWaitForDeposit: waiting,
      };
    },
  );

  /**
   * The guest adds their card for the deposit: a Stripe page, reused while its link is open. Only
   * from 3 days before arrival (a card keeps a hold about 7 days) until the stay ends.
   */
  typed.post(
    '/v1/stay/:key/deposit',
    { schema: { params: KeyParams, response: { 200: GuestDepositLinkSchema } } },
    async (req) => {
      if (!gateway) throw new HttpError(503, 'cards_off', 'Card payments aren’t switched on here.');
      const d = await depositOf(req.params.key);
      if (!d || !d.amountMinor) throw new HttpError(404, 'no_deposit', 'This stay has no deposit to add.');
      const raw = (await deps.db.guestStay(req.params.key)) as RawStay | null;
      const today = todayIn(raw?.timeZone ?? 'Europe/London', deps.now?.() ?? new Date());
      if (today < addDays(d.checkIn, -DEPOSIT_DAYS_BEFORE))
        throw new HttpError(409, 'deposit_later', 'The deposit can be added from 3 days before you arrive.');
      if (today > d.checkOut) throw new HttpError(409, 'stay_over', 'This stay is over.');
      const r = d.request;
      if (r?.status === 'held' || r?.status === 'kept' || r?.status === 'released')
        throw new HttpError(409, 'deposit_done', 'Your deposit is already in place.');
      if (r?.status === 'open' && r.url && (!r.expiresAt || Date.parse(r.expiresAt) > Date.now() + 60_000))
        return { url: r.url };
      const appUrl = deps.appUrl ?? '';
      const made = await deps.db.withOrg({ orgId: d.orgId }, (tx) =>
        createCardRequest(tx, gateway, {
          orgId: d.orgId,
          reservationId: d.reservationId,
          kind: 'deposit',
          amountMinor: d.amountMinor as number,
          createdBy: null,
          successUrl: `${appUrl}/stay/${req.params.key}?deposit=added`,
          cancelUrl: `${appUrl}/stay/${req.params.key}`,
        }),
      );
      if (!made.url) throw new Error('Stripe made no page.');
      return { url: made.url };
    },
  );

  /** The team's side: the booking's link, for roles that may change the booking. */
  typed.get(
    '/v1/reservations/:id/guest-link',
    { schema: { params: ReservationParams, response: { 200: GuestLinkSchema } } },
    async (req) =>
      deps.scope.inOrg(req, 'reservations.write', async (tx: Tx): Promise<GuestLink> => {
        const [row] = await tx
          .select({ key: reservations.guestKey, status: reservations.status })
          .from(reservations)
          .where(eq(reservations.id, req.params.id));
        if (!row)
          throw new HttpError(404, 'reservation_not_found', 'That booking does not exist in this workspace.');
        return { key: row.key, path: `/stay/${row.key}` };
      }),
  );
}
