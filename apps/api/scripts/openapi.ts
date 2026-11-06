import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ApiDatabase } from '@v01/db';
import { buildApp } from '../src/app.ts';
import { createTokenVerifier } from '../src/auth.ts';
import { loadEnv } from '../src/env.ts';

/**
 * Writes the API's OpenAPI description, for the docs site's API reference. It builds the app with
 * stand-in settings and never connects to a database or listens: the routes describe themselves
 * from the same schemas that check every request, so the reference can't drift from the code.
 *
 *   tsx apps/api/scripts/openapi.ts <out.json>
 */
const out = resolve(process.cwd(), process.argv[2] ?? 'openapi.json');
const env = loadEnv({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://docs@127.0.0.1:1/none',
  SUPABASE_JWT_SECRET: 'openapi-description-only-not-a-secret',
  CORS_ORIGINS: 'https://app.example',
});
const db = new ApiDatabase(env.DATABASE_URL);
const app = await buildApp({
  env,
  db,
  verifyToken: createTokenVerifier({ jwtSecret: env.SUPABASE_JWT_SECRET ?? '' }),
  openapi: true,
});
await app.ready();
type Operation = { tags?: string[]; security?: Record<string, string[]>[]; summary?: string };
const spec = app.swagger() as {
  paths?: Record<string, Record<string, Operation>>;
  tags?: { name: string; description: string }[];
};

/** Each route's area, from the start of its path, in the words the screens use. */
const AREAS: [RegExp, string, string][] = [
  [/^\/v1\/site\b/, 'Booking website', 'Public: the homes, prices and booking on the operator’s website.'],
  [/^\/v1\/stay\b/, 'Guest stay page', 'Public: the guest’s page for their stay, by the key in their link.'],
  [/^\/v1\/(me|app-brand)\b/, 'You', 'The signed-in person and their workspaces.'],
  [/^\/v1\/workspace\b/, 'Workspace', 'The operator’s settings, brand, booking website and support visits.'],
  [/^\/v1\/(members|invitations|team)\b/, 'Team', 'People, roles, homes they can see, and skills.'],
  [/^\/v1\/properties\b/, 'Properties', 'Homes, their listing, photos, rooms, rules and prices.'],
  [/^\/v1\/(fields|custom-fields)\b/, 'Custom fields', 'The operator’s own details on each home.'],
  [/^\/v1\/calendar\b/, 'Calendar', 'Nights, prices, blocks and bookings by home.'],
  [
    /^\/v1\/(reservations|card-requests)\b/,
    'Reservations',
    'Bookings, their money, card payments and deposits.',
  ],
  [/^\/v1\/(inbox|threads|message-templates)\b/, 'Inbox', 'Guest messages and automatic messages.'],
  [/^\/v1\/(tasks|task-templates|cleaning)\b/, 'Tasks and cleaning', 'Jobs for the field team.'],
  [/^\/v1\/claims\b/, 'Claims', 'Damage claims on bookings.'],
  [
    /^\/v1\/(owners|owner-logins|expenses|statements|contracts|terms|payees|portal)\b/,
    'Owners',
    'Owners, expenses, statements and the owner log-in.',
  ],
  [
    /^\/v1\/(channels|channex|channel-accounts)\b/,
    'Channels',
    'Airbnb, Booking.com and Vrbo through Channex.',
  ],
  [/^\/v1\/locks\b/, 'Door locks', 'TTLock locks and codes.'],
  [
    /^\/v1\/(today|overview|insights)\b/,
    'Today and insights',
    'What needs doing, and how the homes are doing.',
  ],
  [/^\/v1\/console\b/, 'ViVi OS console', 'ViVi OS staff only.'],
];
const PUBLIC = /^\/v1\/(site|stay|app-brand)\b/;

for (const [path, methods] of Object.entries(spec.paths ?? {})) {
  // Webhooks and health are for Channex, Stripe and the hosting, not callers.
  if (path.startsWith('/webhooks') || path === '/health') {
    delete spec.paths?.[path];
    continue;
  }
  const area = AREAS.find(([re]) => re.test(path))?.[1] ?? 'Other';
  for (const [method, op] of Object.entries(methods)) {
    op.tags = [area];
    // Named by method and path, as developers look for it.
    op.summary ??= `${method.toUpperCase()} ${path.replace(/^\/v1/, '')}`;
    if (!PUBLIC.test(path)) op.security = [{ bearer: [], workspace: [] }];
  }
}
(spec as { servers?: { url: string; description: string }[] }).servers = [
  { url: process.env.DOCS_API_URL ?? 'https://vivi-os.web.app', description: 'Staging' },
];
spec.tags = [
  ...AREAS.map(([, name, description]) => ({ name, description })),
  { name: 'Other', description: '' },
];
writeFileSync(out, `${JSON.stringify(spec, null, 2)}\n`);
console.log(`OpenAPI: ${Object.keys(spec.paths ?? {}).length} paths written to ${out}`);
await app.close();
await db.close();
