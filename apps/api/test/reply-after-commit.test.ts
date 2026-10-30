import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A reply sent from inside `scope.inOrg` leaves before the transaction commits, so the next request
 * can miss what was just saved (the cause of tests that failed now and then: a booking "not found"
 * right after it was made). Routes set the status and return the body; Fastify sends it once the
 * transaction is done. Webhooks don't run in a workspace transaction and may send directly.
 */
describe('replies go out after the transaction commits', () => {
  it('no route sends its reply itself', () => {
    const dir = join(import.meta.dirname, '../src/routes');
    const offenders = readdirSync(dir)
      .filter((f) => f.endsWith('.ts') && f !== 'webhooks.ts')
      .flatMap((f) =>
        readFileSync(join(dir, f), 'utf8')
          .split('\n')
          .map((line, i) => ({ f, i: i + 1, line }))
          .filter(({ line }) => /reply\s*\.\s*(code\([^)]*\)\s*\.\s*)?send\(/.test(line)),
      )
      .map(({ f, i }) => `${f}:${i}`);
    expect(offenders).toEqual([]);
  });
});
