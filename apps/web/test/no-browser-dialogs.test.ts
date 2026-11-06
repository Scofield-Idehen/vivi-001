import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The browser's own confirm, alert and prompt boxes never appear in ViVi OS (Alpha, 1 Nov 2026): they
 * show the web address and their own buttons. Use useConfirm() from components/Confirm.tsx.
 */

const SRC = join(import.meta.dirname, '..', 'src');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe('dialogs', () => {
  it('never uses the browser’s confirm, alert or prompt', () => {
    const found = files(SRC).filter((f) =>
      /\bwindow\.(confirm|alert|prompt)\s*\(|(^|[^.\w])(confirm|alert|prompt)\s*\(\s*['"`]/m.test(
        readFileSync(f, 'utf8'),
      ),
    );
    expect(found).toEqual([]);
  });
});
