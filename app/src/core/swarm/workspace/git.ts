import { lstat, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { ExecError, execFileNoShell, type Exec } from '../../tasks/exec';

export const GIT_TIMEOUT_MS = 60_000;

export class GitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitError';
  }
}

export interface NumstatRow {
  readonly path: string;
  readonly added: number;
  readonly removed: number;
}

export interface Collected {
  /** The bytes of the patch, one character per byte (`latin1`); write it back with the same encoding. */
  readonly patch: string;
  readonly numstat: readonly NumstatRow[];
  readonly commits: readonly { readonly sha: string; readonly subject: string }[];
}

/**
 * Settings for every git call in a directory an agent can write: no command from the repository's configuration
 * runs, and a diff does not depend on the user's own diff settings.
 */
export const GUARD_CONFIG = [
  'core.fsmonitor=false',
  'core.hooksPath=/dev/null',
  'core.untrackedCache=false',
  'core.attributesFile=/dev/null',
  'core.autocrlf=false',
  'core.safecrlf=false',
  'core.pager=cat',
  'color.ui=never',
  'diff.noprefix=false',
  'diff.mnemonicPrefix=false',
  'diff.external=',
  'diff.renames=false',
] as const;
/** The empty tree: attributes come from nowhere in the worktree, so no `filter` or `diff` driver of the repository runs on an agent's files. */
export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const DIFF_FLAGS = ['--no-ext-diff', '--no-textconv', '--no-color', '--no-renames', '--src-prefix=a/', '--dst-prefix=b/'] as const;

/** Lists every `filter.<name>.*` and `merge.<name>.*` of the effective configuration, for `driverSettings`. */
export const DRIVER_LISTING = ['config', '--includes', '--null', '--get-regexp', '^(filter|merge)\\.'] as const;

/**
 * The keys that blank the drivers named in a `DRIVER_LISTING` output. `info/attributes` of the common directory can
 * name a driver that `--attr-source` does not switch off, so every named filter and merge driver is set empty.
 */
export function driverSettings(listing: string): string[] {
  const keys = new Set<string>();
  for (const entry of listing.split('\0')) {
    const key = entry.split('\n')[0] ?? '';
    const filter = /^filter\.(.+)\.(clean|smudge|process|required)$/i.exec(key);
    if (filter !== null) {
      for (const variable of ['clean', 'smudge', 'process', 'required']) keys.add(`filter.${filter[1]}.${variable}`);
      continue;
    }
    const merge = /^merge\.(.+)\.(driver|name|recursive)$/i.exec(key);
    if (merge !== null) keys.add(`merge.${merge[1]}.driver`);
  }
  return [...keys];
}

/** The environment that sets each key of `driverSettings` empty (`required` false), without the system attributes file. */
export function blankingEnv(keys: readonly string[]): Record<string, string> {
  const env: Record<string, string> = { GIT_ATTR_NOSYSTEM: '1', GIT_CONFIG_COUNT: String(keys.length) };
  keys.forEach((key, index) => {
    env[`GIT_CONFIG_KEY_${index}`] = key;
    env[`GIT_CONFIG_VALUE_${index}`] = key.endsWith('.required') ? 'false' : '';
  });
  return env;
}

export const COMMIT_IDENTITY = { GIT_AUTHOR_NAME: 'Agide', GIT_AUTHOR_EMAIL: 'agide.invalid', GIT_COMMITTER_NAME: 'Agide', GIT_COMMITTER_EMAIL: 'agide.invalid' };

/**
 * The git steps of swarm workspaces. Every call runs through `execFile` without a shell, with a timeout. Values
 * that came from a caller never reach git as options: revisions are resolved with `--end-of-options`, paths and
 * branch names follow `--`.
 */
export class Git {
  /** The git directory git itself created for each worktree, by real path of the worktree. */
  private readonly registered = new Map<string, string>();

  constructor(
    private readonly exec: Exec = execFileNoShell,
    private readonly env: () => NodeJS.ProcessEnv = () => process.env,
    private readonly timeoutMs: number = GIT_TIMEOUT_MS,
  ) {}

  /**
   * `guard` ties the call to the registered git directory of a worktree and switches off the repository's command
   * settings; `blank` (implied by `guard`) also sets every filter and merge driver of the effective configuration empty.
   */
  async run(cwd: string, args: readonly string[], options: { readonly identity?: boolean; readonly raw?: boolean; readonly guard?: boolean; readonly blank?: boolean } = {}): Promise<string> {
    const prefix = options.guard === true ? await this.guardArgs(cwd) : ['-C', cwd];
    const blanking = options.guard === true || options.blank === true ? blankingEnv(await this.driverKeys(prefix)) : {};
    const env = { ...this.env(), ...blanking, ...(options.identity === true ? COMMIT_IDENTITY : {}) };
    try {
      return (await this.exec('git', [...prefix, ...args], { env, timeoutMs: this.timeoutMs, ...(options.raw === true ? { encoding: 'latin1' as const } : {}) })).stdout;
    } catch (error) {
      throw new GitError(error instanceof ExecError ? error.firstLine : error instanceof Error ? error.message : String(error));
    }
  }

  private async driverKeys(prefix: readonly string[]): Promise<string[]> {
    try {
      return driverSettings((await this.exec('git', [...prefix, ...DRIVER_LISTING], { env: this.env(), timeoutMs: this.timeoutMs })).stdout);
    } catch (error) {
      // `config --get-regexp` exits 1 without a message when nothing matches.
      if (error instanceof ExecError && error.stderr.trim() === '') return [];
      throw new GitError(error instanceof ExecError ? error.firstLine : error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Arguments that tie git to the directory the repository registered for the worktree. The `.git` entry inside
   * the worktree is agent-writable, so it must be a file that names the directory recorded when the worktree was
   * created (or, for a worktree of an earlier run, a registered directory outside the worktree). Command settings
   * of the repository are switched off and attributes of the worktree are not read.
   */
  private async guardArgs(worktree: string): Promise<string[]> {
    const root = await realpath(worktree);
    const entry = join(root, '.git');
    if (!(await lstat(entry)).isFile()) throw new GitError('the .git entry of the worktree is not a file');
    const pointer = /^gitdir: (.+)$/m.exec(await readFile(entry, 'utf8'));
    if (pointer === null) throw new GitError('the .git file of the worktree does not name a git directory');
    const gitDir = resolve(root, pointer[1]!.trim());
    const recorded = this.registered.get(root);
    if (recorded !== undefined && recorded !== gitDir) throw new GitError('the .git file of the worktree names another git directory than the one created for it');
    const inside = relative(root, gitDir);
    if (inside === '' || (!inside.startsWith('..') && !isAbsolute(inside))) throw new GitError('the .git file of the worktree points to a directory inside the worktree');
    if (basename(dirname(gitDir)) !== 'worktrees') throw new GitError('the .git file of the worktree does not point into a worktrees directory');
    const registered = (await readFile(join(gitDir, 'gitdir'), 'utf8').catch(() => '')).trim();
    if (registered === '' || (await realpath(dirname(registered)).catch(() => '')) !== root) throw new GitError('the .git file of the worktree points to a directory registered for another worktree');
    return ['-C', root, `--git-dir=${gitDir}`, `--work-tree=${root}`, `--attr-source=${EMPTY_TREE}`, ...GUARD_CONFIG.flatMap((setting) => ['-c', setting])];
  }

  async topLevel(path: string): Promise<string> {
    return (await this.run(path, ['rev-parse', '--show-toplevel'])).trim();
  }

  /** Resolves a revision to a commit id. A revision that starts with `-` is refused. */
  async resolveCommit(repo: string, revision: string): Promise<string> {
    if (revision.startsWith('-')) throw new GitError('a revision that starts with - is refused');
    try {
      return (await this.run(repo, ['rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`])).trim();
    } catch (error) {
      throw new GitError(`${revision} is not a commit of the repository: ${(error as Error).message}`);
    }
  }

  async trackedFiles(repo: string, commit: string): Promise<string[]> {
    return (await this.run(repo, ['ls-tree', '-r', '--name-only', '-z', commit])).split('\0').filter((line) => line !== '');
  }

  async branchExists(repo: string, branch: string): Promise<boolean> {
    try {
      await this.run(repo, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]);
      return true;
    } catch {
      return false;
    }
  }

  async checkBranchName(repo: string, name: string): Promise<void> {
    try {
      await this.run(repo, ['check-ref-format', '--branch', name]);
    } catch {
      throw new GitError(`${name} is not a valid branch name`);
    }
  }

  /** `branch` undefined makes a detached worktree. */
  async addWorktree(repo: string, path: string, commit: string, branch?: string): Promise<void> {
    const args = branch === undefined ? ['worktree', 'add', '--detach', '--', path, commit] : ['worktree', 'add', '-b', branch, '--', path, commit];
    // An earlier agent of the swarm can have named a driver in info/attributes of the common directory.
    await this.run(repo, [`--attr-source=${EMPTY_TREE}`, ...GUARD_CONFIG.flatMap((setting) => ['-c', setting]), ...args], { blank: true });
    await this.record(path);
  }

  private async record(path: string): Promise<void> {
    const root = await realpath(path);
    const pointer = /^gitdir: (.+)$/m.exec(await readFile(join(root, '.git'), 'utf8'));
    if (pointer !== null) this.registered.set(root, resolve(root, pointer[1]!.trim()));
  }

  async removeWorktree(repo: string, path: string, force: boolean): Promise<void> {
    await this.run(repo, ['worktree', 'remove', ...(force ? ['--force'] : []), '--', path]);
  }

  async deleteBranch(repo: string, branch: string, force: boolean): Promise<void> {
    await this.run(repo, ['branch', force ? '-D' : '-d', '--', branch]);
  }

  async isAncestor(repo: string, branch: string, commit: string): Promise<boolean> {
    try {
      await this.run(repo, ['merge-base', '--is-ancestor', `refs/heads/${branch}`, commit]);
      return true;
    } catch {
      return false;
    }
  }

  async hasChanges(worktree: string): Promise<boolean> {
    return (await this.run(worktree, ['status', '--porcelain', '--untracked-files=all'], { guard: true })).trim() !== '';
  }

  /** New files show in the diff after `add -N`; the diff is against `base`, so the agent's own commits are included. */
  async collect(worktree: string, base: string): Promise<Collected> {
    await this.run(worktree, ['add', '-N', '.'], { guard: true });
    const patch = await this.run(worktree, ['diff', '--binary', ...DIFF_FLAGS, base, '--'], { guard: true, raw: true });
    const numstat = parseNumstat(await this.run(worktree, ['diff', '--numstat', '-z', ...DIFF_FLAGS, base, '--'], { guard: true }));
    const log = await this.run(worktree, ['log', '--format=%H%x00%s', '--no-color', `${base}..HEAD`, '--'], { guard: true });
    const commits = log
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => {
        const [sha = '', subject = ''] = line.split('\0');
        return { sha, subject };
      });
    return { patch, numstat, commits };
  }

  /** Applies a patch with a three-way merge; false when it does not apply, leaving the worktree as it was. */
  async applyPatch(worktree: string, patchFile: string): Promise<boolean> {
    try {
      await this.run(worktree, ['apply', '--3way', '--index', '--', patchFile], { guard: true });
      return true;
    } catch {
      await this.run(worktree, ['reset', '--hard', 'HEAD'], { guard: true });
      return false;
    }
  }

  /** The paths a patch touches. */
  async patchPaths(worktree: string, patchFile: string): Promise<string[]> {
    return parseNumstat(await this.run(worktree, ['apply', '--numstat', '-z', '--', patchFile], { guard: true })).map((row) => row.path);
  }

  async commitAll(worktree: string, message: string): Promise<string> {
    await this.run(worktree, ['add', '-A'], { identity: true, guard: true });
    await this.run(worktree, ['commit', '--allow-empty', '--no-verify', '-m', message], { identity: true, guard: true });
    return (await this.run(worktree, ['rev-parse', 'HEAD'], { guard: true })).trim();
  }

  /** Checks that a stored patch applies to `base`, in a temporary index, so a worktree is removed only when its patch can restore it. */
  async verifyPatch(repo: string, base: string, patchFile: string): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), 'agide-index-'));
    const env = { ...this.env(), GIT_INDEX_FILE: join(dir, 'index') };
    try {
      await this.exec('git', ['-C', repo, 'read-tree', base], { env, timeoutMs: this.timeoutMs });
      await this.exec('git', ['-C', repo, 'apply', '--cached', '--check', '--', patchFile], { env, timeoutMs: this.timeoutMs });
    } catch (error) {
      throw new GitError(`the stored patch does not apply to ${base}: ${error instanceof ExecError ? error.firstLine : String(error)}`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

/** Parses `git diff --numstat -z --no-renames`: `added TAB removed TAB path NUL`. Binary files report `-`. */
export function parseNumstat(output: string): NumstatRow[] {
  return output
    .split('\0')
    .filter((entry) => entry !== '')
    .flatMap((entry) => {
      const match = /^(\d+|-)\t(\d+|-)\t(.*)$/s.exec(entry.replace(/^\n/, ''));
      if (match === null) return [];
      return [{ path: match[3]!, added: match[1] === '-' ? 0 : Number(match[1]), removed: match[2] === '-' ? 0 : Number(match[2]) }];
    });
}
