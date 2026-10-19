import { crossCheckAll } from '../src/cross-check.ts';
import { liveDeps } from '../src/live-deps.ts';

/**
 * pnpm cross-check [--days N]
 * Runs the nightly cross-check now: every calendar V-01 runs against what Channex holds for the
 * next N nights (90 by default). Reads the worker's .env. Use it after a long outage, once the
 * recovery has drained, or whenever Channex looks wrong.
 */

const args = process.argv.slice(2);
const at = args.indexOf('--days');
const days = at >= 0 ? Number(args[at + 1]) : undefined;
if (days !== undefined && (!Number.isInteger(days) || days < 1 || days > 500)) {
  console.error('--days must be a whole number from 1 to 500');
  process.exit(2);
}

const { deps, log } = liveDeps(undefined, { applicationName: 'v01-cross-check' });
try {
  const stats = await crossCheckAll(deps, days ? { days } : {});
  log.info(stats, 'Cross-check finished');
  console.log(
    `Checked ${stats.checked}: ${stats.matching} matching, ${stats.differing} differing (${stats.nightsResent} nights sent again), ${stats.waiting} waiting for the outbox, ${stats.failed} couldn't be asked.`,
  );
} finally {
  await deps.db.close();
}
