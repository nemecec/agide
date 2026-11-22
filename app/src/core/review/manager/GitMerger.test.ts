import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GitMerger } from './GitMerger';

const IDENTITY = { GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test.invalid', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test.invalid' };
let root: string;
let repo: string;
let base: string;

const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, env: { ...process.env, ...IDENTITY }, encoding: 'utf8' }).trim();
const write = (path: string, text: string) => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
};

/** An agent's checkpoint: a commit on top of the base made in a linked worktree that is removed again. */
function checkpoint(name: string, files: Record<string, string>): { checkpointCommit: string; checkpointTree: string } {
  const tree = join(root, `wt-${name}`);
  git(repo, 'worktree', 'add', '--detach', tree, base);
  for (const [file, text] of Object.entries(files)) write(join(tree, file), text);
  git(tree, 'add', '-A');
  git(tree, 'commit', '-m', `agent ${name}`);
  const commit = git(tree, 'rev-parse', 'HEAD');
  const checkpointTree = git(tree, 'rev-parse', 'HEAD^{tree}');
  git(repo, 'worktree', 'remove', '--force', tree);
  git(repo, 'update-ref', `refs/agide/review/${name}`, commit);
  return { checkpointCommit: commit, checkpointTree };
}

const stepOf = (agent: string, files: Record<string, string>) => ({ agent, changesetId: `cs_${agent}`, baseCommit: base, patchPath: 'none', ...checkpoint(agent, files) });
const commonDir = () => join(repo, '.git');

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'review-merger-')));
  repo = join(root, 'repo');
  mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  write(join(repo, 'a.txt'), 'one\ntwo\nthree\n');
  write(join(repo, 'b.txt'), 'b\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'base');
  base = git(repo, 'rev-parse', 'HEAD');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('git merger', () => {
  it('refuses a target checked out in a linked worktree and runs no filter from its config.worktree', async () => {
    const marker = join(root, 'filter-ran');
    git(repo, 'checkout', '-q', '-b', 'other');
    const agentTree = join(root, 'agent-wt');
    git(repo, 'worktree', 'add', '-q', agentTree, 'main');
    git(repo, 'config', 'extensions.worktreeConfig', 'true');
    write(join(repo, '.git', 'info', 'attributes'), '* filter=evil\n');
    git(agentTree, 'config', '--worktree', 'filter.evil.smudge', `sh -c 'touch ${marker}; cat'`);
    const outcome = await new GitMerger().merge({ repoPath: repo, commonDir: commonDir(), target: 'main', goal: 'g', steps: [stepOf('one', { 'c.txt': 'c\n' })], dryRun: false });
    expect(outcome.ok ? 'merged' : outcome.why, 'the merge is refused').toContain('not the main checkout');
    expect(existsSync(marker), 'the filter of the worktree config did not run').toBe(false);
    expect(git(repo, 'rev-parse', 'main'), 'the branch did not move').toBe(base);
  });

  it('merges one squash commit per step into the checked-out target and updates the work tree', async () => {
    const steps = [stepOf('one', { 'c.txt': 'c\n' }), stepOf('two', { 'b.txt': 'b2\n' })];
    const outcome = await new GitMerger().merge({ repoPath: repo, commonDir: commonDir(), target: 'main', goal: 'Add things\nsecond line', steps, dryRun: false });
    if (!outcome.ok) throw new Error(outcome.why);
    expect(outcome.from, 'the old tip is the base').toBe(base);
    expect(git(repo, 'rev-parse', 'main'), 'the branch moved to the last squash commit').toBe(outcome.to);
    expect(git(repo, 'log', '--format=%an|%s', `${base}..main`).split('\n'), 'one commit per changeset by the app, newest first').toEqual(['Agide|Agide: two (Add things)', 'Agide|Agide: one (Add things)']);
    expect([readFileSync(join(repo, 'c.txt'), 'utf8'), readFileSync(join(repo, 'b.txt'), 'utf8')], 'the checkout has both changes').toEqual(['c\n', 'b2\n']);
    expect(outcome.commits.map((entry) => entry.changesetId), 'a commit per step in order').toEqual(['cs_one', 'cs_two']);
  });

  it('moves nothing on a dry run', async () => {
    const steps = [stepOf('one', { 'c.txt': 'c\n' })];
    const outcome = await new GitMerger().merge({ repoPath: repo, commonDir: commonDir(), target: 'main', goal: 'g', steps, dryRun: true });
    expect(outcome.ok && outcome.commits.length, 'the dry run reports the commit').toBe(1);
    expect([git(repo, 'rev-parse', 'main'), existsSync(join(repo, 'c.txt'))], 'the branch and the checkout are unchanged').toEqual([base, false]);
  });

  it('reports the agents and files of a conflict and moves nothing', async () => {
    const steps = [stepOf('one', { 'a.txt': 'one\nTWO\nthree\n' }), stepOf('two', { 'a.txt': 'one\ntwo changed\nthree\n' })];
    const outcome = await new GitMerger().merge({ repoPath: repo, commonDir: commonDir(), target: 'main', goal: 'g', steps, dryRun: false });
    expect(outcome, 'the second step conflicts').toMatchObject({ ok: false, conflicts: [{ agents: ['two'], files: ['a.txt'] }] });
    expect(git(repo, 'rev-parse', 'main'), 'the branch is unchanged').toBe(base);
  });

  it('refuses a dirty checkout of the target', async () => {
    write(join(repo, 'b.txt'), 'uncommitted\n');
    const outcome = await new GitMerger().merge({ repoPath: repo, commonDir: commonDir(), target: 'main', goal: 'g', steps: [stepOf('one', { 'c.txt': 'c\n' })], dryRun: false });
    expect(outcome, 'refused with the path').toMatchObject({ ok: false, why: expect.stringContaining('commit or stash your changes') });
    expect(git(repo, 'rev-parse', 'main'), 'the branch is unchanged').toBe(base);
  });

  it('moves a branch no checkout has by compare-and-swap of its ref', async () => {
    git(repo, 'branch', 'release', base);
    const outcome = await new GitMerger().merge({ repoPath: repo, commonDir: commonDir(), target: 'release', goal: 'g', steps: [stepOf('one', { 'c.txt': 'c\n' })], dryRun: false });
    expect(outcome.ok, 'merged').toBe(true);
    expect([git(repo, 'rev-parse', 'release') === (outcome.ok ? outcome.to : ''), git(repo, 'rev-parse', 'main')], 'release moved and main did not').toEqual([true, base]);
  });

  it('refuses a branch no checkout has when it moved after its tip was read, and leaves it where the other move put it', async () => {
    git(repo, 'branch', 'release', base);
    const moved = git(repo, 'commit-tree', `${base}^{tree}`, '-p', base, '-m', 'someone else');
    const racing = new GitMerger(undefined, () => void git(repo, 'update-ref', 'refs/heads/release', moved));
    const outcome = await racing.merge({ repoPath: repo, commonDir: commonDir(), target: 'release', goal: 'g', steps: [stepOf('one', { 'c.txt': 'c\n' })], dryRun: false });
    expect(outcome, 'refused as moved meanwhile').toMatchObject({ ok: false, why: expect.stringContaining('moved meanwhile') });
    expect(git(repo, 'rev-parse', 'release'), 'the other move stands').toBe(moved);
  });

  it('refuses a fast-forward in the main checkout when the target moved after its tip was read', async () => {
    const racing = new GitMerger(undefined, () => {
      write(join(repo, 'racer.txt'), 'r\n');
      git(repo, 'add', '-A');
      git(repo, 'commit', '-q', '-m', 'racer');
    });
    const outcome = await racing.merge({ repoPath: repo, commonDir: commonDir(), target: 'main', goal: 'g', steps: [stepOf('one', { 'c.txt': 'c\n' })], dryRun: false });
    expect(outcome, 'refused as moved meanwhile').toMatchObject({ ok: false, why: expect.stringContaining('moved meanwhile') });
    expect(existsSync(join(repo, 'c.txt')), 'the agent work did not land').toBe(false);
  });

  it('applies no attribute of the repository in the merge, so a union attribute does not hide a conflict', async () => {
    write(join(repo, '.gitattributes'), 'a.txt merge=union\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'attributes');
    base = git(repo, 'rev-parse', 'HEAD');
    const steps = [stepOf('one', { 'a.txt': 'one\nTWO\nthree\n' }), stepOf('two', { 'a.txt': 'one\ntwo changed\nthree\n' })];
    // With the repository as the working directory, git would read its work tree attributes.
    const home = process.cwd();
    process.chdir(repo);
    const outcome = await new GitMerger().merge({ repoPath: repo, commonDir: commonDir(), target: 'main', goal: 'g', steps, dryRun: false }).finally(() => process.chdir(home));
    expect(outcome, 'the second step conflicts although the file is marked for a union merge').toMatchObject({ ok: false, conflicts: [{ agents: ['two'], files: ['a.txt'] }] });
  });

  it('refuses a name that is not a local branch', async () => {
    for (const target of ['nope', '-x', 'a..b']) {
      const outcome = await new GitMerger().merge({ repoPath: repo, commonDir: commonDir(), target, goal: 'g', steps: [stepOf(`s${target.length}`, { 'c.txt': 'c\n' })], dryRun: false });
      expect(outcome.ok, `${target} is refused`).toBe(false);
    }
  });

  it('runs no filter, merge driver or hook that the repository names', async () => {
    const steps = [stepOf('one', { 'a.txt': 'one\ntwo\nthree\nfour\n' }), stepOf('two', { 'b.txt': 'b2\n' })];
    const marker = join(root, 'ran');
    write(join(repo, '.git', 'info', 'attributes'), '* filter=evil merge=evil\n');
    git(repo, 'config', 'filter.evil.clean', `touch ${marker}-clean`);
    git(repo, 'config', 'filter.evil.smudge', `touch ${marker}-smudge`);
    git(repo, 'config', 'merge.evil.driver', `touch ${marker}-driver; false`);
    write(join(repo, '.git', 'hooks', 'post-merge'), `#!/bin/sh\ntouch ${marker}-hook\n`);
    execFileSync('chmod', ['+x', join(repo, '.git', 'hooks', 'post-merge')]);
    execFileSync('git', ['config', 'core.hooksPath', join(repo, '.git', 'hooks')], { cwd: repo });
    const outcome = await new GitMerger().merge({ repoPath: repo, commonDir: commonDir(), target: 'main', goal: 'g', steps, dryRun: false });
    expect(outcome.ok, 'the merge itself succeeds').toBe(true);
    expect(['clean', 'smudge', 'driver', 'hook'].filter((name) => existsSync(`${marker}-${name}`)), 'nothing the repository configured ran').toEqual([]);
  });
});
