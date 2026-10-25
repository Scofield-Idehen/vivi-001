import type { ApiDatabase } from '@v01/db';
import { reservations, type Tx } from '@v01/db';
import type { SecretBox } from '@v01/integrations';
import { type GuestLink, GuestLinkSchema, type GuestStay, GuestStaySchema, todayIn } from '@v01/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { RequestScope } from '../context.ts';
import { HttpError } from '../errors.ts';

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

const nightsBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/**
 * The guest's page (design roadmap: "get check-in details"). Public, by the private key in the
 * link; nothing else about the operator is reachable from it. Secrets open only from the day of
 * arrival to the day of departure, where the operator is.
 */
export function guestRoutes(
  app: FastifyInstance,
  deps: { db: ApiDatabase; scope: RequestScope; box: SecretBox | undefined; now?: () => Date },
) {
  const typed = app.withTypeProvider<ZodTypeProvider>();

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
        fields,
        doorCode:
          phase === 'during' && raw.doorCode && deps.box
            ? deps.box.open(Buffer.from(raw.doorCode, 'base64'))
            : null,
      };
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
