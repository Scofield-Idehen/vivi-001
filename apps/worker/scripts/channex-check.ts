import { readFileSync } from 'node:fs';
import { runChannexCheck } from '../src/channex-check.ts';

/**
 * pnpm channex:check [--round-trip <Channex property id>]
 * Reads CHANNEX_API_KEY (and CHANNEX_BASE_URL, if set) from apps/worker/.env. See src/channex-check.ts.
 */

const args = process.argv.slice(2);
const at = args.indexOf('--round-trip');
const roundTrip = at >= 0 ? args[at + 1] : undefined;
if (at >= 0 && (!roundTrip || roundTrip.startsWith('-'))) {
  console.error('Give the Channex property id after --round-trip: pnpm channex:check --round-trip <id>');
  process.exit(2);
}

let exampleEnv: string | null = null;
try {
  exampleEnv = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
} catch {
  exampleEnv = null;
}

const passed = await runChannexCheck({
  apiKey: process.env.CHANNEX_API_KEY,
  baseUrl: process.env.CHANNEX_BASE_URL || undefined,
  roundTrip,
  exampleEnv,
  print: (line) => console.log(line),
});
process.exitCode = passed ? 0 : 1;
