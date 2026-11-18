import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRepositoryWithRemote, git, gitEnv, type TestRepository } from './fixtures/gitRepo';
import { GitWorkingDirectoryManager } from './GitWorkingDirectoryManager';
import { TaskStartError } from './types';

let fixture: TestRepository;
let base: string;
let manager: GitWorkingDirectoryManager;

beforeEach(() => {
  fixture = createRepositoryWithRemote({ claudeMd: 'Use pnpm.\n' });
  base = realpathSync(mkdtempSync(join(tmpdir(), 'tasks-base-')));
  manager = new GitWorkingDirectoryManager({ baseDir: base, appRoot: join(base, 'app-root'), env: gitEnv, knownRepositories: () => [fixture.repo] });
});
afterEach(() => {
  rmSync(fixture.root, { recursive: true, force: true });
  rmSync(base, { recursive: true, force: true });
});

describe('repository lookup', () => {
  it('finds the known repository whose remote points at owner/repo', async () => {
    expect(await manager.findRepository('acme', 'app'), 'matching repository').toEqual({ repoPath: fixture.repo, remote: 'origin' });
    expect(await manager.findRepository('acme', 'other'), 'no match').toBeUndefined();
  });

  it('reads CLAUDE.md at a commit and nothing for a commit without it', async () => {
    expect(await manager.readFileAtRevision(fixture.repo, fixture.mainCommit, 'CLAUDE.md'), 'guidance').toBe('Use pnpm.\n');
    expect(await manager.readFileAtRevision(fixture.repo, fixture.mainCommit, 'MISSING.md'), 'missing file').toBeUndefined();
  });
});

describe('revision resolution', () => {
  it('reads a file at a remote branch name', async () => {
    expect(await manager.readFileAtRevision(fixture.repo, 'origin/main', 'CLAUDE.md'), 'guidance at the remote branch').toBe('Use pnpm.\n');
  });

  it('resolves every revision after --end-of-options', async () => {
    const calls: string[][] = [];
    const spy = new GitWorkingDirectoryManager({
      baseDir: base,
      appRoot: join(base, 'app-root'),
      env: gitEnv,
      knownRepositories: () => [],
      exec: (_file, args) => {
        calls.push([...args]);
        return Promise.reject(new Error('stop'));
      },
    });
    await spy.readFileAtRevision(fixture.repo, '--output=/tmp/x', 'CLAUDE.md');
    expect(calls[0], 'rev-parse call').toContain('--end-of-options');
    expect(calls[0]?.indexOf('--end-of-options'), 'option terminator before the revision').toBeLessThan(calls[0]?.findIndex((a) => a.startsWith('--output')) ?? -1);
  });
});

describe('worktrees', () => {
  it('creates a worktree of a pull request from the pull ref outside the repository', async () => {
    const info = await manager.createWorktree({ repoPath: fixture.repo, remote: 'origin', folderId: 'folder1', branch: 'agide/pr-1', pullRequest: 1 });
    expect(info.base, 'commit of the pull ref').toBe(fixture.pullCommit);
    expect(info.path, 'path under the base directory').toBe(join(base, 'worktrees', 'app-folder1'));
    expect(existsSync(join(info.path, 'upload.ts')), 'pull request file checked out').toBe(true);
    expect(git(info.path, 'rev-parse', '--abbrev-ref', 'HEAD'), 'branch').toBe('agide/pr-1');
    expect(manager.createdByApp(info.path), 'created by the app').toBe(true);
  });

  it('creates a worktree for a prompt from origin/HEAD and falls back to the local base when the fetch fails', async () => {
    const ok = await manager.createWorktree({ repoPath: fixture.repo, remote: 'origin', folderId: 'folder2', branch: 'agide/task-folder2' });
    expect(ok.base, 'default base is the remote head').toBe(fixture.mainCommit);
    expect(ok.warnings, 'no warning').toBeUndefined();
    git(fixture.repo, 'remote', 'remove', 'origin');
    const fallback = await manager.createWorktree({ repoPath: fixture.repo, remote: 'origin', folderId: 'folder3', branch: 'agide/task-folder3' });
    expect(fallback.base, 'local HEAD').toBe(fixture.mainCommit);
    expect(fallback.warnings?.[0], 'warning names the failed fetch').toContain('git fetch origin failed');
  });

  it('resolves a base once to a commit and refuses one that starts with a dash', async () => {
    await expect(manager.createWorktree({ repoPath: fixture.repo, remote: 'origin', folderId: 'f4', branch: 'agide/x', base: '--orphan' }), 'option-like base').rejects.toMatchObject({ code: 'invalid_source' });
    await expect(manager.createWorktree({ repoPath: fixture.repo, remote: 'origin', folderId: 'f5', branch: 'agide/y', base: 'no-such-ref' }), 'unknown base').rejects.toMatchObject({ code: 'git_failed' });
    const info = await manager.createWorktree({ repoPath: fixture.repo, remote: 'origin', folderId: 'f6', branch: 'agide/z', base: 'main' });
    expect(info.base, 'main resolved to its commit id').toBe(fixture.mainCommit);
  });

  it('never overwrites an existing branch: it adds the folder id', async () => {
    await manager.createWorktree({ repoPath: fixture.repo, remote: 'origin', folderId: 'aaaaaa1', branch: 'agide/pr-1', pullRequest: 1 });
    const second = await manager.createWorktree({ repoPath: fixture.repo, remote: 'origin', folderId: 'bbbbbb2', branch: 'agide/pr-1', pullRequest: 1 });
    expect(second.branch, 'suffix from the folder id').toBe('agide/pr-1-bbbbbb');
  });

  it('refuses an invalid branch name and a directory inside the application root', async () => {
    await expect(manager.createWorktree({ repoPath: fixture.repo, remote: 'origin', folderId: 'f7', branch: 'agide/bad..name' }), 'invalid ref name').rejects.toBeInstanceOf(TaskStartError);
    const inside = new GitWorkingDirectoryManager({ baseDir: join(base, 'app-root'), appRoot: join(base, 'app-root'), env: gitEnv, knownRepositories: () => [] });
    await expect(inside.createWorktree({ repoPath: fixture.repo, remote: 'origin', folderId: 'f8', branch: 'agide/q' }), 'inside the root').rejects.toMatchObject({ code: 'not_allowed' });
  });

  it('removes a worktree, refuses with uncommitted changes unless forced, and deletes the branch only on request', async () => {
    const info = await manager.createWorktree({ repoPath: fixture.repo, remote: 'origin', folderId: 'f9', branch: 'agide/r' });
    const full = { ...info, repoPath: fixture.repo };
    await import('node:fs').then(({ writeFileSync }) => writeFileSync(join(info.path, 'dirty.txt'), 'x'));
    await expect(manager.removeWorktree(full, { force: false, deleteBranch: false }), 'dirty worktree').rejects.toMatchObject({ code: 'git_failed' });
    await manager.removeWorktree(full, { force: true, deleteBranch: false });
    expect(existsSync(info.path), 'directory removed').toBe(false);
    expect(git(fixture.repo, 'branch', '--list', 'agide/r'), 'branch kept').toContain('agide/r');
    expect(readFileSync(join(fixture.repo, 'README.md'), 'utf8'), 'main checkout untouched').toBe('readme\n');
  });

  it('creates the default directory 0700 for a start without a repository', () => {
    const previous = process.env['AGIDE_SESSION_CWD'];
    process.env['AGIDE_SESSION_CWD'] = join(base, 'plain');
    try {
      const dir = manager.defaultDir('f10');
      expect(existsSync(dir), 'directory created').toBe(true);
      expect(manager.createdByApp(dir), 'created by the app').toBe(true);
    } finally {
      if (previous === undefined) delete process.env['AGIDE_SESSION_CWD'];
      else process.env['AGIDE_SESSION_CWD'] = previous;
    }
  });
});
