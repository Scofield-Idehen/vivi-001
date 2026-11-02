import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PERMISSIONS, ROLE_LABELS, WORKSPACE_ROLES } from '@v01/shared';

/**
 * Pages written from the code on every build, so they can't drift from what V-01 does:
 *   reference/roles.md          who may do what, from packages/shared/src/permissions.ts
 *   how-it-works/decisions.md   the decision log, docs/decisions.md
 *   how-it-works/security.md    docs/security.md
 * The API reference itself comes from the API (apps/api/scripts/openapi.ts).
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
  v01_support: 'V-01’s own staff, only while the operator allows it, and only to look.',
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
description: Every role in a workspace and what each may see and change, taken from V-01's own rules.
---

${generated}

Everyone in a workspace has one role. An admin can also limit anyone except another admin to chosen homes:
they then see only those homes, everywhere. V-01 support can only look, and only while the operator has given
them access. See [Team and access](/guides/team-and-access/).

## The roles

${WORKSPACE_ROLES.map((r) => `- **${ROLE_LABELS[r]}**: ${ROLE_NOTES[r]}`).join('\n')}

## Who can do what

| What | Who | Notes |
| --- | --- | --- |
${rows.join('\n')}
`,
);

// Decision log and security -----------------------------------------------------------------------

const withoutTitle = (text: string) => text.replace(/^# .*\n+/, '');
write(
  'how-it-works/decisions.md',
  `---
title: Decision log
description: What was decided while building V-01, and why. Newest first.
sidebar:
  order: 90
---

${withoutTitle(readFileSync(resolve(root, 'docs/decisions.md'), 'utf8'))}`,
);
write(
  'how-it-works/security.md',
  `---
title: Security
description: How V-01 keeps operators apart, signs people in, and protects codes and money.
sidebar:
  order: 20
---

${withoutTitle(readFileSync(resolve(root, 'docs/security.md'), 'utf8'))}`,
);
console.log(`Reference pages: ${rows.length} permissions, decision log and security written.`);
