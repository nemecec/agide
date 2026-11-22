import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Git } from '../../swarm/workspace/git';
import { GitReviewerCheckouts } from './checkout';

const IDENTITY = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' };
const git = (cwd: string, ...args: string[]): string => execFileSync('git', ['-C', cwd, ...args], { env: { ...process.env, ...IDENTITY }, encoding: 'utf8' }).trim();

let dir: string;
let repo: string;
let commit: string;
let marker: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'review-checkout-'));
  repo = join(dir, 'repo');
  marker = join(dir, 'smudge-ran');
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  writeFileSync(join(repo, 'a.txt'), 'hello\n');
  writeFileSync(join(repo, '.gitattributes'), '*.txt filter=evil\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'one');
  commit = git(repo, 'rev-parse', 'HEAD');
  // The working agent can set this in the shared repository configuration; a checkout must not run it.
  git(repo, 'config', 'filter.evil.smudge', `touch ${marker}; cat`);
  git(repo, 'config', 'filter.evil.required', 'false');
  writeFileSync(join(repo, '.git', 'hooks', 'post-checkout'), `#!/bin/sh\ntouch ${marker}\n`, { mode: 0o755 });
});
afterEach(() => {
  // A test that failed before `dispose` leaves a read-only checkout behind.
  execFileSync('chmod', ['-R', 'u+w', dir]);
  rmSync(dir, { recursive: true, force: true });
});

describe('reviewer checkout', () => {
  it('checks out the checkpoint read-only without running a filter or a hook from the repository configuration', async () => {
    const checkouts = new GitReviewerCheckouts(new Git(), join(dir, 'runs'));
    const checkout = await checkouts.prepare({ runId: 'run_1', commonDir: join(repo, '.git'), checkpointCommit: commit, inputFiles: [] });
    expect(readFileSync(join(checkout.cwd, 'a.txt'), 'utf8'), 'the file is checked out').toBe('hello\n');
    expect(existsSync(marker), 'no smudge filter and no hook ran').toBe(false);
    expect(() => writeFileSync(join(checkout.cwd, 'a.txt'), 'changed'), 'the file is read-only').toThrow(/EACCES|EPERM/);
    expect(() => writeFileSync(join(checkout.cwd, 'new.txt'), 'x'), 'the directory is read-only').toThrow(/EACCES|EPERM/);
    await checkout.dispose();
  });

  it('runs no filter named in info/attributes of the common directory, no process filter and no fsmonitor', async () => {
    writeFileSync(join(repo, '.git', 'info', 'attributes'), '* filter=other\n');
    git(repo, 'config', 'filter.other.smudge', `touch ${marker}; cat`);
    git(repo, 'config', 'filter.other.process', `sh -c 'touch ${marker}'`);
    git(repo, 'config', 'core.fsmonitor', `sh -c 'touch ${marker}'`);
    const checkouts = new GitReviewerCheckouts(new Git(), join(dir, 'runs'));
    const checkout = await checkouts.prepare({ runId: 'run_attr', commonDir: join(repo, '.git'), checkpointCommit: commit, inputFiles: [] });
    expect(readFileSync(join(checkout.cwd, 'a.txt'), 'utf8'), 'the file is checked out as committed').toBe('hello\n');
    expect(existsSync(marker), 'no program of the repository configuration ran').toBe(false);
    await checkout.dispose();
  });

  it('checks files out as committed although the checkpoint has attributes that convert or rewrite content', async () => {
    writeFileSync(join(repo, '.gitattributes'), '*.txt text eol=crlf\n*.md ident\n');
    writeFileSync(join(repo, 'b.md'), '$Id$\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'attributes');
    const attributed = git(repo, 'rev-parse', 'HEAD');
    const checkouts = new GitReviewerCheckouts(new Git(), join(dir, 'runs'));
    const checkout = await checkouts.prepare({ runId: 'run_conv', commonDir: join(repo, '.git'), checkpointCommit: attributed, inputFiles: [] });
    expect(readFileSync(join(checkout.cwd, 'a.txt'), 'utf8'), 'line endings are not converted by an attribute of the checkpoint').toBe('hello\n');
    expect(readFileSync(join(checkout.cwd, 'b.md'), 'utf8'), 'an ident attribute does not expand').toBe('$Id$\n');
    await checkout.dispose();
  });

  it('writes input files by index and refuses a name that is not built from an index', async () => {
    const checkouts = new GitReviewerCheckouts(new Git(), join(dir, 'runs'));
    const checkout = await checkouts.prepare({ runId: 'run_2', commonDir: join(repo, '.git'), checkpointCommit: commit, inputFiles: [{ name: 'files/3.diff', content: 'data' }] });
    expect(readFileSync(join(checkout.inputsDir, 'files', '3.diff'), 'utf8'), 'the input is written under its index').toBe('data');
    await checkout.dispose();
    await expect(checkouts.prepare({ runId: 'run_3', commonDir: join(repo, '.git'), checkpointCommit: commit, inputFiles: [{ name: 'files/../../x.diff', content: 'data' }] }), 'a path-like name').rejects.toThrow(/index/);
    expect(existsSync(join(dir, 'runs', 'run_3')), 'a failed preparation leaves nothing behind').toBe(false);
  });

  it('removes the checkout, the inputs and the worktree registration on dispose', async () => {
    const checkouts = new GitReviewerCheckouts(new Git(), join(dir, 'runs'));
    const checkout = await checkouts.prepare({ runId: 'run_4', commonDir: join(repo, '.git'), checkpointCommit: commit, inputFiles: [{ name: 'files/0.diff', content: 'x' }] });
    expect(git(repo, 'worktree', 'list').split('\n').length, 'the worktree is registered').toBe(2);
    await checkout.dispose();
    expect(existsSync(join(dir, 'runs', 'run_4')), 'the run directory is gone').toBe(false);
    expect(git(repo, 'worktree', 'list').split('\n').length, 'the registration is gone').toBe(1);
    expect(await readdir(join(dir, 'runs')), 'nothing else is left').toEqual([]);
  });

  it('fails for a commit that does not exist and leaves no directory', async () => {
    const checkouts = new GitReviewerCheckouts(new Git(), join(dir, 'runs'));
    await expect(checkouts.prepare({ runId: 'run_5', commonDir: join(repo, '.git'), checkpointCommit: 'f'.repeat(40), inputFiles: [] }), 'an unknown commit').rejects.toThrow();
    expect(existsSync(join(dir, 'runs', 'run_5')), 'no leftover').toBe(false);
  });
});
