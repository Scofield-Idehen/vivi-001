import { organisationBrand, organisationSettings, organisations, supportAccessGrants } from '@v01/db';
import { BrandUpdateSchema, SupportVisitListSchema, WorkspaceSchema } from '@v01/shared';
import { desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { type RequestScope, toIso } from '../context.ts';
import { HttpError } from '../errors.ts';

/** The chosen operator: its name, settings and outside brand, and the person's role in it. */
export function workspaceRoutes(app: FastifyInstance, deps: { scope: RequestScope }) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .get('/v1/workspace', { schema: { response: { 200: WorkspaceSchema } } }, async (req) =>
      deps.scope.inOrg(req, 'workspace.read', async (tx, ctx) => {
        const [row] = await tx
          .select({ organisation: organisations, settings: organisationSettings, brand: organisationBrand })
          .from(organisations)
          .innerJoin(organisationSettings, eq(organisationSettings.organisationId, organisations.id))
          .innerJoin(organisationBrand, eq(organisationBrand.organisationId, organisations.id))
          .where(eq(organisations.id, ctx.orgId));
        if (!row) throw new HttpError(404, 'workspace_not_found', 'This workspace is not set up yet.');
        return {
          organisation: {
            id: row.organisation.id,
            name: row.organisation.name,
            legalName: row.organisation.legalName,
            slug: row.organisation.slug,
          },
          settings: {
            currency: row.settings.currency,
            timeZone: row.settings.timeZone,
            locale: row.settings.locale,
            countryCode: row.settings.countryCode,
          },
          brand: {
            displayName: row.brand.displayName,
            logoLightUrl: row.brand.logoLightUrl,
            logoDarkUrl: row.brand.logoDarkUrl,
            accentHex: row.brand.accentHex,
            senderName: row.brand.senderName,
            emailDomain: row.brand.emailDomain,
            guestPhone: row.brand.guestPhone,
          },
          role: ctx.role,
        };
      }),
    );

  // The number guests call, shown on their stay page. The rest of the brand comes with the settings screens.
  app
    .withTypeProvider<ZodTypeProvider>()
    .patch(
      '/v1/workspace/brand',
      { schema: { body: BrandUpdateSchema, response: { 200: WorkspaceSchema } } },
      async (req) =>
        deps.scope.inOrg(req, 'workspace.manage', async (tx, ctx) => {
          const b = req.body;
          await tx
            .update(organisationBrand)
            .set({ ...(b.guestPhone !== undefined ? { guestPhone: b.guestPhone || null } : {}) })
            .where(eq(organisationBrand.organisationId, ctx.orgId));
          const [row] = await tx
            .select({ organisation: organisations, settings: organisationSettings, brand: organisationBrand })
            .from(organisations)
            .innerJoin(organisationSettings, eq(organisationSettings.organisationId, organisations.id))
            .innerJoin(organisationBrand, eq(organisationBrand.organisationId, organisations.id))
            .where(eq(organisations.id, ctx.orgId));
          if (!row) throw new HttpError(404, 'workspace_not_found', 'This workspace is not set up yet.');
          return {
            organisation: {
              id: row.organisation.id,
              name: row.organisation.name,
              legalName: row.organisation.legalName,
              slug: row.organisation.slug,
            },
            settings: {
              currency: row.settings.currency,
              timeZone: row.settings.timeZone,
              locale: row.settings.locale,
              countryCode: row.settings.countryCode,
            },
            brand: {
              displayName: row.brand.displayName,
              logoLightUrl: row.brand.logoLightUrl,
              logoDarkUrl: row.brand.logoDarkUrl,
              accentHex: row.brand.accentHex,
              senderName: row.brand.senderName,
              emailDomain: row.brand.emailDomain,
              guestPhone: row.brand.guestPhone,
            },
            role: ctx.role,
          };
        }),
    );

  // Every time V-01 staff opened this workspace on support access: who, why and for how long.
  // Row-level security limits the grants to this operator's own.
  app
    .withTypeProvider<ZodTypeProvider>()
    .get(
      '/v1/workspace/support-visits',
      { schema: { response: { 200: SupportVisitListSchema } } },
      async (req) =>
        deps.scope.inOrg(req, 'workspace.read', async (tx) => {
          const rows = await tx
            .select()
            .from(supportAccessGrants)
            .orderBy(desc(supportAccessGrants.startedAt))
            .limit(50);
          return {
            visits: rows.map((g) => ({
              id: g.id,
              staffEmail: g.staffEmail,
              reason: g.reason,
              startedAt: toIso(g.startedAt),
              expiresAt: toIso(g.expiresAt),
              endedAt: g.endedAt ? toIso(g.endedAt) : null,
            })),
          };
        }),
    );
}
