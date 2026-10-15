import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseCheckArgs, runChannexCheck } from '../src/channex-check.ts';

/**
 * pnpm channex:check [--round-trip <Channex property id> | --make-test-property]
 * Reads CHANNEX_API_KEY (and CHANNEX_BASE_URL, if set) from apps/worker/.env. See src/channex-check.ts.
 */

const args = parseCheckArgs(process.argv.slice(2));
if ('error' in args) {
  console.error(args.error);
  process.exit(2);
}

/** The commit this copy of the code is on, shown in the first line of the report. */
function commit(): string | undefined {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim() || undefined;
  } catch {
    return undefined;
  }
}

let exampleEnv: string | null = null;
try {
  exampleEnv = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
} catch {
  exampleEnv = null;
}

const passed = await runChannexCheck({
  version: commit(),
  apiKey: process.env.CHANNEX_API_KEY,
  baseUrl: process.env.CHANNEX_BASE_URL || undefined,
  roundTrip: args.roundTrip,
  makeTestProperty: args.makeTestProperty,
  exampleEnv,
  print: (line) => console.log(line),
});
process.exitCode = passed ? 0 : 1;
