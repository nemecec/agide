import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkClaudeLogin } from '../profile/claudeLogin';
import { cloneWithCp, filesystemOf, removeTree } from '../review/capture/CheckClones';
import { execGit } from '../review/capture/guardedGit';
import { GitMerger } from '../review/manager/GitMerger';
import { systemProcessTable } from '../review/capture/ProcessSweep';
import { execFileNoShell } from '../tasks/exec';
import { HostTools, setHostTools } from './hostTools';

/**
 * Each place that starts a program on the host finds it through `hostTools` or by a fixed path. A stand-in of the
 * same name that lies in a directory the agent may write, or that a relative PATH entry or the working directory
 * reaches, never runs.
 */

let dir: string;
let restore: () => void;
let savedPath: string | undefined;
const markerOf = (name: string): string => join(dir, 'markers', name);

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'host-sites-')));
  mkdirSync(join(dir, 'markers'));
  savedPath = process.env['PATH'];
  restore = () => undefined;
});
afterEach(() => {
  restore();
  process.env['PATH'] = savedPath;
  rmSync(dir, { recursive: true, force: true });
});

/** A program that writes a marker and then does what the real one would not: it exits 0 with no output. */
const stand = (directory: string, names: readonly string[]): void => {
  mkdirSync(directory, { recursive: true });
  for (const name of names) {
    const path = join(directory, name);
    writeFileSync(path, `#!/bin/sh\ntouch '${markerOf(name)}'\nexit 0\n`);
    chmodSync(path, 0o755);
  }
};

/** The shared tools find programs on `agent/bin` first and on the real PATH after it, and exclude `agent`. */
const excludeAgent = (): void => {
  stand(join(dir, 'agent', 'bin'), ['git', 'claude']);
  restore = setHostTools(new HostTools({ appPath: `${join(dir, 'agent', 'bin')}:${savedPath ?? ''}`, excluded: () => [join(dir, 'agent')] }));
};

describe('git and gh through the shared tools', () => {
  it('runs the git of a trusted directory for a capture call, whatever stands first on the PATH', async () => {
    excludeAgent();
    const { stdout } = await execGit(['--version'], { env: {}, timeoutMs: 20_000 });
    expect(stdout.toString('utf8'), 'the real git answered').toContain('git version');
    expect(existsSync(markerOf('git')), 'the stand-in did not run').toBe(false);
  });

  it('runs the git of a trusted directory for a task or a swarm worktree call', async () => {
    excludeAgent();
    const { stdout } = await execFileNoShell('git', ['--version'], { env: {}, timeoutMs: 20_000 });
    expect(stdout, 'the real git answered').toContain('git version');
    expect(existsSync(markerOf('git')), 'the stand-in did not run').toBe(false);
  });

  it('runs the git of a trusted directory for a merge', async () => {
    excludeAgent();
    const repo = join(dir, 'repo');
    mkdirSync(repo);
    const git = (...args: string[]) => execFileSync('/usr/bin/git', args, { cwd: repo, encoding: 'utf8', env: { PATH: '/usr/bin:/bin', GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't.invalid', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't.invalid' } }).trim();
    git('init', '-q', '-b', 'main');
    writeFileSync(join(repo, 'a'), 'a\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'base');
    const outcome = await new GitMerger(() => ({})).merge({ repoPath: repo, commonDir: join(repo, '.git'), target: 'main', goal: 'g', steps: [], dryRun: true });
    expect(outcome.ok, 'the real git resolved the branch').toBe(true);
    expect(existsSync(markerOf('git')), 'the stand-in did not run').toBe(false);
  });

  it('reports a git that exists only in a directory the agent may write as a failed call, not as a run', async () => {
    stand(join(dir, 'agent', 'bin'), ['git']);
    restore = setHostTools(new HostTools({ appPath: join(dir, 'agent', 'bin'), excluded: () => [join(dir, 'agent')], fixedDirectories: [] }));
    await expect(execGit(['--version'], { env: {}, timeoutMs: 20_000 }), 'the only git is the stand-in').rejects.toThrow('exists only in a directory that an agent may write');
    expect(existsSync(markerOf('git')), 'the stand-in did not run').toBe(false);
  });

  it('runs the claude of a trusted directory for the login check', async () => {
    stand(join(dir, 'agent', 'bin'), ['claude']);
    mkdirSync(join(dir, 'trusted'));
    writeFileSync(join(dir, 'trusted', 'claude'), '#!/bin/sh\necho \'{"authMethod":"oauth"}\'\n', { mode: 0o755 });
    restore = setHostTools(new HostTools({ appPath: `${join(dir, 'agent', 'bin')}:${join(dir, 'trusted')}`, excluded: () => [join(dir, 'agent')], fixedDirectories: [] }));
    expect(await checkClaudeLogin('claude', {}), 'the trusted claude answered').toEqual({ signedIn: true, authMethod: 'oauth' });
    expect(existsSync(markerOf('claude')), 'the stand-in did not run').toBe(false);
  });
});

describe('the system tools of the review', () => {
  const plantOnPath = (names: string[]): void => {
    stand(join(dir, 'planted'), names);
    process.env['PATH'] = `${join(dir, 'planted')}:.:${savedPath ?? ''}`;
  };

  it('asks df, chmod and cp by their fixed paths', async () => {
    plantOnPath(['df', 'chmod', 'cp']);
    expect(await filesystemOf(dir), 'the real df named the filesystem').not.toBe('');
    mkdirSync(join(dir, 'locked', 'inner'), { recursive: true });
    writeFileSync(join(dir, 'locked', 'inner', 'f'), 'x');
    chmodSync(join(dir, 'locked', 'inner'), 0o555);
    chmodSync(join(dir, 'locked'), 0o555);
    await removeTree(join(dir, 'locked'));
    expect(existsSync(join(dir, 'locked')), 'the real chmod made the tree removable').toBe(false);
    mkdirSync(join(dir, 'source'));
    writeFileSync(join(dir, 'source', 'f'), 'x');
    await cloneWithCp(join(dir, 'source'), join(dir, 'copy'), new AbortController().signal).catch(() => undefined);
    expect(['df', 'chmod', 'cp'].filter((name) => existsSync(markerOf(name))), 'no stand-in ran').toEqual([]);
  });

  it('reads the process table with ps and lsof by their fixed paths', async () => {
    plantOnPath(['ps', 'lsof']);
    await systemProcessTable({ roots: [join(dir, 'checks')] }).list();
    expect(['ps', 'lsof'].filter((name) => existsSync(markerOf(name))), 'no stand-in ran').toEqual([]);
  });
});
