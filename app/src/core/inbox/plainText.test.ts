import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '..', '..');
const ROOTS = ['core/inbox', 'renderer/panes/inbox', 'renderer/panes/InboxPane.tsx', 'main/modules/inbox.ts'];

function files(path: string): string[] {
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path).flatMap((name) => files(join(path, name)));
}

describe('untrusted text in the inbox code', () => {
  it('never writes HTML or sets markup from item text', () => {
    const offenders = ROOTS.flatMap((root) => files(join(SRC, root)))
      .filter((path) => /\.(ts|tsx)$/.test(path) && !path.endsWith('plainText.test.ts'))
      .filter((path) => /dangerouslySetInnerHTML|\.innerHTML|insertAdjacentHTML|document\.write/.test(readFileSync(path, 'utf8')));
    expect(offenders, 'files that write markup').toEqual([]);
  });
});
