import type { ApiDatabase } from '@v01/db';
import {
  calendarDays,
  guests,
  organisationBrand,
  organisationSettings,
  organisations,
  properties,
  propertyAmenities,
  propertyPhotos,
  reservationPayments,
  reservations,
  siteBookings,
  type Tx,
} from '@v01/db';
import { CardError, type CardGateway } from '@v01/integrations';
import {
  addDays,
  amenity,
  type BookingSiteSettings,
  BookingSiteSettingsSchema,
  BookingSiteUpdateSchema,
  CANCELLATION_POLICY_LABELS,
  eachNight,
  isCancellationPolicy,
  type NightOwnRules,
  nightRules,
  PROPERTY_TYPE_LABELS,
  type PropertyType,
  quoteStay,
  SITE_CHECKOUT_MINUTES,
  SITE_FROM_PRICE_DAYS,
  SITE_NIGHTS_WINDOW,
  type Site,
  SiteBookingSchema,
  SiteBookLinkSchema,
  SiteBookRequestSchema,
  type SiteHome,
  type SiteHomeCard,
  type SiteHomeRules,
  SiteHomeSchema,
  type SiteNights,
  SiteNightsQuerySchema,
  SiteNightsSchema,
  type SiteParty,
  type SiteQuote,
  SiteQuoteRequestSchema,
  SiteQuoteSchema,
  SiteSchema,
  SiteSearchSchema,
  SiteSlugParams,
  todayIn,
} from '@v01/shared';
import { and, asc, eq, gte, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { pgConstraint, type RequestScope } from '../context.ts';
import { HttpError } from '../errors.ts';

/**
 * The booking website (2 Nov 2026), public, by the operator's address (`/book/{slug}`). It shows
 * only the homes the team put on it, and only what a listing shows: no street address, no codes.
 * Reads run in the operator's scope once `app.booking_site_org` has said the site is switched on.
 */

const HomeParams = SiteSlugParams.extend({ homeId: z.uuid() });
const BookingParams = SiteSlugParams.extend({ bookingId: z.uuid() });

const notFound = () => new HttpError(404, 'site_not_found', 'There is no booking site at this address.');
const homeNotFound = () => new HttpError(404, 'home_not_found', 'That home isn’t on this site.');

/** What the site may show and needs for prices, for the homes on it. */
const homeColumns = {
  id: properties.id,
  name: properties.name,
  title: properties.title,
  city: properties.city,
  area: properties.area,
  propertyType: properties.propertyType,
  maxGuests: properties.maxGuests,
  bedrooms: properties.bedrooms,
  beds: properties.beds,
  bathrooms: properties.bathrooms,
  petsAllowed: properties.petsAllowed,
  childrenAllowed: properties.childrenAllowed,
  smokingAllowed: properties.smokingAllowed,
  eventsAllowed: properties.eventsAllowed,
  summary: properties.summary,
  theSpace: properties.theSpace,
  guestAccess: properties.guestAccess,
  neighbourhood: properties.neighbourhood,
  gettingAround: properties.gettingAround,
  otherNotes: properties.otherNotes,
  houseRules: properties.houseRules,
  checkInTime: properties.checkInTime,
  checkOutTime: properties.checkOutTime,
  minNights: properties.minNights,
  maxNights: properties.maxNights,
  advanceNoticeHours: properties.advanceNoticeHours,
  bookingWindowDays: properties.bookingWindowDays,
  preparationDays: properties.preparationDays,
  cancellationPolicy: properties.cancellationPolicy,
  basePriceMinor: properties.basePriceMinor,
  weekendPriceMinor: properties.weekendPriceMinor,
  minPriceMinor: properties.minPriceMinor,
  maxPriceMinor: properties.maxPriceMinor,
  cleaningFeeMinor: properties.cleaningFeeMinor,
  extraGuestFeeMinor: properties.extraGuestFeeMinor,
  extraGuestFrom: properties.extraGuestFrom,
};
type HomeRow = {
  [K in keyof typeof homeColumns]: (typeof homeColumns)[K]['_']['data'] | null;
} & { id: string; name: string; maxGuests: number };

const onSite = and(
  eq(properties.onBookingSite, true),
  isNull(properties.archivedAt),
  ne(properties.managedBy, 'guesty'),
);

function rulesOf(h: HomeRow): SiteHomeRules {
  return {
    usual: {
      basePriceMinor: h.basePriceMinor,
      weekendPriceMinor: h.weekendPriceMinor,
      minPriceMinor: h.minPriceMinor,
      maxPriceMinor: h.maxPriceMinor,
      minNights: h.minNights ?? 1,
      maxNights: h.maxNights,
    },
    maxGuests: h.maxGuests,
    maxNights: h.maxNights,
    advanceNoticeHours: h.advanceNoticeHours ?? 0,
    checkInHour: Number((h.checkInTime ?? '15:00').slice(0, 2)),
    bookingWindowDays: h.bookingWindowDays,
    preparationDays: h.preparationDays ?? 0,
    cleaningFeeMinor: h.cleaningFeeMinor,
    extraGuestFeeMinor: h.extraGuestFeeMinor,
    extraGuestFrom: h.extraGuestFrom,
    petsAllowed: h.petsAllowed ?? false,
    childrenAllowed: h.childrenAllowed ?? true,
  };
}

const placeOf = (h: HomeRow) => [...new Set([h.area, h.city].filter(Boolean))].join(', ') || null;

/** The operator's settings and brand for the site. */
async function siteOf(tx: Tx) {
  const [row] = await tx
    .select({
      slug: organisations.slug,
      orgName: organisations.name,
      currency: organisationSettings.currency,
      timeZone: organisationSettings.timeZone,
      serviceFeeBp: organisationSettings.bookingServiceFeeBp,
      terms: organisationSettings.bookingTerms,
      brandName: organisationBrand.displayName,
      logoUrl: organisationBrand.logoLightUrl,
      accentHex: organisationBrand.accentHex,
      phone: organisationBrand.guestPhone,
      email: organisationBrand.senderEmail,
    })
    .from(organisations)
    .innerJoin(organisationSettings, eq(organisationSettings.organisationId, organisations.id))
    .leftJoin(organisationBrand, eq(organisationBrand.organisationId, organisations.id));
  if (!row) throw notFound();
  return {
    ...row,
    brand: {
      name: row.brandName ?? row.orgName,
      logoUrl: row.logoUrl,
      accentHex: row.accentHex,
      phone: row.phone,
      email: row.email,
    },
  };
}

/** Now where the operator is: the date and the hour. */
function nowIn(timeZone: string, now: Date) {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(now),
  );
  return { today: todayIn(timeZone, now), hourNow: Number.isFinite(hour) ? hour : 12 };
}

/** Nights held by bookings and blocks, per home, touching [from, to). */
async function takenOf(tx: Tx, homeIds: string[], from: string, to: string) {
  const map = new Map<string, { from: string; to: string }[]>();
  if (!homeIds.length) return map;
  const rows = await tx.execute(sql`
    select property_id, lower(nights)::text as start, upper(nights)::text as finish
      from app.occupancies
     where property_id in ${homeIds}
       and nights && daterange(${from}::date, ${to}::date, '[)')`);
  for (const r of rows.rows as { property_id: string; start: string; finish: string }[]) {
    map.set(r.property_id, [...(map.get(r.property_id) ?? []), { from: r.start, to: r.finish }]);
  }
  return map;
}

/** Nights with their own price or rules, per home, in [from, to]. */
async function ownOf(tx: Tx, homeIds: string[], from: string, to: string) {
  const map = new Map<string, Map<string, NightOwnRules>>();
  if (!homeIds.length) return map;
  const rows = await tx
    .select({
      propertyId: calendarDays.propertyId,
      night: calendarDays.night,
      priceMinor: calendarDays.priceMinor,
      minNights: calendarDays.minNights,
      closedToArrival: calendarDays.closedToArrival,
      closedToDeparture: calendarDays.closedToDeparture,
    })
    .from(calendarDays)
    .where(
      and(
        inArray(calendarDays.propertyId, homeIds),
        gte(calendarDays.night, from),
        sql`${calendarDays.night} <= ${to}`,
      ),
    );
  for (const r of rows) {
    const nights = map.get(r.propertyId) ?? new Map<string, NightOwnRules>();
    nights.set(r.night, r);
    map.set(r.propertyId, nights);
  }
  return map;
}

async function homesOf(tx: Tx, id?: string): Promise<HomeRow[]> {
  return (await tx
    .select(homeColumns)
    .from(properties)
    .where(id ? and(onSite, eq(properties.id, id)) : onSite)
    .orderBy(asc(properties.name))) as HomeRow[];
}

async function coversOf(tx: Tx, homeIds: string[]) {
  const map = new Map<string, string>();
  if (!homeIds.length) return map;
  const rows = await tx
    .select({ propertyId: propertyPhotos.propertyId, url: propertyPhotos.url })
    .from(propertyPhotos)
    .where(and(inArray(propertyPhotos.propertyId, homeIds), eq(propertyPhotos.position, 0)));
  for (const r of rows) map.set(r.propertyId, r.url);
  return map;
}

function card(h: HomeRow, cover: string | null, fromMinor: number | null): Omit<SiteHomeCard, 'stay'> {
  return {
    id: h.id,
    name: h.title || h.name,
    place: placeOf(h),
    propertyType: h.propertyType ? (PROPERTY_TYPE_LABELS[h.propertyType as PropertyType] ?? null) : null,
    maxGuests: h.maxGuests,
    bedrooms: h.bedrooms,
    beds: h.beds,
    bathrooms: h.bathrooms,
    petsAllowed: h.petsAllowed ?? false,
    summary: h.summary,
    coverUrl: cover,
    fromMinor,
  };
}

/** The lowest price of a free night in the coming weeks. */
function fromPrice(h: HomeRow, own: Map<string, NightOwnRules> | undefined, today: string) {
  let low: number | null = null;
  for (const night of eachNight(today, addDays(today, SITE_FROM_PRICE_DAYS))) {
    const p = nightRules(rulesOf(h).usual, night, own?.get(night)).priceMinor;
    if (p && (low === null || p < low)) low = p;
  }
  return low;
}

async function quoteFor(
  tx: Tx,
  h: HomeRow,
  stay: { checkIn: string; checkOut: string },
  party: SiteParty,
  site: { timeZone: string; serviceFeeBp: number | null },
  now: Date,
): Promise<SiteQuote> {
  const prep = h.preparationDays ?? 0;
  // One transaction runs one query at a time.
  const taken = await takenOf(tx, [h.id], addDays(stay.checkIn, -prep), addDays(stay.checkOut, prep));
  const own = await ownOf(tx, [h.id], stay.checkIn, stay.checkOut);
  return quoteStay({
    rules: rulesOf(h),
    own: own.get(h.id) ?? new Map(),
    taken: taken.get(h.id) ?? [],
    checkIn: stay.checkIn,
    checkOut: stay.checkOut,
    party,
    ...nowIn(site.timeZone, now),
    serviceFeeBp: site.serviceFeeBp,
  });
}

const BOOKING_NOTE = 'Booked on the website';

/**
 * Where a website booking stands, read fresh from Stripe. When the guest's card is authorised the
 * booking is saved and only then charged; if the nights went to another booking meanwhile, the
 * hold is let go. Safe to run again: the row is locked and only an open one moves.
 */
export async function settleSiteBooking(
  tx: Tx,
  gateway: CardGateway,
  id: string,
  log?: FastifyBaseLogger,
): Promise<void> {
  const [row] = await tx.select().from(siteBookings).where(eq(siteBookings.id, id)).for('update');
  if (row?.status !== 'open') return;
  const state = await gateway.checkout(row.sessionId);
  const now = new Date();
  if (state.session === 'expired') {
    await tx.update(siteBookings).set({ status: 'expired', settledAt: now }).where(eq(siteBookings.id, id));
    return;
  }
  if (state.session !== 'complete' || !state.paymentIntentId) return;
  const authorised = state.intent === 'requires_capture';
  const charged = state.intent === 'succeeded';
  if (!authorised && !charged) return;

  // Save the booking in a savepoint, so nights taken meanwhile can be answered without losing the row lock.
  let reservationId: string | null = null;
  try {
    reservationId = await tx.transaction(async (sp) => {
      const [guest] = await sp
        .insert(guests)
        .values({
          organisationId: row.organisationId,
          fullName: row.guestName,
          email: row.email.toLowerCase(),
          phone: row.phone,
        })
        .returning({ id: guests.id });
      const [r] = await sp
        .insert(reservations)
        .values({
          organisationId: row.organisationId,
          propertyId: row.propertyId,
          channel: 'direct',
          status: 'confirmed',
          checkIn: row.checkIn,
          checkOut: row.checkOut,
          adults: row.adults,
          children: row.children,
          infants: row.infants,
          currency: row.currency,
          totalMinor: row.totalMinor,
          cleaningMinor: row.cleaningMinor || null,
          notes: [
            `${BOOKING_NOTE}${row.live ? '' : ' (test payment)'}.`,
            row.pets ? `Bringing ${row.pets} ${row.pets === 1 ? 'pet' : 'pets'}.` : '',
            row.request ? `Guest’s request: ${row.request}` : '',
          ]
            .filter(Boolean)
            .join('\n'),
          guestId: guest?.id ?? null,
        })
        .returning({ id: reservations.id });
      return r?.id ?? null;
    });
  } catch (error) {
    if (pgConstraint(error) !== 'occupancies_no_overlap') throw error;
  }

  if (!reservationId) {
    // The nights went to another booking while the guest was paying: nothing is kept.
    if (authorised) await gateway.release(state.paymentIntentId);
    else await gateway.refund(state.paymentIntentId);
    await tx
      .update(siteBookings)
      .set({ status: 'refused', paymentIntentId: state.paymentIntentId, settledAt: now })
      .where(eq(siteBookings.id, id));
    log?.warn({ siteBooking: id }, 'Website booking refused: the nights were taken meanwhile');
    return;
  }
  if (authorised) await gateway.capture(state.paymentIntentId, row.totalMinor);
  const [settings] = await tx.select({ timeZone: organisationSettings.timeZone }).from(organisationSettings);
  await tx.insert(reservationPayments).values({
    organisationId: row.organisationId,
    reservationId,
    amountMinor: row.totalMinor,
    method: 'card',
    paidOn: todayIn(settings?.timeZone ?? 'Europe/London', now),
    note: `Stripe, ${BOOKING_NOTE.toLowerCase()}${row.live ? '' : ', test'}`,
  });
  await tx
    .update(siteBookings)
    .set({ status: 'booked', reservationId, paymentIntentId: state.paymentIntentId, settledAt: now })
    .where(eq(siteBookings.id, id));
}

/** Leaves open bookings older than their page to the gateway check, so a guest who never came back is closed. */
export async function settleStaleSiteBookings(tx: Tx, gateway: CardGateway): Promise<void> {
  const rows = await tx
    .select({ id: siteBookings.id })
    .from(siteBookings)
    .where(
      and(eq(siteBookings.status, 'open'), lt(siteBookings.createdAt, sql`now() - interval '5 minutes'`)),
    )
    .limit(20);
  for (const r of rows) await settleSiteBooking(tx, gateway, r.id).catch(() => undefined);
}

export function siteRoutes(
  app: FastifyInstance,
  deps: { db: ApiDatabase; cards: CardGateway | null; appUrl: string; now?: () => Date },
): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const now = () => deps.now?.() ?? new Date();

  async function inSite<T>(slug: string, fn: (tx: Tx, orgId: string) => Promise<T>): Promise<T> {
    const orgId = await deps.db.bookingSiteOrg(slug);
    if (!orgId) throw notFound();
    return deps.db.withOrg({ orgId }, (tx) => fn(tx, orgId));
  }

  const payment = () => ({
    canPay: Boolean(deps.cards),
    testMode: deps.cards ? !deps.cards.live : false,
  });

  /** The site: its homes, and with dates, whether each is free and what the stay costs. */
  typed.get(
    '/v1/site/:slug',
    { schema: { params: SiteSlugParams, querystring: SiteSearchSchema, response: { 200: SiteSchema } } },
    async (req) =>
      inSite(req.params.slug, async (tx) => {
        const site = await siteOf(tx);
        // Bookings whose guest paid but never came back to the site are saved here too.
        if (deps.cards) await settleStaleSiteBookings(tx, deps.cards);
        const homes = await homesOf(tx);
        const ids = homes.map((h) => h.id);
        const { today } = nowIn(site.timeZone, now());
        const covers = await coversOf(tx, ids);
        const own = await ownOf(tx, ids, today, addDays(today, SITE_FROM_PRICE_DAYS));
        const q = req.query;
        const party: SiteParty = { adults: q.adults, children: q.children, infants: q.infants, pets: q.pets };
        const cards: SiteHomeCard[] = [];
        for (const h of homes) {
          let stay: SiteHomeCard['stay'] = null;
          if (q.checkIn && q.checkOut) {
            const quote = await quoteFor(
              tx,
              h,
              { checkIn: q.checkIn, checkOut: q.checkOut },
              party,
              site,
              now(),
            );
            stay = quote.ok
              ? { totalMinor: quote.totalMinor, message: null }
              : { totalMinor: null, message: quote.message };
          } else if (party.adults + party.children > h.maxGuests) {
            stay = { totalMinor: null, message: `Sleeps up to ${h.maxGuests}.` };
          }
          cards.push({ ...card(h, covers.get(h.id) ?? null, fromPrice(h, own.get(h.id), today)), stay });
        }
        return {
          slug: site.slug,
          brand: site.brand,
          currency: site.currency,
          terms: site.terms,
          ...payment(),
          homes: cards,
        } satisfies Site;
      }),
  );

  /** A home's page: photos, what it's like, rules and the usual price. */
  typed.get(
    '/v1/site/:slug/homes/:homeId',
    { schema: { params: HomeParams, response: { 200: SiteHomeSchema } } },
    async (req) =>
      inSite(req.params.slug, async (tx) => {
        const site = await siteOf(tx);
        const [h] = await homesOf(tx, req.params.homeId);
        if (!h) throw homeNotFound();
        const { today } = nowIn(site.timeZone, now());
        const photos = await tx
          .select({ url: propertyPhotos.url, caption: propertyPhotos.caption })
          .from(propertyPhotos)
          .where(eq(propertyPhotos.propertyId, h.id))
          .orderBy(asc(propertyPhotos.position));
        const amenities = await tx
          .select({ code: propertyAmenities.code })
          .from(propertyAmenities)
          .where(eq(propertyAmenities.propertyId, h.id));
        const own = await ownOf(tx, [h.id], today, addDays(today, SITE_FROM_PRICE_DAYS));
        const sections: { title: string; text: string }[] = [];
        for (const [title, text] of [
          ['The space', h.theSpace],
          ['Guest access', h.guestAccess],
          ['The neighbourhood', h.neighbourhood],
          ['Getting around', h.gettingAround],
          ['Other things to note', h.otherNotes],
        ] as [string, string | null][]) {
          if (text) sections.push({ title, text });
        }
        const rules = [
          h.petsAllowed ? 'Pets allowed' : 'No pets',
          h.smokingAllowed ? 'Smoking allowed' : 'No smoking',
          h.eventsAllowed ? 'Events allowed' : 'No parties or events',
          h.childrenAllowed ? 'Suitable for children' : 'Not suitable for children',
          ...(h.houseRules
            ? h.houseRules
                .split(/\n+/)
                .map((l) => l.trim())
                .filter(Boolean)
            : []),
        ];
        const policy =
          h.cancellationPolicy && isCancellationPolicy(h.cancellationPolicy)
            ? h.cancellationPolicy
            : 'moderate';
        return {
          ...card(h, photos[0]?.url ?? null, fromPrice(h, own.get(h.id), today)),
          slug: site.slug,
          brand: site.brand,
          currency: site.currency,
          terms: site.terms,
          ...payment(),
          photos,
          sections,
          amenities: amenities
            .map((a) => amenity(a.code)?.label)
            .filter((l): l is string => Boolean(l))
            .sort((a, b) => a.localeCompare(b)),
          rules,
          checkInTime: (h.checkInTime ?? '15:00').slice(0, 5),
          checkOutTime: (h.checkOutTime ?? '10:00').slice(0, 5),
          minNights: h.minNights ?? 1,
          cancellation: CANCELLATION_POLICY_LABELS[policy],
          cleaningFeeMinor: h.cleaningFeeMinor,
          childrenAllowed: h.childrenAllowed ?? true,
        } satisfies SiteHome;
      }),
  );

  /** The calendar on a home's page: each night free or not, its price and stay rules. */
  typed.get(
    '/v1/site/:slug/homes/:homeId/nights',
    {
      schema: { params: HomeParams, querystring: SiteNightsQuerySchema, response: { 200: SiteNightsSchema } },
    },
    async (req) =>
      inSite(req.params.slug, async (tx) => {
        const { from, to } = req.query;
        if (to < from || eachNight(from, to).length > SITE_NIGHTS_WINDOW)
          throw new HttpError(400, 'window', `Ask for ${SITE_NIGHTS_WINDOW} nights at most.`);
        const site = await siteOf(tx);
        const [h] = await homesOf(tx, req.params.homeId);
        if (!h) throw homeNotFound();
        const taken = await takenOf(tx, [h.id], from, addDays(to, 1));
        const own = await ownOf(tx, [h.id], from, to);
        const held = taken.get(h.id) ?? [];
        const nights = [...eachNight(from, to), to].map((night) => {
          const r = nightRules(rulesOf(h).usual, night, own.get(h.id)?.get(night));
          return {
            night,
            free: !held.some((t) => t.from <= night && night < t.to),
            priceMinor: r.priceMinor,
            minNights: r.minNights,
            closedToArrival: r.closedToArrival,
            closedToDeparture: r.closedToDeparture,
          };
        });
        return { today: nowIn(site.timeZone, now()).today, nights } satisfies SiteNights;
      }),
  );

  /** The price for a stay, or why it can't be booked. */
  typed.post(
    '/v1/site/:slug/quote',
    { schema: { params: SiteSlugParams, body: SiteQuoteRequestSchema, response: { 200: SiteQuoteSchema } } },
    async (req) =>
      inSite(req.params.slug, async (tx) => {
        const site = await siteOf(tx);
        const [h] = await homesOf(tx, req.body.homeId);
        if (!h) throw homeNotFound();
        return quoteFor(tx, h, req.body, req.body, site, now());
      }),
  );

  /** Book: the price is worked out again here, then the guest goes to Stripe's page to pay. */
  typed.post(
    '/v1/site/:slug/book',
    {
      schema: { params: SiteSlugParams, body: SiteBookRequestSchema, response: { 201: SiteBookLinkSchema } },
    },
    async (req, reply) => {
      const gateway = deps.cards;
      if (!gateway)
        throw new HttpError(503, 'cards_off', 'Online payment isn’t switched on yet. Contact us to book.');
      return inSite(req.params.slug, async (tx, orgId) => {
        const b = req.body;
        const site = await siteOf(tx);
        const [h] = await homesOf(tx, b.homeId);
        if (!h) throw homeNotFound();
        const quote = await quoteFor(tx, h, b, b, site, now());
        if (!quote.ok) throw new HttpError(409, quote.reason, quote.message);
        const id = crypto.randomUUID();
        const base = `${deps.appUrl}/book/${site.slug}`;
        const created = await gateway
          .createCheckout({
            kind: 'booking',
            amountMinor: quote.totalMinor,
            currency: site.currency,
            description: `${h.title || h.name}, ${b.checkIn} to ${b.checkOut} (${quote.nights} ${quote.nights === 1 ? 'night' : 'nights'})`,
            successUrl: `${base}/done/${id}`,
            cancelUrl: `${base}/done/${id}`,
            customerEmail: b.email,
            metadata: { v01_org: orgId, v01_site_booking: id },
            idempotencyKey: `v01-site-${id}`,
            expiresInMinutes: SITE_CHECKOUT_MINUTES,
          })
          .catch((error: unknown) => {
            if (error instanceof CardError)
              throw new HttpError(502, 'card_provider', 'The payment page couldn’t be opened. Try again.');
            throw error;
          });
        await tx.insert(siteBookings).values({
          id,
          organisationId: orgId,
          propertyId: h.id,
          checkIn: b.checkIn,
          checkOut: b.checkOut,
          adults: b.adults,
          children: b.children,
          infants: b.infants,
          pets: b.pets,
          guestName: `${b.firstName} ${b.lastName}`.slice(0, 120),
          email: b.email.toLowerCase(),
          phone: b.phone || null,
          request: b.request || null,
          currency: site.currency,
          nightsMinor: quote.nightsMinor,
          cleaningMinor: quote.cleaningMinor,
          extraGuestsMinor: quote.extraGuestsMinor,
          serviceMinor: quote.serviceMinor,
          totalMinor: quote.totalMinor,
          sessionId: created.sessionId,
          url: created.url,
          expiresAt: created.expiresAt,
          live: gateway.live,
        });
        reply.code(201);
        return { bookingId: id, url: created.url };
      });
    },
  );

  /** Where a booking stands, for the page the guest comes back to from Stripe. */
  typed.get(
    '/v1/site/:slug/bookings/:bookingId',
    { schema: { params: BookingParams, response: { 200: SiteBookingSchema } } },
    async (req) =>
      inSite(req.params.slug, async (tx) => {
        if (deps.cards) await settleSiteBooking(tx, deps.cards, req.params.bookingId, req.log);
        const [row] = await tx
          .select({
            status: siteBookings.status,
            home: sql<string>`coalesce(${properties.title}, ${properties.name})`,
            checkIn: siteBookings.checkIn,
            checkOut: siteBookings.checkOut,
            totalMinor: siteBookings.totalMinor,
            currency: siteBookings.currency,
            email: siteBookings.email,
            url: siteBookings.url,
            guestKey: reservations.guestKey,
          })
          .from(siteBookings)
          .innerJoin(properties, eq(properties.id, siteBookings.propertyId))
          .leftJoin(reservations, eq(reservations.id, siteBookings.reservationId))
          .where(eq(siteBookings.id, req.params.bookingId));
        if (!row) throw new HttpError(404, 'booking_not_found', 'That booking isn’t on this site.');
        return {
          status: row.status as (typeof row)['status'] & ('open' | 'booked' | 'refused' | 'expired'),
          home: row.home,
          checkIn: row.checkIn,
          checkOut: row.checkOut,
          totalMinor: row.totalMinor,
          currency: row.currency,
          email: row.email,
          stayPath: row.status === 'booked' && row.guestKey ? `/stay/${row.guestKey}` : null,
          url: row.status === 'open' ? row.url : null,
        };
      }),
  );
}

/** The team's side: switch the site on, its service fee and terms, and how many homes are on it. */
export function bookingSiteSettingsRoutes(
  app: FastifyInstance,
  deps: { scope: RequestScope; cards: CardGateway | null },
): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  async function read(tx: Tx): Promise<BookingSiteSettings> {
    const [row] = await tx
      .select({
        on: organisationSettings.bookingSite,
        serviceFeeBp: organisationSettings.bookingServiceFeeBp,
        terms: organisationSettings.bookingTerms,
        slug: organisations.slug,
      })
      .from(organisationSettings)
      .innerJoin(organisations, eq(organisations.id, organisationSettings.organisationId));
    if (!row) throw new HttpError(404, 'workspace_not_found', 'This workspace is not set up yet.');
    const [count] = await tx.select({ n: sql<number>`count(*)::int` }).from(properties).where(onSite);
    return { ...row, homesOn: count?.n ?? 0, canPay: Boolean(deps.cards) };
  }
  typed.get(
    '/v1/workspace/booking-site',
    { schema: { response: { 200: BookingSiteSettingsSchema } } },
    async (req) =>
      deps.scope.inOrg(req, 'workspace.read', async (tx) => {
        if (deps.cards) await settleStaleSiteBookings(tx, deps.cards);
        return read(tx);
      }),
  );
  typed.patch(
    '/v1/workspace/booking-site',
    { schema: { body: BookingSiteUpdateSchema, response: { 200: BookingSiteSettingsSchema } } },
    async (req) =>
      deps.scope.inOrg(req, 'workspace.manage', async (tx, ctx) => {
        const b = req.body;
        await tx
          .update(organisationSettings)
          .set({
            ...(b.on !== undefined ? { bookingSite: b.on } : {}),
            ...(b.serviceFeeBp !== undefined ? { bookingServiceFeeBp: b.serviceFeeBp } : {}),
            ...(b.terms !== undefined ? { bookingTerms: b.terms || null } : {}),
          })
          .where(eq(organisationSettings.organisationId, ctx.orgId));
        return read(tx);
      }),
  );
}
