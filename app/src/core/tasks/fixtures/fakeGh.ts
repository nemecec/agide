import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

export interface FakeGhPullRequest {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly state: string;
  readonly author: { readonly login: string };
  readonly headRefName: string;
  readonly baseRefName: string;
  readonly isCrossRepository: boolean;
  readonly headRepositoryOwner: { readonly login: string };
  readonly body: string;
  readonly files: readonly { readonly path: string }[];
}

export const samplePullRequest = (overrides: Partial<FakeGhPullRequest> = {}): FakeGhPullRequest => ({
  number: 1,
  title: 'Fix the retry in the uploader',
  url: 'https://github.com/acme/app/pull/1',
  state: 'OPEN',
  author: { login: 'octocat' },
  headRefName: 'fix-retry',
  baseRefName: 'main',
  isCrossRepository: false,
  headRepositoryOwner: { login: 'acme' },
  body: 'Retries the upload three times.',
  files: [{ path: 'src/upload.ts' }, { path: 'README.md' }],
  ...overrides,
});

/** A directory with an executable `gh` that `fake-gh.mjs` backs, and the variables that drive it. */
export function installFakeGh(options: { readonly pr?: FakeGhPullRequest; readonly error?: string } = {}): { readonly dir: string; readonly path: string; readonly record: string; readonly env: Record<string, string> } {
  const dir = mkdtempSync(join(tmpdir(), 'fake-gh-'));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  copyFileSync(join(import.meta.dirname, 'fake-gh.mjs'), join(bin, 'gh'));
  chmodSync(join(bin, 'gh'), 0o755);
  const record = join(dir, 'calls.jsonl');
  const env: Record<string, string> = { FAKE_GH_RECORD: record };
  if (options.pr !== undefined) {
    const file = join(dir, 'pr.json');
    writeFileSync(file, JSON.stringify(options.pr));
    env['FAKE_GH_PR'] = file;
  }
  if (options.error !== undefined) env['FAKE_GH_ERROR'] = options.error;
  return { dir, path: `${bin}${delimiter}${process.env['PATH'] ?? ''}`, record, env };
}
