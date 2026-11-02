import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';
import starlightOpenAPI, { openAPISidebarGroups } from 'starlight-openapi';

// V-01's documentation: guides for operators and their teams, how V-01 works, and the API
// reference, which is written from the API's own code on every build (scripts/reference.ts).
export default defineConfig({
  site: process.env.DOCS_SITE_URL || 'https://vivi-os-docs.web.app',
  telemetry: false,
  integrations: [
    starlight({
      title: 'V-01 docs',
      description: 'How to run your homes on V-01: set-up, every screen, and the API.',
      customCss: ['./src/styles/theme.css'],
      lastUpdated: false,
      pagination: true,
      plugins: [
        starlightOpenAPI([
          {
            base: 'api',
            schema: './src/openapi.json',
            sidebar: {
              label: 'API endpoints',
              collapsed: true,
              operations: { badges: true, labels: 'summary' },
            },
          },
        ]),
      ],
      // In the order a day runs, not A to Z: what you look at first comes first.
      sidebar: [
        { label: 'Start here', items: ['start/what-is-v01', 'start/set-up'] },
        {
          label: 'Every day',
          items: [
            'guides/today',
            'guides/calendar',
            'guides/reservations',
            'guides/inbox',
            'guides/tasks-and-field-team',
          ],
        },
        {
          label: 'Guests and money',
          items: [
            'guides/guest-stay-page',
            'guides/booking-website',
            'guides/payments-and-deposits',
            'guides/claims',
          ],
        },
        { label: 'Your homes', items: ['guides/properties', 'guides/channels', 'guides/door-locks'] },
        {
          label: 'Running the business',
          items: [
            'guides/owners-and-statements',
            'guides/insights',
            'guides/team-and-access',
            'reference/roles',
          ],
        },
        { label: 'For developers', items: ['reference/api', ...openAPISidebarGroups] },
        {
          label: 'How V-01 works',
          collapsed: true,
          items: [{ autogenerate: { directory: 'how-it-works' } }],
        },
      ],
    }),
  ],
});
