import { organisationBrand, organisationSettings, organisations } from '@v01/db';
import { WorkspaceSchema } from '@v01/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { RequestScope } from '../context.ts';
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
          },
          role: ctx.role,
        };
      }),
    );
}
