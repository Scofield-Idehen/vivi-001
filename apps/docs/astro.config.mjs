import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';
import starlightOpenAPI, { openAPISidebarGroups } from 'starlight-openapi';

// ViVi OS's documentation: guides for operators and their teams, how ViVi OS works, and the API
// reference, which is written from the API's own code on every build (scripts/reference.ts).
export default defineConfig({
  site: process.env.DOCS_SITE_URL || 'https://vivi-os-docs.web.app',
  telemetry: false,
  integrations: [
    starlight({
      title: 'ViVi OS docs',
      description: 'How to run your homes on ViVi OS: set-up, every screen, and the API.',
      customCss: ['./src/styles/theme.css'],
      lastUpdated: false,
      pagination: true,
      plugins: [
        starlightOpenAPI([
          {
            base: 'api',
            schema: './src/openapi.json',
            sidebar: { label: 'API endpoints', operations: { badges: true, labels: 'summary' } },
          },
        ]),
      ],
      sidebar: [
        { label: 'Start here', items: [{ autogenerate: { directory: 'start' } }] },
        { label: 'Guides', items: [{ autogenerate: { directory: 'guides' } }] },
        { label: 'Reference', items: [{ autogenerate: { directory: 'reference' } }] },
        ...openAPISidebarGroups,
        { label: 'How ViVi OS works', items: [{ autogenerate: { directory: 'how-it-works' } }] },
      ],
    }),
  ],
});
