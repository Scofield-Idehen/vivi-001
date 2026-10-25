import { GuestyClient, SecretBox } from '@v01/integrations';
import { type ImportSummary, importFromGuesty } from '../src/guesty/import.ts';
import { liveDeps } from '../src/live-deps.ts';

/**
 * pnpm guesty:import --org <slug> [--dry-run] [--bookings-days-back 365] [--calendar-days 730]
 *                     [--messages-days-back 90]   (0 leaves the guest conversations out)
 *
 * Brings an operator's Guesty account into V-01: listings as properties Guesty still runs, with
 * photos, amenities, custom fields, tags, nightly prices and blocks; bookings with their guests;
 * and the account map for the move-over. Reads GUESTY_CLIENT_ID and GUESTY_CLIENT_SECRET (and
 * FIELD_SECRET_KEY for lock codes) from apps/worker/.env. Run again any time: it updates.
 * --dry-run does everything and keeps nothing, so the report can be read first.
 */

const args = process.argv.slice(2);
const value = (flag: string) => {
  const at = args.indexOf(flag);
  return at >= 0 ? args[at + 1] : undefined;
};
const slug = value('--org');
if (!slug) {
  console.error('Which operator? pnpm guesty:import --org <slug> [--dry-run]');
  process.exit(2);
}
const dryRun = args.includes('--dry-run');
const daysBack = value('--bookings-days-back');
const calendarDays = value('--calendar-days');
const messagesBack = value('--messages-days-back');

// A query that hasn't answered in two minutes has lost its connection: stop rather than hang.
const { env, deps, log } = liveDeps(undefined, {
  applicationName: 'v01-guesty-import',
  queryTimeoutMs: 120_000,
});
if (!env.GUESTY_CLIENT_ID || !env.GUESTY_CLIENT_SECRET) {
  console.error('GUESTY_CLIENT_ID and GUESTY_CLIENT_SECRET are not set in apps/worker/.env.');
  process.exit(2);
}

try {
  const org = await deps.db.findOrganisation(slug);
  if (!org) {
    const known = await deps.db.listOrganisations();
    console.error(
      `No operator with the slug "${slug}". Operators: ${known.map((o) => o.name).join(', ') || 'none'}.`,
    );
    process.exit(2);
  }
  const clientId = env.GUESTY_CLIENT_ID;
  const guesty = new GuestyClient({
    clientId,
    clientSecret: env.GUESTY_CLIENT_SECRET,
    baseUrl: env.GUESTY_API_URL,
    tokens: {
      load: () => deps.db.loadToken('guesty', clientId),
      save: (_id, token, remaining) => deps.db.saveToken('guesty', clientId, token, remaining),
    },
  });
  if (!env.FIELD_SECRET_KEY) {
    console.warn(
      'FIELD_SECRET_KEY is not set: lock codes and other secret fields will be reported, not stored.',
    );
  }
  console.log(`${dryRun ? 'Rehearsing' : 'Running'} the Guesty import for ${org.name}…`);
  const summary = await importFromGuesty(deps, {
    orgId: org.id,
    guesty,
    box: env.FIELD_SECRET_KEY ? new SecretBox(env.FIELD_SECRET_KEY) : undefined,
    dryRun,
    bookingsDaysBack: daysBack ? Number(daysBack) : undefined,
    calendarDaysAhead: calendarDays ? Number(calendarDays) : undefined,
    messagesDaysBack: messagesBack !== undefined ? Number(messagesBack) : undefined,
    onProgress: (message) => console.log(`  ${new Date().toLocaleTimeString('en-GB')}  ${message}`),
  });
  console.log(report(summary, org.name));
  log.info({ orgId: org.id, dryRun }, 'Guesty import finished');
} finally {
  await deps.db.close();
}

function report(s: ImportSummary, orgName: string): string {
  const lines: string[] = [];
  lines.push('');
  lines.push(s.dryRun ? `Dry run for ${orgName}: nothing was kept.` : `Imported into ${orgName}.`);
  lines.push(
    `Listings: ${s.listings.seen} seen; ${s.listings.created} new, ${s.listings.updated} updated, ${s.listings.archived} archived (inactive in Guesty).`,
  );
  for (const sk of s.listings.skipped) lines.push(`  skipped ${sk}`);
  lines.push(`Photos: ${s.photos} (still on Guesty's addresses). Amenities set: ${s.amenities.set}.`);
  lines.push(
    `Custom fields: ${s.fields.valuesSet} values set${s.fields.created.length ? `; new fields: ${s.fields.created.join(', ')}` : ''}${s.fields.secretsSkipped ? `; ${s.fields.secretsSkipped} secrets NOT stored (set FIELD_SECRET_KEY)` : ''}.`,
  );
  lines.push(
    `Calendar: ${s.calendar.blocks} blocks, ${s.calendar.nights} nights with their own price or rules${s.calendar.blocksRefused ? `, ${s.calendar.blocksRefused} blocks refused` : ''}.`,
  );
  lines.push(`Channel accounts (the account map): ${s.accounts.length}`);
  for (const a of s.accounts) lines.push(`  ${a.label} — Guesty account key "${a.key}"`);
  lines.push(`Listings on channels recorded: ${s.channelListings}.`);
  lines.push(
    `Bookings: ${s.reservations.seen} seen; ${s.reservations.created} new, ${s.reservations.updated} updated, ${s.reservations.conflicts} saved as conflicts.`,
  );
  for (const sk of s.reservations.skipped.slice(0, 20)) lines.push(`  skipped ${sk}`);
  if (s.reservations.skipped.length > 20) lines.push(`  …and ${s.reservations.skipped.length - 20} more`);
  lines.push(
    `Guest conversations: ${s.messages.conversations} into the Inbox, ${s.messages.imported} messages${s.messages.skipped ? ` (${s.messages.skipped} log lines and notes left in Guesty)` : ''}${s.messages.failed ? `; ${s.messages.failed} couldn't be read` : ''}.`,
  );
  const warned = Object.entries(s.warnings);
  if (warned.length) {
    lines.push('');
    lines.push('To look at:');
    for (const [name, ws] of warned) {
      lines.push(`  ${name}`);
      for (const w of ws) lines.push(`    - ${w}`);
    }
  }
  if (s.tokensRemainingToday !== null) lines.push('');
  if (s.tokensRemainingToday !== null)
    lines.push(`Guesty tokens left today: ${s.tokensRemainingToday} of 5.`);
  return lines.join('\n');
}
