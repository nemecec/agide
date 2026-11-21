import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { gitTestEnv, makeRepo } from '../manager/testRig';
import { Git, GitError, parseNumstat } from './git';
import { SwarmWorkspaces } from './SwarmWorkspaces';

describe('swarm workspaces over a temporary repository', () => {
  let repo: ReturnType<typeof makeRepo>;
  let root: string;
  let workspaces: SwarmWorkspaces;
  beforeEach(() => {
    repo = makeRepo();
    root = `${repo.dir}-swarm`;
    mkdirSync(root);
    workspaces = new SwarmWorkspaces({ git: new Git(undefined, gitTestEnv), dataRoot: join(root, 'data'), worktreeBase: join(root, 'wt'), appRoot: join(root, 'app') });
  });
  afterEach(() => {
    rmSync(repo.dir, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  });

  const request = (name: string, workspace: 'worktree' | 'readonly' | 'scratch' = 'worktree') => ({
    swarmId: 'abcdef123456',
    name,
    workspace,
    repoPath: repo.dir,
    baseCommit: repo.commit,
  });

  it('creates a worktree on a swarm branch from the base commit and never reuses a path or a branch', async () => {
    const first = await workspaces.prepare(request('impl'));
    expect(first.branch, 'branch named by swarm and agent').toBe('agide/swarm-abcdef12/impl');
    expect(readFileSync(join(first.cwd, 'src/a.ts'), 'utf8'), 'the base files are checked out').toContain('a = 1');
    expect(existsSync(join(first.inputsDir)), 'an inputs directory exists').toBe(true);
    const second = await workspaces.prepare(request('impl'));
    expect(second.cwd, 'a second worktree for the same name gets another path').not.toBe(first.cwd);
    expect(second.branch, 'and another branch').not.toBe(first.branch);
    expect(repo.git('branch', '--list', 'agide/swarm-*').split('\n').length, 'both branches exist').toBe(2);
  });

  it('refuses a worktree inside the app data directory', async () => {
    const inside = new SwarmWorkspaces({ git: new Git(undefined, gitTestEnv), dataRoot: join(root, 'data'), worktreeBase: join(root, 'app', 'wt'), appRoot: join(root, 'app') });
    await expect(inside.prepare(request('impl')), 'inside the app root').rejects.toThrow('data directory of the app');
  });

  it('puts scratch and inputs directories under the agent root, outside the app root where the launch denies Read and Edit', async () => {
    const split = new SwarmWorkspaces({ git: new Git(undefined, gitTestEnv), dataRoot: join(root, 'app', 'swarms'), agentRoot: join(root, 'agents'), worktreeBase: join(root, 'wt'), appRoot: join(root, 'app') });
    const prepared = await split.prepare({ swarmId: 'abcdef123456', name: 'notes', workspace: 'scratch' });
    expect(prepared.cwd, 'the scratch directory is under the agent root').toBe(join(root, 'agents', 'abcdef123456', 'scratch', 'notes'));
    expect(prepared.inputsDir, 'the inputs directory is under the agent root').toBe(join(root, 'agents', 'abcdef123456', 'inputs', 'notes'));
    expect(split.patchPath('abcdef123456', 'notes'), 'patches stay in the data directory').toBe(join(root, 'app', 'swarms', 'abcdef123456', 'notes.patch'));
    const inside = new SwarmWorkspaces({ git: new Git(undefined, gitTestEnv), dataRoot: join(root, 'app', 'swarms'), worktreeBase: join(root, 'wt'), appRoot: join(root, 'app') });
    await expect(inside.prepare({ swarmId: 'abcdef123456', name: 'notes', workspace: 'scratch' }), 'a scratch directory inside the app root is refused').rejects.toThrow('data directory of the app');
  });

  it('collects new, changed and committed files into a stored patch with private permissions', async () => {
    const prepared = await workspaces.prepare(request('impl'));
    writeFileSync(join(prepared.cwd, 'src/a.ts'), 'export const a = 2;\n');
    writeFileSync(join(prepared.cwd, 'new.txt'), 'one\ntwo\n');
    const git = new Git(undefined, gitTestEnv);
    await git.run(prepared.cwd, ['add', 'src/a.ts']);
    await git.run(prepared.cwd, ['commit', '-m', 'bump a'], { identity: true });
    writeFileSync(join(prepared.cwd, 'src/b.ts'), 'export const b = 3;\n');
    const stored = await workspaces.collect('abcdef123456', 'impl', prepared.cwd, repo.commit);
    expect(stored.numstat.map((row) => [row.path, row.added, row.removed]).sort(), 'a committed, a changed and a new file').toEqual([
      ['new.txt', 2, 0],
      ['src/a.ts', 1, 1],
      ['src/b.ts', 1, 1],
    ]);
    expect(
      stored.commits.map((commit) => commit.subject),
      'the agent commit',
    ).toEqual(['bump a']);
    expect(stored.patch, 'the patch has the new file').toContain('+two');
    expect(statSync(stored.patchFile).mode & 0o777, 'patch file mode').toBe(0o600);
    expect(statSync(workspaces.swarmDir('abcdef123456')).mode & 0o777, 'patch directory mode').toBe(0o700);
    expect((await workspaces.readPatch(stored.patchFile)).truncated, 'a small patch is not cut').toBe(false);
  });

  it('builds a merge preview from earlier patches, commits it, and names a patch that does not apply', async () => {
    const one = await workspaces.prepare(request('one'));
    writeFileSync(join(one.cwd, 'src/a.ts'), 'export const a = 10;\n');
    const two = await workspaces.prepare(request('two'));
    writeFileSync(join(two.cwd, 'src/a.ts'), 'export const a = 20;\n');
    writeFileSync(join(two.cwd, 'extra.txt'), 'x\n');
    const patchOne = await workspaces.collect('abcdef123456', 'one', one.cwd, repo.commit);
    const patchTwo = await workspaces.collect('abcdef123456', 'two', two.cwd, repo.commit);
    const preview = await workspaces.prepare(request('review', 'readonly'), [
      { agent: 'one', patchFile: patchOne.patchFile },
      { agent: 'two', patchFile: patchTwo.patchFile },
    ]);
    expect(readFileSync(join(preview.cwd, 'src/a.ts'), 'utf8'), 'the first patch applied').toContain('a = 10');
    expect(preview.conflicts, 'the second patch conflicts on src/a.ts and is named').toEqual([{ agent: 'two', files: expect.arrayContaining(['src/a.ts', 'extra.txt']) }]);
    expect(existsSync(join(preview.cwd, 'extra.txt')), 'a patch that fails leaves no partial change').toBe(false);
    expect(existsSync(join(preview.inputsDir, 'two.patch')), 'the failed patch is handed over as a file').toBe(true);
    expect(preview.base, 'the collection diffs against the preview commit').not.toBe(repo.commit);
    expect((await workspaces.collect('abcdef123456', 'review', preview.cwd, preview.base!)).numstat, 'the earlier changes are not edits of the reviewer').toEqual([]);
    await workspaces.removeReadonly(repo.dir, preview.cwd);
    expect(existsSync(preview.cwd), 'a readonly worktree is removed').toBe(false);
  });

  it('removes a clean worktree without force and deletes a merged branch, keeps an unmerged one', async () => {
    const clean = await workspaces.prepare(request('clean'));
    const removal = await workspaces.removeWorktree({
      swarmId: 'abcdef123456',
      agent: 'clean',
      repo: repo.dir,
      cwd: clean.cwd,
      branch: clean.branch,
      base: repo.commit,
      deleteBranch: false,
    });
    expect(removal, 'removed without force, and its branch, which holds nothing new, is merged').toMatchObject({ removed: true, forced: false, branchDeleted: true });
    expect(existsSync(clean.cwd), 'the directory is gone').toBe(false);
    const work = await workspaces.prepare(request('work'));
    writeFileSync(join(work.cwd, 'c.txt'), 'c\n');
    await new Git(undefined, gitTestEnv).run(work.cwd, ['add', 'c.txt']);
    await new Git(undefined, gitTestEnv).run(work.cwd, ['commit', '-m', 'c'], { identity: true });
    const kept = await workspaces.removeWorktree({
      swarmId: 'abcdef123456',
      agent: 'work',
      repo: repo.dir,
      cwd: work.cwd,
      branch: work.branch,
      base: repo.commit,
      deleteBranch: false,
    });
    expect(kept, 'an unmerged branch stays').toMatchObject({ removed: true, branchDeleted: false });
    expect(repo.git('branch', '--list', work.branch!), 'the branch is still there').toContain('agide/swarm-abcdef12/work');
  });

  it('keeps a worktree with changes when its stored patch does not apply to the base', async () => {
    class UnappliablePatch extends Git {
      override async verifyPatch(): Promise<void> {
        throw new GitError('the stored patch does not apply');
      }
    }
    const strict = new SwarmWorkspaces({ git: new UnappliablePatch(undefined, gitTestEnv), dataRoot: join(root, 'data'), worktreeBase: join(root, 'wt'), appRoot: join(root, 'app') });
    const work = await strict.prepare(request('edited'));
    writeFileSync(join(work.cwd, 'src/a.ts'), 'export const a = 2;\n');
    const removal = await strict.removeWorktree({ swarmId: 'abcdef123456', agent: 'edited', repo: repo.dir, cwd: work.cwd, branch: work.branch, base: repo.commit, deleteBranch: false });
    expect(removal, 'the removal is refused with a note').toMatchObject({ removed: false, forced: false });
    expect(removal.note, 'the note says the worktree is kept').toMatch(/^kept:/);
    expect(existsSync(work.cwd), 'the worktree is still on disk').toBe(true);
  });

  it('runs worktree remove without --force for a clean worktree and with it only for one with changes', async () => {
    const calls: string[][] = [];
    const recording = new SwarmWorkspaces({
      git: new Git(async (file, args, options) => {
        calls.push([...args]);
        return (await import('../../tasks/exec')).execFileNoShell(file, args, options);
      }, gitTestEnv),
      dataRoot: join(root, 'data'),
      worktreeBase: join(root, 'wt'),
      appRoot: join(root, 'app'),
    });
    const clean = await recording.prepare(request('clean'));
    await recording.removeWorktree({ swarmId: 'abcdef123456', agent: 'clean', repo: repo.dir, cwd: clean.cwd, branch: clean.branch, base: repo.commit, deleteBranch: false });
    expect(
      calls.filter((args) => args.includes('remove')).map((args) => args.includes('--force')),
      'no force for a clean worktree',
    ).toEqual([false]);
    const dirty = await recording.prepare(request('dirty'));
    writeFileSync(join(dirty.cwd, 'x.txt'), 'x');
    await recording.removeWorktree({ swarmId: 'abcdef123456', agent: 'dirty', repo: repo.dir, cwd: dirty.cwd, branch: dirty.branch, base: repo.commit, deleteBranch: false });
    expect(
      calls.filter((args) => args.includes('remove')).map((args) => args.includes('--force')),
      'force after the patch for the other',
    ).toEqual([false, true]);
  });

  it('stores a patch before it removes a worktree with changes, and keeps the worktree when it cannot', async () => {
    const dirty = await workspaces.prepare(request('dirty'));
    writeFileSync(join(dirty.cwd, 'precious.txt'), 'do not lose\n');
    const removal = await workspaces.removeWorktree({
      swarmId: 'abcdef123456',
      agent: 'dirty',
      repo: repo.dir,
      cwd: dirty.cwd,
      branch: dirty.branch,
      base: repo.commit,
      deleteBranch: false,
    });
    expect(removal, 'forced after the patch').toMatchObject({ removed: true, forced: true });
    expect(readFileSync(removal.patchFile!, 'utf8'), 'the patch holds the uncommitted file').toContain('+do not lose');
    const blocked = await workspaces.prepare(request('blocked'));
    writeFileSync(join(blocked.cwd, 'precious.txt'), 'still here\n');
    rmSync(workspaces.patchPath('abcdef123456', 'blocked', '-removal'), { force: true });
    const dir = workspaces.swarmDir('abcdef123456');
    mkdirSync(join(dir, 'blocked-removal.patch'));
    const refused = await workspaces.removeWorktree({
      swarmId: 'abcdef123456',
      agent: 'blocked',
      repo: repo.dir,
      cwd: blocked.cwd,
      branch: blocked.branch,
      base: repo.commit,
      deleteBranch: false,
    });
    expect(refused.removed, 'no patch, no removal').toBe(false);
    expect(readFileSync(join(blocked.cwd, 'precious.txt'), 'utf8'), 'the file is still in the worktree').toBe('still here\n');
  });

  it('keeps scratch directories private and removes them with the inputs', async () => {
    const scratch = await workspaces.prepare({ swarmId: 'abcdef123456', name: 'tmp', workspace: 'scratch' });
    expect(statSync(scratch.cwd).mode & 0o777, 'scratch directory mode').toBe(0o700);
    await workspaces.removeScratchAndInputs('abcdef123456');
    expect(existsSync(scratch.cwd), 'removed with the swarm').toBe(false);
  });

  it('refuses a worktree workspace without a repository', async () => {
    await expect(workspaces.prepare({ swarmId: 'abcdef123456', name: 'x', workspace: 'worktree' }), 'no repository').rejects.toThrow('needs a repository');
  });
});

describe('numstat parsing', () => {
  it('reads added and removed counts, binary files as zero, and paths with tabs', () => {
    expect(parseNumstat('1\t2\ta.ts\0-\t-\timg.png\0')).toEqual([
      { path: 'a.ts', added: 1, removed: 2 },
      { path: 'img.png', added: 0, removed: 0 },
    ]);
  });
});
