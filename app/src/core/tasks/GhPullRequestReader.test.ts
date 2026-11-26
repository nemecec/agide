import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { installFakeGh, samplePullRequest } from './fixtures/fakeGh';
import { GhPullRequestReader } from './GhPullRequestReader';
import type { TaskSource } from './types';

const source: Extract<TaskSource, { kind: 'pull-request' }> = { kind: 'pull-request', host: 'github.com', owner: 'acme', repo: 'app', number: 1 };
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function reader(options: Parameters<typeof installFakeGh>[0]) {
  const gh = installFakeGh(options);
  dirs.push(gh.dir);
  return { gh, reader: new GhPullRequestReader({ env: () => ({ ...process.env, ...gh.env, PATH: gh.path }), executable: join(gh.dir, 'bin', 'gh') }) };
}

describe('pull request reader', () => {
  it('reads the pull request through a gh executable on PATH with owner, repo and number as separate arguments', async () => {
    const { gh, reader: r } = reader({ pr: samplePullRequest() });
    const pr = await r.read(source);
    expect(pr, 'mapped pull request').toMatchObject({ number: 1, title: 'Fix the retry in the uploader', author: 'octocat', headRefName: 'fix-retry', baseRefName: 'main', isCrossRepository: false, files: ['src/upload.ts', 'README.md'] });
    const call = JSON.parse(readFileSync(gh.record, 'utf8').trim()) as string[];
    expect(call.slice(0, 4), 'gh arguments').toEqual(['pr', 'view', '1', '--repo=acme/app']);
    expect(call[4], 'json flag').toBe('--json');
  });

  it('reports the first line of stderr and hints at sign-in for a signed-out gh', async () => {
    const { reader: r } = reader({ error: 'To get started with GitHub CLI, please run:  gh auth login' });
    await expect(r.read(source), 'signed out').rejects.toMatchObject({ code: 'gh_failed', message: expect.stringContaining('not signed in') });
    const other = reader({ error: 'GraphQL: Could not resolve to a PullRequest' });
    await expect(other.reader.read(source), 'other failure').rejects.toMatchObject({ code: 'gh_failed', message: 'gh failed: GraphQL: Could not resolve to a PullRequest' });
  });

  it('says so when gh is not installed', async () => {
    const missing = new GhPullRequestReader({ env: () => ({ PATH: '/nonexistent' }), executable: '/nonexistent/gh' });
    await expect(missing.read(source), 'no gh').rejects.toMatchObject({ code: 'gh_failed', message: expect.stringContaining('not installed') });
  });

  it('refuses output it does not understand', async () => {
    const { reader: r } = reader({ pr: { ...samplePullRequest(), number: 'x' as unknown as number } });
    await expect(r.read(source), 'bad output').rejects.toMatchObject({ code: 'gh_failed' });
  });
});
