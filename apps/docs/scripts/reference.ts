import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PERMISSIONS, ROLE_LABELS, WORKSPACE_ROLES } from '@v01/shared';

/**
 * Pages written from the code on every build, so they can't drift from what ViVi OS does:
 *   reference/roles.md          who may do what, from packages/shared/src/permissions.ts
 *   how-it-works/security.md    docs/security.md, without its internal housekeeping section
 * The API reference itself comes from the API (apps/api/scripts/openapi.ts); this script then takes
 * out what stays internal.
 *
 * The docs are public. The decision log, and the names of the services ViVi OS is built on or moves
 * operators off (Guesty, Channex), stay internal to us (Alpha, 6 Nov 2026), so nothing here may
 * publish them; the check at the end fails the build if one slips through.
 */
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const docs = resolve(here, '../src/content/docs');
const write = (path: string, text: string) => {
  const file = resolve(docs, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
};
const generated =
  '<!-- Written from the code by apps/docs/scripts/reference.ts. Edit the source, not this page. -->';

// Roles -------------------------------------------------------------------------------------------

// The comment above each permission in the source says what it covers, in the team's words.
const source = readFileSync(resolve(root, 'packages/shared/src/permissions.ts'), 'utf8');
const notes = new Map<string, string>();
const re = /(?:\/\*\*\s*([\s\S]*?)\s*\*\/|\/\/\s*(.+))\s*\n\s*'([a-z_.]+)':/g;
for (let m = re.exec(source); m; m = re.exec(source)) {
  notes.set(m[3] as string, (m[1] ?? m[2] ?? '').replace(/\s*\n\s*\*?\s*/g, ' ').trim());
}
const AREAS: Record<string, string> = {
  properties: 'Properties',
  calendar: 'Calendar',
  reservations: 'Reservations',
  money: 'Money on bookings',
  cleaning: 'Cleaning',
  secrets: 'Codes and passwords',
  fields: 'Custom fields',
  locks: 'Door locks',
  tasks: 'Tasks',
  inbox: 'Inbox',
  claims: 'Claims',
  owners: 'Owners',
  payees: 'Payees and bank details',
  expenses: 'Expenses',
  insights: 'Insights',
  channels: 'Channels',
  workspace: 'Workspace',
  members: 'Team',
  portal: 'Owner log-in',
};
const ROLE_NOTES: Record<(typeof WORKSPACE_ROLES)[number], string> = {
  admin: 'everything, including the workspace’s settings, the team and who sees which homes.',
  operations: 'runs the homes day to day: calendar, bookings, tasks, guests, owners and money.',
  guest_comms: 'talks to guests: bookings, the Inbox and the codes guests need.',
  accounts: 'money: payments on bookings, claims, owners, expenses, statements and payees.',
  field: 'cleaners and maintenance: their own jobs, and marking homes clean.',
  owner: 'a home’s owner, through the owner log-in: their homes’ calendar and statements only.',
  v01_support: 'ViVi OS’s own staff, only while the operator allows it, and only to look.',
};
const VERBS: Record<string, string> = { read: 'see', write: 'change', manage: 'set up' };
const rows = Object.entries(PERMISSIONS).map(([key, allowed]) => {
  const [area = key, verb = ''] = key.split('.');
  const what = `${AREAS[area] ?? area}: ${VERBS[verb] ?? verb}`;
  const who = WORKSPACE_ROLES.filter((r) => (allowed as readonly string[]).includes(r))
    .map((r) => ROLE_LABELS[r])
    .join(', ');
  const note = (notes.get(key) ?? '').replace(/\|/g, '\\|');
  return `| ${what} | ${who} | ${note} |`;
});
write(
  'reference/roles.md',
  `---
title: Roles and what they can do
description: Every role in a workspace and what each may see and change, taken from ViVi OS's own rules.
---

${generated}

Everyone in a workspace has one role. An admin can also limit anyone except another admin to chosen homes:
they then see only those homes, everywhere. ViVi OS support can only look, and only while the operator has given
them access. See [Team and access](/guides/team-and-access/).

## The roles

${WORKSPACE_ROLES.map((r) => `- **${ROLE_LABELS[r]}**: ${ROLE_NOTES[r]}`).join('\n')}

## Who can do what

| What | Who | Notes |
| --- | --- | --- |
${rows.join('\n')}
`,
);

// Security -----------------------------------------------------------------------------------------

const withoutTitle = (text: string) => text.replace(/^# .*\n+/, '');
/** Drops each `## ` section whose heading matches. */
const withoutSection = (text: string, heading: RegExp) =>
  text
    .split(/\n(?=## )/)
    .filter((part) => !(part.startsWith('## ') && heading.test(part.split('\n')[0] ?? '')))
    .join('\n');
write(
  'how-it-works/security.md',
  `---
title: Security
description: How ViVi OS keeps operators apart, signs people in, and protects codes and money.
sidebar:
  order: 20
---

${withoutSection(withoutTitle(readFileSync(resolve(root, 'docs/security.md'), 'utf8')), /housekeeping/)}`,
);

// The public API reference --------------------------------------------------------------------------

const INTERNAL = /guesty|channex/i;
const specFile = resolve(here, '../src/openapi.json');
const spec = JSON.parse(readFileSync(specFile, 'utf8')) as {
  paths: Record<string, Record<string, unknown>>;
  tags?: { name: string; description?: string }[];
};
for (const path of Object.keys(spec.paths)) if (INTERNAL.test(path)) delete spec.paths[path];
/** Takes internal fields, required entries and enum values out of every schema. */
const scrub = (node: unknown): unknown => {
  if (Array.isArray(node)) return node.filter((v) => !(typeof v === 'string' && INTERNAL.test(v))).map(scrub);
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      if (INTERNAL.test(key)) continue;
      out[key] = scrub(value);
    }
    return out;
  }
  return node;
};
const tagWords: Record<string, string> = { Channels: 'Airbnb, Booking.com and Vrbo accounts and listings.' };
spec.tags = spec.tags?.map((t) => (tagWords[t.name] ? { ...t, description: tagWords[t.name] } : t));
const publicSpec = scrub(spec);
writeFileSync(specFile, `${JSON.stringify(publicSpec, null, 2)}\n`);

// Nothing internal may reach the public site.
const leaks: string[] = [];
const check = (where: string, text: string) => {
  if (INTERNAL.test(text)) leaks.push(where);
};
check('openapi.json', JSON.stringify(publicSpec));
for (const page of ['reference/roles.md', 'how-it-works/security.md']) {
  check(page, readFileSync(resolve(docs, page), 'utf8'));
}
if (leaks.length) {
  console.error(`Internal names found in the public docs: ${leaks.join(', ')}`);
  process.exit(1);
}
console.log(`Reference pages: ${rows.length} permissions, security and the public API reference written.`);
