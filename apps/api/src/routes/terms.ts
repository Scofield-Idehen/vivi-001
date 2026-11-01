import { randomUUID } from 'node:crypto';
import { homePayees, homeTerms, organisationSettings, ownerContracts, properties, type Tx } from '@v01/db';
import type { SecretBox } from '@v01/integrations';
import {
  BankDetailsSchema,
  CleaningCostSchema,
  type Contract,
  ContractInputSchema,
  ContractRegisterSchema,
  ContractSchema,
  ContractUploadSchema,
  can,
  FileLinkSchema,
  type HomeTerms,
  HomeTermsInputSchema,
  HomeTermsSchema,
  type OwnerSetup,
  OwnerSetupSchema,
  PayeeInputSchema,
  PayeeSchema,
  PhotoUploadTicketSchema,
  todayIn,
} from '@v01/shared';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { type OrgContext, type RequestScope, toIso } from '../context.ts';
import { HttpError } from '../errors.ts';
import type { PhotoStore } from '../photos.ts';
import { oneOwner } from './owners.ts';

/**
 * What each owner signed and what each home pays them (built 1 Nov 2026): contracts, each home's
 * terms from a month on, who is paid and where (sealed; admins and accounts only), and the
 * cleaning cost of each home. The statements read these (routes/owners.ts).
 */

const Params = z.object({ id: z.uuid() });
const ContractParams = z.object({ id: z.uuid(), contractId: z.uuid() });

const CONTRACT_EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};
const contractPath = (orgId: string, contractId: string, type: string) =>
  `${orgId}/contracts/${contractId}/${randomUUID()}.${CONTRACT_EXT[type] ?? 'bin'}`;
const contractPathBelongs = (path: string, orgId: string, contractId: string) =>
  /^[0-9a-f-]{36}\/contracts\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(pdf|jpg|png)$/.test(path) &&
  path.startsWith(`${orgId}/contracts/${contractId}/`);

const toContract = (c: typeof ownerContracts.$inferSelect): Contract => ({
  id: c.id,
  title: c.title,
  signedOn: c.signedOn,
  startsOn: c.startsOn,
  endsOn: c.endsOn,
  sharedWithOwner: c.sharedWithOwner,
  file:
    c.filePath && c.fileName
      ? { name: c.fileName, contentType: c.fileType ?? 'application/pdf', bytes: Number(c.fileBytes ?? 0) }
      : null,
  createdAt: toIso(String(c.createdAt)),
});

const toTerms = (t: typeof homeTerms.$inferSelect): HomeTerms => ({
  id: t.id,
  from: t.effectiveFrom.slice(0, 7),
  deal: t.deal as HomeTerms['deal'],
  feeBasisPoints: t.feeBasisPoints,
  rentMinor: t.rentMinor === null ? null : Number(t.rentMinor),
  maintenanceBy: t.maintenanceBy as HomeTerms['maintenanceBy'],
  contractId: t.contractId,
});

async function ownerSetup(tx: Tx, ctx: OrgContext, ownerId: string, now?: Date): Promise<OwnerSetup> {
  const owner = await oneOwner(tx, ownerId);
  const ids = owner.homes.map((h) => h.id);
  const [settings] = await tx.select({ timeZone: organisationSettings.timeZone }).from(organisationSettings);
  const month = todayIn(settings?.timeZone ?? 'Europe/London', now).slice(0, 7);
  const contracts = await tx
    .select()
    .from(ownerContracts)
    .where(eq(ownerContracts.ownerId, ownerId))
    .orderBy(desc(ownerContracts.createdAt));
  const terms = ids.length
    ? await tx
        .select()
        .from(homeTerms)
        .where(inArray(homeTerms.propertyId, ids))
        .orderBy(desc(homeTerms.effectiveFrom))
    : [];
  const seePayees = can(ctx.role, 'payees.read');
  const payees =
    ids.length && seePayees
      ? await tx.select().from(homePayees).where(inArray(homePayees.propertyId, ids))
      : [];
  const costs = ids.length
    ? await tx
        .select({ id: properties.id, cost: properties.cleaningCostMinor })
        .from(properties)
        .where(inArray(properties.id, ids))
    : [];
  const homes = owner.homes.map((h) => {
    const history = terms.filter((t) => t.propertyId === h.id).map(toTerms);
    const p = payees.find((x) => x.propertyId === h.id);
    const cost = costs.find((c) => c.id === h.id)?.cost;
    return {
      id: h.id,
      name: h.name,
      terms: history.find((t) => t.from <= month) ?? null,
      history,
      payee: !seePayees
        ? null
        : p
          ? {
              payeeName: p.payeeName,
              reference: p.reference,
              accountHint: p.accountHint,
              hasBank: Boolean(p.bankSealed),
            }
          : null,
      cleaningCostMinor: cost === null || cost === undefined ? null : Number(cost),
    };
  });
  return {
    contracts: contracts.map(toContract),
    homes,
    missing: {
      contract: contracts.length === 0,
      homesWithoutTerms: homes.filter((h) => h.history.length === 0).length,
      homesWithoutPayee: seePayees ? homes.filter((h) => !h.payee).length : null,
    },
  };
}

async function homeOf(tx: Tx, id: string): Promise<{ id: string; name: string; ownerId: string | null }> {
  const [h] = await tx
    .select({ id: properties.id, name: properties.name, ownerId: properties.ownerId })
    .from(properties)
    .where(and(eq(properties.id, id), isNull(properties.archivedAt)));
  if (!h) throw new HttpError(404, 'property_not_found', 'That home is not in this workspace.');
  return h;
}

async function contractOf(tx: Tx, ownerId: string, contractId: string) {
  const [c] = await tx
    .select()
    .from(ownerContracts)
    .where(and(eq(ownerContracts.id, contractId), eq(ownerContracts.ownerId, ownerId)));
  if (!c) throw new HttpError(404, 'contract_not_found', 'That contract is not on this owner.');
  return c;
}

export function termRoutes(
  app: FastifyInstance,
  deps: { scope: RequestScope; files: PhotoStore; bucket: string; box?: SecretBox; now?: () => Date },
) {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/v1/owners/:id/setup',
    { schema: { params: Params, response: { 200: OwnerSetupSchema } } },
    async (req) =>
      deps.scope.inOrg(req, 'owners.read', (tx, ctx) => ownerSetup(tx, ctx, req.params.id, deps.now?.())),
  );

  // Contracts ------------------------------------------------------------------------------------

  typed.post(
    '/v1/owners/:id/contracts',
    { schema: { params: Params, body: ContractInputSchema, response: { 201: ContractSchema } } },
    async (req, reply) =>
      deps.scope.inOrg(req, 'owners.write', async (tx, ctx) => {
        await oneOwner(tx, req.params.id);
        const b = req.body;
        if (b.startsOn && b.endsOn && b.endsOn < b.startsOn)
          throw new HttpError(400, 'invalid_request', 'The contract ends before it starts.');
        const [row] = await tx
          .insert(ownerContracts)
          .values({
            organisationId: ctx.orgId,
            ownerId: req.params.id,
            title: b.title,
            signedOn: b.signedOn ?? null,
            startsOn: b.startsOn ?? null,
            endsOn: b.endsOn ?? null,
            sharedWithOwner: b.sharedWithOwner ?? true,
            createdBy: ctx.userId,
          })
          .returning();
        if (!row) throw new Error('Saving the contract returned nothing.');
        reply.code(201);
        return toContract(row);
      }),
  );

  typed.patch(
    '/v1/owners/:id/contracts/:contractId',
    {
      schema: {
        params: ContractParams,
        body: ContractInputSchema.partial(),
        response: { 200: ContractSchema },
      },
    },
    async (req) =>
      deps.scope.inOrg(req, 'owners.write', async (tx) => {
        const c = await contractOf(tx, req.params.id, req.params.contractId);
        const b = req.body;
        const startsOn = b.startsOn === undefined ? c.startsOn : b.startsOn;
        const endsOn = b.endsOn === undefined ? c.endsOn : b.endsOn;
        if (startsOn && endsOn && endsOn < startsOn)
          throw new HttpError(400, 'invalid_request', 'The contract ends before it starts.');
        const [row] = await tx
          .update(ownerContracts)
          .set({
            ...(b.title !== undefined ? { title: b.title } : {}),
            ...(b.signedOn !== undefined ? { signedOn: b.signedOn } : {}),
            startsOn,
            endsOn,
            ...(b.sharedWithOwner !== undefined ? { sharedWithOwner: b.sharedWithOwner } : {}),
          })
          .where(eq(ownerContracts.id, c.id))
          .returning();
        if (!row) throw new Error('Updating the contract returned nothing.');
        return toContract(row);
      }),
  );

  typed.delete(
    '/v1/owners/:id/contracts/:contractId',
    { schema: { params: ContractParams } },
    async (req, reply) =>
      deps.scope.inOrg(req, 'owners.write', async (tx) => {
        const c = await contractOf(tx, req.params.id, req.params.contractId);
        await tx.delete(ownerContracts).where(eq(ownerContracts.id, c.id));
        if (c.filePath) await deps.files.remove(c.filePath).catch(() => {});
        reply.code(204);
        return null;
      }),
  );

  typed.post(
    '/v1/owners/:id/contracts/:contractId/uploads',
    {
      schema: {
        params: ContractParams,
        body: ContractUploadSchema,
        response: { 200: PhotoUploadTicketSchema },
      },
    },
    async (req) =>
      deps.scope.inOrg(req, 'owners.write', async (tx, ctx) => {
        if (!deps.files.ready)
          throw new HttpError(
            503,
            'photo_storage_not_ready',
            "File storage isn't set up yet, so contracts can't be added.",
          );
        await contractOf(tx, req.params.id, req.params.contractId);
        try {
          return await deps.files.ticket(
            contractPath(ctx.orgId, req.params.contractId, req.body.contentType),
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
    '/v1/owners/:id/contracts/:contractId/file',
    { schema: { params: ContractParams, body: ContractRegisterSchema, response: { 200: ContractSchema } } },
    async (req) =>
      deps.scope.inOrg(req, 'owners.write', async (tx, ctx) => {
        const c = await contractOf(tx, req.params.id, req.params.contractId);
        const b = req.body;
        if (!contractPathBelongs(b.path, ctx.orgId, c.id))
          throw new HttpError(400, 'invalid_request', 'That file was not uploaded for this contract.');
        if (!(await deps.files.exists(b.path)))
          throw new HttpError(409, 'file_not_uploaded', "The contract hasn't finished uploading. Try again.");
        const [row] = await tx
          .update(ownerContracts)
          .set({ filePath: b.path, fileName: b.fileName, fileType: b.contentType, fileBytes: b.bytes })
          .where(eq(ownerContracts.id, c.id))
          .returning();
        if (c.filePath && c.filePath !== b.path) await deps.files.remove(c.filePath).catch(() => {});
        if (!row) throw new Error('Saving the file returned nothing.');
        return toContract(row);
      }),
  );

  typed.get(
    '/v1/owners/:id/contracts/:contractId/file',
    { schema: { params: ContractParams, response: { 200: FileLinkSchema } } },
    async (req) =>
      deps.scope.inOrg(req, 'owners.read', async (tx) => {
        const c = await contractOf(tx, req.params.id, req.params.contractId);
        if (!c.filePath)
          throw new HttpError(404, 'file_not_found', 'No file has been added to this contract yet.');
        const [url] = await deps.files.viewUrls([c.filePath]);
        return { url: url ?? deps.files.publicUrl(c.filePath) };
      }),
  );

  // Each home's terms, payee and cleaning cost ----------------------------------------------------

  typed.put(
    '/v1/properties/:id/terms',
    { schema: { params: Params, body: HomeTermsInputSchema, response: { 200: HomeTermsSchema } } },
    async (req) =>
      deps.scope.inOrg(req, 'owners.write', async (tx, ctx) => {
        const home = await homeOf(tx, req.params.id);
        const b = req.body;
        if (b.contractId) {
          if (!home.ownerId)
            throw new HttpError(400, 'no_owner', `${home.name} has no owner to hold a contract.`);
          await contractOf(tx, home.ownerId, b.contractId);
        }
        const values = {
          deal: b.deal,
          feeBasisPoints: b.deal === 'percentage' ? (b.feeBasisPoints ?? 0) : null,
          rentMinor: b.deal === 'fixed_rent' ? (b.rentMinor ?? 0) : null,
          maintenanceBy: b.maintenanceBy,
          contractId: b.contractId ?? null,
        };
        const [row] = await tx
          .insert(homeTerms)
          .values({
            organisationId: ctx.orgId,
            propertyId: home.id,
            effectiveFrom: `${b.from}-01`,
            createdBy: ctx.userId,
            ...values,
          })
          .onConflictDoUpdate({ target: [homeTerms.propertyId, homeTerms.effectiveFrom], set: values })
          .returning();
        if (!row) throw new Error('Saving the terms returned nothing.');
        return toTerms(row);
      }),
  );

  typed.put(
    '/v1/properties/:id/cleaning-cost',
    { schema: { params: Params, body: CleaningCostSchema, response: { 200: CleaningCostSchema } } },
    async (req) =>
      deps.scope.inOrg(req, 'owners.write', async (tx) => {
        const home = await homeOf(tx, req.params.id);
        await tx
          .update(properties)
          .set({ cleaningCostMinor: req.body.cleaningCostMinor })
          .where(eq(properties.id, home.id));
        return { cleaningCostMinor: req.body.cleaningCostMinor };
      }),
  );

  typed.put(
    '/v1/properties/:id/payee',
    { schema: { params: Params, body: PayeeInputSchema, response: { 200: PayeeSchema } } },
    async (req) =>
      deps.scope.inOrg(req, 'payees.write', async (tx, ctx) => {
        const home = await homeOf(tx, req.params.id);
        const b = req.body;
        if ((b.sortCode === undefined) !== (b.accountNumber === undefined))
          throw new HttpError(400, 'invalid_request', 'Give the sort code and the account number together.');
        if (b.sortCode && !deps.box)
          throw new HttpError(
            503,
            'secrets_not_ready',
            "Bank details can't be stored until the API has its secret key.",
          );
        const bank =
          b.sortCode && b.accountNumber && deps.box
            ? {
                bankSealed: deps.box.seal(
                  JSON.stringify({ sortCode: b.sortCode, accountNumber: b.accountNumber }),
                ),
                accountHint: b.accountNumber.slice(-4),
              }
            : {};
        const set = { payeeName: b.payeeName, reference: b.reference?.trim() || null, ...bank };
        const [row] = await tx
          .insert(homePayees)
          .values({ organisationId: ctx.orgId, propertyId: home.id, ...set })
          .onConflictDoUpdate({ target: homePayees.propertyId, set })
          .returning();
        if (!row) throw new Error('Saving the payee returned nothing.');
        return {
          payeeName: row.payeeName,
          reference: row.reference,
          accountHint: row.accountHint,
          hasBank: Boolean(row.bankSealed),
        };
      }),
  );

  /** The bank details, opened: admins and accounts only, and every look is in the audit trail's reach. */
  typed.get(
    '/v1/properties/:id/payee/bank',
    { schema: { params: Params, response: { 200: BankDetailsSchema } } },
    async (req) =>
      deps.scope.inOrg(req, 'payees.read', async (tx) => {
        const [p] = await tx.select().from(homePayees).where(eq(homePayees.propertyId, req.params.id));
        if (!p?.bankSealed) throw new HttpError(404, 'no_bank', 'No bank details are saved for this home.');
        const opened = deps.box?.open(Buffer.from(p.bankSealed));
        if (!opened)
          throw new HttpError(503, 'secrets_not_ready', "The bank details can't be opened with this key.");
        req.log.info({ propertyId: req.params.id }, 'Bank details shown');
        return JSON.parse(opened) as { sortCode: string; accountNumber: string };
      }),
  );

  typed.delete('/v1/properties/:id/payee', { schema: { params: Params } }, async (req, reply) =>
    deps.scope.inOrg(req, 'payees.write', async (tx) => {
      await tx.delete(homePayees).where(eq(homePayees.propertyId, req.params.id));
      reply.code(204);
      return null;
    }),
  );
}
