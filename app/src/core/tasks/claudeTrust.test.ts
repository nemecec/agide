import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { claudeJsonPath, isFolderTrusted } from './claudeTrust';

let root: string;
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'trust-')));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const config = (...paths: string[]): string => {
  const file = join(root, 'claude.json');
  writeFileSync(file, JSON.stringify({ projects: Object.fromEntries(paths.map((p) => [p, { hasTrustDialogAccepted: true }])) }));
  return file;
};

describe('login trust entries', () => {
  it('trusts a directory below a trusted ancestor', () => {
    const dir = join(root, 'a', 'b');
    mkdirSync(dir, { recursive: true });
    expect(isFolderTrusted(dir, config(root)), 'ancestor entry').toBe(true);
  });

  it('stops the walk at the git root', () => {
    const repo = join(root, 'repo');
    mkdirSync(join(repo, '.git'), { recursive: true });
    expect(isFolderTrusted(repo, config(root)), 'trusted parent of a git root').toBe(false);
    expect(isFolderTrusted(repo, config(repo)), 'entry for the git root').toBe(true);
  });

  it('treats a missing or unreadable file as no trust and an entry with false as untrusted', () => {
    expect(isFolderTrusted(root, join(root, 'missing.json')), 'missing file').toBe(false);
    const file = join(root, 'c.json');
    writeFileSync(file, JSON.stringify({ projects: { [root]: { hasTrustDialogAccepted: false } } }));
    expect(isFolderTrusted(root, file), 'declined entry').toBe(false);
  });

  it('reads the file in the profile configuration directory when one is set', () => {
    expect(claudeJsonPath({ CLAUDE_CONFIG_DIR: '/cfg' }), 'config dir').toBe(join('/cfg', '.claude.json'));
    expect(claudeJsonPath({ HOME: '/home/u' }), 'home').toBe(join('/home/u', '.claude.json'));
  });
});
