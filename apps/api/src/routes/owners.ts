import { randomUUID } from 'node:crypto';
import {
  appUsers,
  claims,
  expenses,
  homeTerms,
  invitations,
  memberships,
  organisationSettings,
  ownerContracts,
  ownerStatements,
  owners,
  properties,
  type Tx,
} from '@v01/db';
import {
  type Channel,
  type Expense,
  ExpenseInputSchema,
  type ExpenseList,
  ExpenseListQuerySchema,
  ExpenseListSchema,
  ExpenseReceiptRegisterSchema,
  ExpenseReceiptUploadSchema,
  ExpenseSchema,
  ExpenseUpdateSchema,
  type Owner,
  OwnerHomesSchema,
  OwnerInputSchema,
  type OwnerList,
  OwnerListSchema,
  type OwnerMonth,
  OwnerMonthQuerySchema,
  OwnerMonthSchema,
  OwnerSchema,
  OwnerUpdateSchema,
  PhotoUploadTicketSchema,
  type StatementList,
  StatementListSchema,
  StatementMonthSchema,
  StatementPaidSchema,
  todayIn,
} from '@v01/shared';
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, type SQL, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { type RequestScope, toIso } from '../context.ts';
import { HttpError } from '../errors.ts';
import type { PhotoStore } from '../photos.ts';

/**
 * Owners and expenses (built 30 Oct 2026). Owners: who owns which home, and their management fee;
 * an owner's month is the draft of their statement. Expenses: money spent on a home or the
 * business, charged on to the owner or kept by the company, with the receipt kept as uploaded.
 */

const Params = z.object({ id: z.uuid() });
const StatementParams = z.object({ id: z.uuid(), month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) });

const RECEIPT_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'application/pdf': 'pdf',
};
const receiptPath = (orgId: string, expenseId: string, type: string) =>
  `${orgId}/expenses/${expenseId}/${randomUUID()}.${RECEIPT_EXT[type] ?? 'bin'}`;
const receiptPathBelongs = (path: string, orgId: string, expenseId: string) =>
  /^[0-9a-f-]{36}\/expenses\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp|heic|pdf)$/.test(path) &&
  path.startsWith(`${orgId}/expenses/${expenseId}/`);

export const monthOf = (m: string) => {
  const [y, mo] = m.split('-').map(Number) as [number, number];
  const next = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
  return { first: `${m}-01`, next: `${next}-01` };
};

export async function settingsOf(tx: Tx, now?: Date): Promise<{ today: string; currency: string }> {
  const [s] = await tx
    .select({ timeZone: organisationSettings.timeZone, currency: organisationSettings.currency })
    .from(organisationSettings);
  return { today: todayIn(s?.timeZone ?? 'Europe/London', now), currency: s?.currency ?? 'GBP' };
}

// Owners -----------------------------------------------------------------------------------------

export async function loadOwners(tx: Tx, where?: SQL): Promise<Owner[]> {
  const rows = await tx.select().from(owners).where(where).orderBy(asc(owners.name));
  if (!rows.length) return [];
  const homes = await tx
    .select({ id: properties.id, name: properties.name, ownerId: properties.ownerId })
    .from(properties)
    .where(
      and(
        inArray(
          properties.ownerId,
          rows.map((r) => r.id),
        ),
        isNull(properties.archivedAt),
      ),
    )
    .orderBy(asc(properties.name));
  const ids = rows.map((r) => r.id);
  const logins = await tx
    .select({
      ownerId: memberships.ownerId,
      userId: appUsers.id,
      name: sql<string>`coalesce(${appUsers.fullName}, ${appUsers.email})`,
      email: appUsers.email,
    })
    .from(memberships)
    .innerJoin(appUsers, eq(appUsers.id, memberships.userId))
    .where(and(eq(memberships.role, 'owner'), inArray(memberships.ownerId, ids)));
  const invited = await tx
    .select({
      ownerId: invitations.ownerId,
      id: invitations.id,
      email: invitations.email,
      expiresAt: invitations.expiresAt,
    })
    .from(invitations)
    .where(
      and(
        inArray(invitations.ownerId, ids),
        isNull(invitations.acceptedAt),
        sql`(${invitations.expiresAt} is null or ${invitations.expiresAt} > now())`,
      ),
    );
  const contracts = await tx
    .select({ ownerId: ownerContracts.ownerId })
    .from(ownerContracts)
    .where(inArray(ownerContracts.ownerId, ids));
  const termed = new Set(
    (
      await tx
        .selectDistinct({ propertyId: homeTerms.propertyId })
        .from(homeTerms)
        .where(
          inArray(
            homeTerms.propertyId,
            homes.map((h) => h.id),
          ),
        )
    ).map((r) => r.propertyId),
  );
  return rows.map((o) => ({
    id: o.id,
    name: o.name,
    company: o.company,
    email: o.email,
    phone: o.phone,
    feeBasisPoints: o.feeBasisPoints,
    notes: o.notes,
    homes: homes.filter((h) => h.ownerId === o.id).map((h) => ({ id: h.id, name: h.name })),
    logins: logins
      .filter((l) => l.ownerId === o.id)
      .map(({ userId, name, email }) => ({ userId, name, email })),
    invited: invited
      .filter((i) => i.ownerId === o.id)
      .map((i) => ({ id: i.id, email: i.email, expiresAt: i.expiresAt ? toIso(String(i.expiresAt)) : null })),
    setup: {
      contract: contracts.some((c) => c.ownerId === o.id),
      homesWithoutTerms: homes.filter((h) => h.ownerId === o.id && !termed.has(h.id)).length,
    },
    createdAt: toIso(String(o.createdAt)),
  }));
}

export async function oneOwner(tx: Tx, id: string): Promise<Owner> {
  const [owner] = await loadOwners(tx, eq(owners.id, id));
  if (!owner) throw new HttpError(404, 'owner_not_found', 'That owner is not in this workspace.');
  return owner;
}

// Expenses ---------------------------------------------------------------------------------------

async function loadExpenses(tx: Tx, where: SQL | undefined, store: PhotoStore): Promise<Expense[]> {
  const rows = await tx
    .select({
      e: expenses,
      propertyName: properties.name,
      ownerName: owners.name,
      createdBy: sql<string | null>`coalesce(${appUsers.fullName}, ${appUsers.email})`,
    })
    .from(expenses)
    .leftJoin(properties, eq(properties.id, expenses.propertyId))
    .leftJoin(owners, eq(owners.id, properties.ownerId))
    .leftJoin(appUsers, eq(appUsers.id, expenses.createdBy))
    .where(where)
    .orderBy(desc(expenses.spentOn), desc(expenses.createdAt));
  const withReceipt = rows.filter((r) => r.e.receiptPath);
  const signed = withReceipt.length
    ? await store.viewUrls(withReceipt.map((r) => r.e.receiptPath as string))
    : [];
  const urlOf = new Map(
    withReceipt.map((r, i) => [r.e.id, signed[i] ?? store.publicUrl(r.e.receiptPath as string)]),
  );
  return rows.map(({ e, propertyName, ownerName, createdBy }) => ({
    id: e.id,
    spentOn: e.spentOn,
    category: e.category as Expense['category'],
    description: e.description,
    vendor: e.vendor,
    amountMinor: Number(e.amountMinor),
    currency: e.currency,
    chargeTo: e.chargeTo as Expense['chargeTo'],
    propertyId: e.propertyId,
    propertyName: propertyName ?? null,
    ownerName: ownerName ?? null,
    claimId: e.claimId,
    receipt:
      e.receiptPath && e.receiptName
        ? {
            fileName: e.receiptName,
            contentType: e.receiptType ?? 'application/octet-stream',
            bytes: Number(e.receiptBytes ?? 0),
            url: urlOf.get(e.id) ?? '',
          }
        : null,
    createdBy: createdBy ?? null,
    createdAt: toIso(String(e.createdAt)),
  }));
}

async function oneExpense(tx: Tx, id: string, store: PhotoStore): Promise<Expense> {
  const [e] = await loadExpenses(tx, eq(expenses.id, id), store);
  if (!e) throw new HttpError(404, 'expense_not_found', 'That expense is not in this workspace.');
  return e;
}

/** Linked home and claim must be in this workspace (row-level security hides the others). */
async function checkLinks(tx: Tx, propertyId?: string | null, claimId?: string | null): Promise<void> {
  if (propertyId) {
    const [p] = await tx.select({ id: properties.id }).from(properties).where(eq(properties.id, propertyId));
    if (!p) throw new HttpError(400, 'property_not_found', 'That property is not in this workspace.');
  }
  if (claimId) {
    const [c] = await tx.select({ id: claims.id }).from(claims).where(eq(claims.id, claimId));
    if (!c) throw new HttpError(400, 'claim_not_found', 'That claim is not in this workspace.');
  }
}

/** The month worked out live from bookings and expenses: what a draft statement shows. */
/** The terms each home is on in a month: the latest row from the month's first day or before. */
export async function termsInMonth(
  tx: Tx,
  ids: string[],
  month: string,
): Promise<Map<string, typeof homeTerms.$inferSelect>> {
  if (!ids.length) return new Map();
  const rows = await tx
    .select()
    .from(homeTerms)
    .where(and(inArray(homeTerms.propertyId, ids), lte(homeTerms.effectiveFrom, `${month}-01`)))
    .orderBy(desc(homeTerms.effectiveFrom));
  const map = new Map<string, typeof homeTerms.$inferSelect>();
  for (const r of rows) if (!map.has(r.propertyId)) map.set(r.propertyId, r);
  return map;
}

/**
 * An owner's month (reworked 1 Nov 2026). For each confirmed stay, the nights in the month take
 * their share of: what the guest paid, the channel's fee (the total less the payout), the cleaning
 * fee inside the payout (the company's, for the cleaner), and refunds (a stay refund lowers what the
 * home earned; a cleaning refund is the company's). What's left is what the home earned. Each
 * home's terms then give the owner's part: earnings less the fee, all of it (no fee, a board
 * member), or the fixed rent whatever was earned. Expenses charged to the owner come off; claim
 * money received for repairs they paid for comes back.
 */
async function computeMonth(
  tx: Tx,
  owner: Owner,
  month: string,
  currency: string,
  store: PhotoStore,
  options: { lines?: boolean } = {},
): Promise<OwnerMonth> {
  const { first, next } = monthOf(month);
  const ids = owner.homes.map((h) => h.id);
  const stays = ids.length
    ? (
        await tx.execute<{
          id: string;
          property_id: string;
          guest_name: string | null;
          channel: Channel;
          check_in: string;
          check_out: string;
          all_nights: number;
          nights: number;
          total: number;
          payout: number | null;
          cleaning: number | null;
          stay_refunds: number;
        }>(sql`
          select r.id, r.property_id, g.full_name as guest_name, r.channel, r.check_in::text, r.check_out::text,
                 greatest(r.check_out - r.check_in, 1) as all_nights,
                 count(*)::int as nights,
                 r.total_minor as total, r.payout_minor as payout, r.cleaning_minor as cleaning,
                 coalesce((select -sum(p.amount_minor) from app.reservation_payments p
                            where p.reservation_id = r.id and p.refund_for = 'stay'), 0)::bigint as stay_refunds
            from app.reservations r
            left join app.guests g on g.id = r.guest_id
            cross join lateral generate_series(r.check_in, r.check_out - 1, interval '1 day') n
           where r.status = 'confirmed' and r.total_minor is not null
             and r.property_id in ${ids}
             and n >= ${first}::date and n < ${next}::date
           group by r.id, g.full_name
           order by r.check_in`)
      ).rows
    : [];
  const lines = stays.map((x) => {
    const part = Number(x.nights) / Number(x.all_nights);
    const total = Number(x.total);
    const payout = x.payout === null ? total : Math.min(Number(x.payout), total);
    const cleaningOfPayout = total > 0 ? Math.round((Number(x.cleaning ?? 0) * payout) / total) : 0;
    const refunds = Number(x.stay_refunds);
    const share = (v: number) => Math.round(v * part);
    return {
      x,
      grossMinor: share(total),
      channelFeesMinor: share(total - payout),
      cleaningMinor: share(cleaningOfPayout),
      refundsMinor: share(refunds),
      earnedMinor: share(payout - cleaningOfPayout - refunds),
    };
  });
  const list =
    ids.length && options.lines !== false
      ? await loadExpenses(
          tx,
          and(
            inArray(expenses.propertyId, ids),
            eq(expenses.chargeTo, 'owner'),
            gte(expenses.spentOn, first),
            lt(expenses.spentOn, next),
          ),
          store,
        )
      : [];
  const spentRows =
    ids.length && options.lines === false
      ? await tx
          .select({ propertyId: expenses.propertyId, amount: expenses.amountMinor })
          .from(expenses)
          .where(
            and(
              inArray(expenses.propertyId, ids),
              eq(expenses.chargeTo, 'owner'),
              gte(expenses.spentOn, first),
              lt(expenses.spentOn, next),
            ),
          )
      : list.map((e) => ({ propertyId: e.propertyId, amount: e.amountMinor }));
  // Claim money received this month, paid back up to the repairs the owner was charged for.
  const credits = ids.length
    ? (
        await tx.execute<{ id: string; property_id: string; received_on: string; credit: number }>(sql`
          select c.id, r.property_id, c.received_on::text,
                 least(c.received_minor, coalesce((select sum(e.amount_minor) from app.expenses e
                                                    where e.claim_id = c.id and e.charge_to = 'owner'), 0))::bigint as credit
            from app.claims c join app.reservations r on r.id = c.reservation_id
           where r.property_id in ${ids} and c.received_minor > 0
             and c.received_on >= ${first}::date and c.received_on < ${next}::date`)
      ).rows.filter((c) => Number(c.credit) > 0)
    : [];
  const terms = await termsInMonth(tx, ids, month);
  const sum = <T>(rows: T[], f: (r: T) => number) => rows.reduce((t, r) => t + f(r), 0);
  const homes = owner.homes.map((h) => {
    const mine = lines.filter((l) => l.x.property_id === h.id);
    const t = terms.get(h.id);
    const earned = sum(mine, (l) => l.earnedMinor);
    const deal = (t?.deal ?? 'owner_fee') as 'percentage' | 'fixed_rent' | 'no_fee' | 'owner_fee';
    const bp =
      deal === 'percentage' ? (t?.feeBasisPoints ?? 0) : deal === 'owner_fee' ? owner.feeBasisPoints : null;
    const fee = bp === null ? 0 : Math.round((Math.max(0, earned) * bp) / 10_000);
    const rent = deal === 'fixed_rent' ? Number(t?.rentMinor ?? 0) : 0;
    return {
      id: h.id,
      name: h.name,
      nights: sum(mine, (l) => Number(l.x.nights)),
      deal,
      feeBasisPoints: bp,
      grossMinor: sum(mine, (l) => l.grossMinor),
      channelFeesMinor: sum(mine, (l) => l.channelFeesMinor),
      cleaningMinor: sum(mine, (l) => l.cleaningMinor),
      refundsMinor: sum(mine, (l) => l.refundsMinor),
      earnedMinor: earned,
      feeMinor: fee,
      rentMinor: rent,
      ownerShareMinor: deal === 'fixed_rent' ? rent : earned - fee,
      expensesMinor: sum(
        spentRows.filter((x) => x.propertyId === h.id),
        (x) => Number(x.amount),
      ),
    };
  });
  const nameOf = new Map(owner.homes.map((h) => [h.id, h.name]));
  const total = (k: keyof (typeof homes)[number]) => sum(homes, (h) => Number(h[k] ?? 0));
  const ownerShareMinor = total('ownerShareMinor');
  const expensesMinor = sum(spentRows, (x) => Number(x.amount));
  const claimCreditsMinor = sum(credits, (c) => Number(c.credit));
  return {
    owner,
    month,
    currency,
    homes,
    grossMinor: total('grossMinor'),
    channelFeesMinor: total('channelFeesMinor'),
    cleaningMinor: total('cleaningMinor'),
    refundsMinor: total('refundsMinor'),
    earnedMinor: total('earnedMinor'),
    feeMinor: total('feeMinor'),
    rentMinor: total('rentMinor'),
    ownerShareMinor,
    expensesMinor,
    claimCreditsMinor,
    claimCredits: credits.map((c) => ({
      claimId: c.id,
      propertyName: nameOf.get(c.property_id) ?? '',
      receivedOn: c.received_on,
      creditMinor: Number(c.credit),
    })),
    netMinor: ownerShareMinor - expensesMinor + claimCreditsMinor,
    expenses: list,
    bookings: lines.map((l) => ({
      reservationId: l.x.id,
      propertyId: l.x.property_id,
      propertyName: nameOf.get(l.x.property_id) ?? '',
      guestName: l.x.guest_name,
      channel: l.x.channel,
      checkIn: l.x.check_in,
      checkOut: l.x.check_out,
      nights: Number(l.x.nights),
      grossMinor: l.grossMinor,
      channelFeesMinor: l.channelFeesMinor,
      cleaningMinor: l.cleaningMinor,
      refundsMinor: l.refundsMinor,
      earnedMinor: l.earnedMinor,
    })),
    statement: null,
  };
}

/** A finalised statement as saved, with receipt addresses signed afresh (they only last a while). */
export async function savedStatement(
  tx: Tx,
  ownerId: string,
  month: string,
  store: PhotoStore,
): Promise<OwnerMonth | null> {
  const [row] = await tx
    .select({ s: ownerStatements, by: sql<string | null>`coalesce(${appUsers.fullName}, ${appUsers.email})` })
    .from(ownerStatements)
    .leftJoin(appUsers, eq(appUsers.id, ownerStatements.finalisedBy))
    .where(and(eq(ownerStatements.ownerId, ownerId), eq(ownerStatements.month, month)));
  if (!row) return null;
  const snap = row.s.snapshot as Omit<OwnerMonth, 'statement'>;
  const ids = snap.expenses.map((e) => e.id);
  const fresh = ids.length ? await loadExpenses(tx, inArray(expenses.id, ids), store) : [];
  const receiptOf = new Map(fresh.map((e) => [e.id, e.receipt]));
  return {
    ...snap,
    // Statements saved before owner log-ins existed have no list of them.
    owner: {
      ...snap.owner,
      logins: snap.owner.logins ?? [],
      invited: snap.owner.invited ?? [],
      setup: snap.owner.setup ?? { contract: false, homesWithoutTerms: 0 },
    },
    expenses: snap.expenses.map((e) => ({ ...e, receipt: receiptOf.get(e.id) ?? null })),
    statement: {
      status: row.s.status as 'final' | 'paid',
      finalisedAt: toIso(String(row.s.finalisedAt)),
      finalisedBy: row.by ?? null,
      paidOn: row.s.paidOn,
      paidReference: row.s.paidReference,
    },
  };
}

export function ownerRoutes(
  app: FastifyInstance,
  deps: { scope: RequestScope; files: PhotoStore; bucket: string; now?: () => Date },
) {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get('/v1/owners', { schema: { response: { 200: OwnerListSchema } } }, async (req) =>
    deps.scope.inOrg(req, 'owners.read', async (tx): Promise<OwnerList> => {
      const unowned = await tx
        .select({ id: properties.id, name: properties.name })
        .from(properties)
        .where(and(isNull(properties.ownerId), isNull(properties.archivedAt)))
        .orderBy(asc(properties.name));
      return { owners: await loadOwners(tx), unowned };
    }),
  );

  typed.post(
    '/v1/owners',
    { schema: { body: OwnerInputSchema, response: { 201: OwnerSchema } } },
    async (req, reply) =>
      deps.scope.inOrg(req, 'owners.write', async (tx, ctx) => {
        const b = req.body;
        const [row] = await tx
          .insert(owners)
          .values({
            organisationId: ctx.orgId,
            name: b.name,
            company: b.company ?? null,
            email: b.email ?? null,
            phone: b.phone ?? null,
            feeBasisPoints: b.feeBasisPoints ?? 0,
            notes: b.notes ?? null,
          })
          .returning({ id: owners.id });
        if (!row) throw new Error('Inserting the owner returned nothing.');
        reply.code(201);
        return await oneOwner(tx, row.id);
      }),
  );

  typed.patch(
    '/v1/owners/:id',
    { schema: { params: Params, body: OwnerUpdateSchema, response: { 200: OwnerSchema } } },
    async (req) =>
      deps.scope.inOrg(req, 'owners.write', async (tx) => {
        await oneOwner(tx, req.params.id);
        const set = Object.fromEntries(Object.entries(req.body).filter(([, v]) => v !== undefined));
        await tx.update(owners).set(set).where(eq(owners.id, req.params.id));
        return oneOwner(tx, req.params.id);
      }),
  );

  typed.delete('/v1/owners/:id', { schema: { params: Params } }, async (req, reply) =>
    deps.scope.inOrg(req, 'owners.write', async (tx) => {
      await oneOwner(tx, req.params.id);
      // Their homes stay; they just have nobody recorded as owner.
      await tx.update(properties).set({ ownerId: null }).where(eq(properties.ownerId, req.params.id));
      await tx.delete(owners).where(eq(owners.id, req.params.id));
      reply.code(204);
      return null;
    }),
  );

  /** Which homes are theirs: the list given, and no others. */
  typed.put(
    '/v1/owners/:id/homes',
    { schema: { params: Params, body: OwnerHomesSchema, response: { 200: OwnerSchema } } },
    async (req) =>
      deps.scope.inOrg(req, 'owners.write', async (tx) => {
        await oneOwner(tx, req.params.id);
        const ids = [...new Set(req.body.propertyIds)];
        if (ids.length) {
          const found = await tx
            .select({ id: properties.id })
            .from(properties)
            .where(inArray(properties.id, ids));
          if (found.length !== ids.length)
            throw new HttpError(
              400,
              'property_not_found',
              'One of those properties is not in this workspace.',
            );
        }
        await tx
          .update(properties)
          .set({ ownerId: null })
          .where(
            ids.length
              ? and(eq(properties.ownerId, req.params.id), sql`${properties.id} not in ${ids}`)
              : eq(properties.ownerId, req.params.id),
          );
        if (ids.length)
          await tx.update(properties).set({ ownerId: req.params.id }).where(inArray(properties.id, ids));
        return oneOwner(tx, req.params.id);
      }),
  );

  /** An owner's month: the draft of their statement, or the statement as finalised. */
  typed.get(
    '/v1/owners/:id/month',
    { schema: { params: Params, querystring: OwnerMonthQuerySchema, response: { 200: OwnerMonthSchema } } },
    async (req) =>
      deps.scope.inOrg(req, 'owners.read', async (tx): Promise<OwnerMonth> => {
        const owner = await oneOwner(tx, req.params.id);
        const { today, currency } = await settingsOf(tx, deps.now?.());
        const month = req.query.month ?? today.slice(0, 7);
        return (
          (await savedStatement(tx, owner.id, month, deps.files)) ??
          computeMonth(tx, owner, month, currency, deps.files)
        );
      }),
  );

  /** Finalise: save the month's figures as they are now; later changes don't move them. */
  typed.post(
    '/v1/owners/:id/statements',
    { schema: { params: Params, body: StatementMonthSchema, response: { 201: OwnerMonthSchema } } },
    async (req, reply) =>
      deps.scope.inOrg(req, 'owners.write', async (tx, ctx) => {
        const owner = await oneOwner(tx, req.params.id);
        const { month } = req.body;
        const [existing] = await tx
          .select({ id: ownerStatements.id })
          .from(ownerStatements)
          .where(and(eq(ownerStatements.ownerId, owner.id), eq(ownerStatements.month, month)));
        if (existing) throw new HttpError(409, 'statement_final', 'That month is already finalised.');
        const { currency } = await settingsOf(tx);
        const live = await computeMonth(tx, owner, month, currency, deps.files);
        const { statement: _none, ...snapshot } = live;
        await tx.insert(ownerStatements).values({
          organisationId: ctx.orgId,
          ownerId: owner.id,
          month,
          snapshot,
          earnedMinor: live.earnedMinor,
          feeMinor: live.feeMinor,
          expensesMinor: live.expensesMinor,
          netMinor: live.netMinor,
          finalisedBy: ctx.userId,
        });
        reply.code(201);
        return (await savedStatement(tx, owner.id, month, deps.files)) as OwnerMonth;
      }),
  );

  /** Paid: the day the money went to the owner, and the bank reference. */
  typed.put(
    '/v1/owners/:id/statements/:month/paid',
    { schema: { params: StatementParams, body: StatementPaidSchema, response: { 200: OwnerMonthSchema } } },
    async (req) =>
      deps.scope.inOrg(req, 'owners.write', async (tx) => {
        await oneOwner(tx, req.params.id);
        const done = await tx
          .update(ownerStatements)
          .set({
            status: 'paid',
            paidOn: req.body.paidOn,
            paidReference: req.body.paidReference?.trim() || null,
          })
          .where(and(eq(ownerStatements.ownerId, req.params.id), eq(ownerStatements.month, req.params.month)))
          .returning({ id: ownerStatements.id });
        if (!done.length)
          throw new HttpError(409, 'statement_draft', 'Finalise the statement before marking it paid.');
        return (await savedStatement(tx, req.params.id, req.params.month, deps.files)) as OwnerMonth;
      }),
  );

  typed.delete(
    '/v1/owners/:id/statements/:month/paid',
    { schema: { params: StatementParams, response: { 200: OwnerMonthSchema } } },
    async (req) =>
      deps.scope.inOrg(req, 'owners.write', async (tx) => {
        await oneOwner(tx, req.params.id);
        await tx
          .update(ownerStatements)
          .set({ status: 'final', paidOn: null, paidReference: null })
          .where(
            and(eq(ownerStatements.ownerId, req.params.id), eq(ownerStatements.month, req.params.month)),
          );
        return (await savedStatement(tx, req.params.id, req.params.month, deps.files)) as OwnerMonth;
      }),
  );

  /** Reopen: back to a live draft. Not once it's paid. */
  typed.delete(
    '/v1/owners/:id/statements/:month',
    { schema: { params: StatementParams, response: { 200: OwnerMonthSchema } } },
    async (req) =>
      deps.scope.inOrg(req, 'owners.write', async (tx) => {
        const owner = await oneOwner(tx, req.params.id);
        const [row] = await tx
          .select({ status: ownerStatements.status })
          .from(ownerStatements)
          .where(and(eq(ownerStatements.ownerId, owner.id), eq(ownerStatements.month, req.params.month)));
        if (row?.status === 'paid')
          throw new HttpError(409, 'statement_paid', 'It’s marked paid. Mark it unpaid before reopening it.');
        await tx
          .delete(ownerStatements)
          .where(and(eq(ownerStatements.ownerId, owner.id), eq(ownerStatements.month, req.params.month)));
        const { currency } = await settingsOf(tx);
        return computeMonth(tx, owner, req.params.month, currency, deps.files);
      }),
  );

  /** Every owner's month: what's still a draft, what's final, what's paid. */
  typed.get(
    '/v1/statements',
    { schema: { querystring: OwnerMonthQuerySchema, response: { 200: StatementListSchema } } },
    async (req) =>
      deps.scope.inOrg(req, 'owners.read', async (tx): Promise<StatementList> => {
        const { today, currency } = await settingsOf(tx, deps.now?.());
        const month = req.query.month ?? today.slice(0, 7);
        const all = await loadOwners(tx);
        const saved = await tx.select().from(ownerStatements).where(eq(ownerStatements.month, month));
        const rows: StatementList['statements'] = [];
        for (const o of all) {
          const s = saved.find((x) => x.ownerId === o.id);
          const f = s
            ? {
                earnedMinor: Number(s.earnedMinor),
                feeMinor: Number(s.feeMinor),
                expensesMinor: Number(s.expensesMinor),
                netMinor: Number(s.netMinor),
              }
            : await computeMonth(tx, o, month, currency, deps.files, { lines: false });
          rows.push({
            ownerId: o.id,
            ownerName: o.name,
            homes: o.homes.length,
            earnedMinor: f.earnedMinor,
            feeMinor: f.feeMinor,
            expensesMinor: f.expensesMinor,
            netMinor: f.netMinor,
            status: (s?.status ?? 'draft') as StatementList['statements'][number]['status'],
            paidOn: s?.paidOn ?? null,
          });
        }
        const sum = (k: 'earnedMinor' | 'feeMinor' | 'expensesMinor' | 'netMinor') =>
          rows.reduce((t, r) => t + r[k], 0);
        return {
          month,
          currency,
          statements: rows,
          totals: {
            earnedMinor: sum('earnedMinor'),
            feeMinor: sum('feeMinor'),
            expensesMinor: sum('expensesMinor'),
            netMinor: sum('netMinor'),
          },
        };
      }),
  );

  // Expenses -------------------------------------------------------------------------------------

  typed.get(
    '/v1/expenses',
    { schema: { querystring: ExpenseListQuerySchema, response: { 200: ExpenseListSchema } } },
    async (req) =>
      deps.scope.inOrg(req, 'expenses.read', async (tx): Promise<ExpenseList> => {
        const { today, currency } = await settingsOf(tx, deps.now?.());
        const month = req.query.month ?? today.slice(0, 7);
        const { first, next } = monthOf(month);
        const list = await loadExpenses(
          tx,
          and(
            gte(expenses.spentOn, first),
            lt(expenses.spentOn, next),
            req.query.propertyId ? eq(expenses.propertyId, req.query.propertyId) : undefined,
            req.query.category ? eq(expenses.category, req.query.category) : undefined,
          ),
          deps.files,
        );
        const sum = (keep: (e: Expense) => boolean) =>
          list.filter(keep).reduce((s, e) => s + e.amountMinor, 0);
        const cats = [...new Set(list.map((e) => e.category))];
        return {
          month,
          currency,
          expenses: list,
          totalMinor: sum(() => true),
          ownerMinor: sum((e) => e.chargeTo === 'owner'),
          companyMinor: sum((e) => e.chargeTo === 'company'),
          byCategory: cats
            .map((category) => ({ category, amountMinor: sum((e) => e.category === category) }))
            .sort((a, b) => b.amountMinor - a.amountMinor),
        };
      }),
  );

  typed.post(
    '/v1/expenses',
    { schema: { body: ExpenseInputSchema, response: { 201: ExpenseSchema } } },
    async (req, reply) =>
      deps.scope.inOrg(req, 'expenses.write', async (tx, ctx) => {
        const b = req.body;
        await checkLinks(tx, b.propertyId, b.claimId);
        const { currency } = await settingsOf(tx);
        const [row] = await tx
          .insert(expenses)
          .values({
            organisationId: ctx.orgId,
            propertyId: b.propertyId ?? null,
            claimId: b.claimId ?? null,
            spentOn: b.spentOn,
            category: b.category,
            description: b.description,
            vendor: b.vendor ?? null,
            amountMinor: b.amountMinor,
            currency,
            // Nothing to charge on when it isn't for a home.
            chargeTo: b.propertyId ? b.chargeTo : 'company',
            createdBy: ctx.userId,
          })
          .returning({ id: expenses.id });
        if (!row) throw new Error('Inserting the expense returned nothing.');
        reply.code(201);
        return await oneExpense(tx, row.id, deps.files);
      }),
  );

  typed.patch(
    '/v1/expenses/:id',
    { schema: { params: Params, body: ExpenseUpdateSchema, response: { 200: ExpenseSchema } } },
    async (req) =>
      deps.scope.inOrg(req, 'expenses.write', async (tx) => {
        const current = await oneExpense(tx, req.params.id, deps.files);
        const b = req.body;
        await checkLinks(tx, b.propertyId, b.claimId);
        const set = Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined));
        const propertyId = b.propertyId !== undefined ? b.propertyId : current.propertyId;
        if (!propertyId) set.chargeTo = 'company';
        await tx.update(expenses).set(set).where(eq(expenses.id, req.params.id));
        return oneExpense(tx, req.params.id, deps.files);
      }),
  );

  typed.delete('/v1/expenses/:id', { schema: { params: Params } }, async (req, reply) =>
    deps.scope.inOrg(req, 'expenses.write', async (tx) => {
      const [e] = await tx
        .select({ path: expenses.receiptPath })
        .from(expenses)
        .where(eq(expenses.id, req.params.id));
      if (!e) throw new HttpError(404, 'expense_not_found', 'That expense is not in this workspace.');
      await tx.delete(expenses).where(eq(expenses.id, req.params.id));
      if (e.path) await deps.files.remove(e.path).catch(() => {});
      reply.code(204);
      return null;
    }),
  );

  typed.post(
    '/v1/expenses/:id/receipt/uploads',
    {
      schema: {
        params: Params,
        body: ExpenseReceiptUploadSchema,
        response: { 200: PhotoUploadTicketSchema },
      },
    },
    async (req) =>
      deps.scope.inOrg(req, 'expenses.write', async (tx, ctx) => {
        if (!deps.files.ready)
          throw new HttpError(
            503,
            'photo_storage_not_ready',
            "File storage isn't set up yet, so receipts can't be added.",
          );
        await oneExpense(tx, req.params.id, deps.files);
        try {
          return await deps.files.ticket(
            receiptPath(ctx.orgId, req.params.id, req.body.contentType),
            req.body.contentType,
          );
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          throw new HttpError(
            503,
            'photo_storage_refused',
            `File storage refused the upload: ${reason}. Check a private bucket named "${deps.bucket}" exists.`,
          );
        }
      }),
  );

  typed.put(
    '/v1/expenses/:id/receipt',
    { schema: { params: Params, body: ExpenseReceiptRegisterSchema, response: { 200: ExpenseSchema } } },
    async (req) =>
      deps.scope.inOrg(req, 'expenses.write', async (tx, ctx) => {
        const current = await tx
          .select({ path: expenses.receiptPath })
          .from(expenses)
          .where(eq(expenses.id, req.params.id));
        if (!current[0])
          throw new HttpError(404, 'expense_not_found', 'That expense is not in this workspace.');
        const b = req.body;
        if (!receiptPathBelongs(b.path, ctx.orgId, req.params.id))
          throw new HttpError(400, 'invalid_request', 'That receipt was not uploaded for this expense.');
        if (!(await deps.files.exists(b.path)))
          throw new HttpError(409, 'file_not_uploaded', "The receipt hasn't finished uploading. Try again.");
        await tx
          .update(expenses)
          .set({
            receiptPath: b.path,
            receiptName: b.fileName,
            receiptType: b.contentType,
            receiptBytes: b.bytes,
          })
          .where(eq(expenses.id, req.params.id));
        // One receipt per expense: a new one replaces the old.
        const old = current[0].path;
        if (old && old !== b.path) await deps.files.remove(old).catch(() => {});
        return oneExpense(tx, req.params.id, deps.files);
      }),
  );

  typed.delete(
    '/v1/expenses/:id/receipt',
    { schema: { params: Params, response: { 200: ExpenseSchema } } },
    async (req) =>
      deps.scope.inOrg(req, 'expenses.write', async (tx) => {
        const [e] = await tx
          .select({ path: expenses.receiptPath })
          .from(expenses)
          .where(eq(expenses.id, req.params.id));
        if (!e) throw new HttpError(404, 'expense_not_found', 'That expense is not in this workspace.');
        await tx
          .update(expenses)
          .set({ receiptPath: null, receiptName: null, receiptType: null, receiptBytes: null })
          .where(eq(expenses.id, req.params.id));
        if (e.path) await deps.files.remove(e.path).catch(() => {});
        return oneExpense(tx, req.params.id, deps.files);
      }),
  );
}

/** Costs recorded against a claim, for the claim page. */
export async function claimExpenses(tx: Tx, claimId: string, store: PhotoStore): Promise<Expense[]> {
  return loadExpenses(tx, eq(expenses.claimId, claimId), store);
}
