import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { defaultSessionCwd } from '../session/env';
import { ExecError, execFileNoShell, type Exec } from './exec';
import { remoteFor } from './remotes';
import { TaskStartError, type WorkingDirectoryManager, type WorktreeInfo, type WorktreeSpec } from './types';

export const GIT_TIMEOUT_MS = 60_000;

/** `~/Agide`, or `AGIDE_TASK_BASE` for tests. Worktrees and source files live below it. */
export function taskBaseDir(env: NodeJS.ProcessEnv = process.env): string {
  return env['AGIDE_TASK_BASE'] || join(env['HOME'] || homedir(), 'Agide');
}

export interface GitManagerOptions {
  /** The directory that holds `worktrees/`. */
  readonly baseDir: string;
  /** The application's data root: no working directory is created inside it. */
  readonly appRoot: string;
  /** The profile's launch environment (its git configuration included). */
  readonly env: () => NodeJS.ProcessEnv;
  /** Repositories the user used before; `findRepository` looks for a remote match among them. */
  readonly knownRepositories: () => readonly string[];
  readonly exec?: Exec;
}

const isWithin = (root: string, path: string): boolean => {
  const from = relative(resolve(root), resolve(path));
  return from === '' || (!from.startsWith('..') && !isAbsolute(from));
};

/**
 * Working directories of tasks (0028 section 10). Every git step runs through `execFile`, in the profile's
 * environment, with a timeout. Values that came from the user or an agent never reach git as options: the base
 * is resolved once to a commit id with `--end-of-options`, branch names are checked, paths follow `--`.
 */
export class GitWorkingDirectoryManager implements WorkingDirectoryManager {
  private readonly created = new Set<string>();

  constructor(private readonly options: GitManagerOptions) {}

  private git(repoPath: string, args: readonly string[]): Promise<{ stdout: string }> {
    return (this.options.exec ?? execFileNoShell)('git', ['-C', repoPath, ...args], { env: this.options.env(), timeoutMs: GIT_TIMEOUT_MS });
  }

  defaultDir(folderId: string): string {
    const dir = defaultSessionCwd(folderId);
    this.guardRoot(dir);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.created.add(resolve(dir));
    return dir;
  }

  createdByApp(dir: string): boolean {
    return this.created.has(resolve(dir));
  }

  async findRepository(owner: string, repo: string): Promise<{ repoPath: string; remote: string } | undefined> {
    for (const repoPath of this.options.knownRepositories()) {
      const remote = await this.remoteOf(repoPath, owner, repo);
      if (remote !== undefined) return { repoPath, remote };
    }
    return undefined;
  }

  /** The remote of the repository that points at `owner/repo`, if it has one. */
  async remoteOf(repoPath: string, owner: string, repo: string): Promise<string | undefined> {
    try {
      return remoteFor((await this.git(repoPath, ['config', '--get-regexp', '^remote\\..*\\.url$'])).stdout, owner, repo);
    } catch {
      return undefined;
    }
  }

  /** The top level of the repository `path` belongs to. */
  async repositoryRoot(path: string): Promise<string> {
    try {
      return (await this.git(path, ['rev-parse', '--show-toplevel'])).stdout.trim();
    } catch (error) {
      throw new TaskStartError('no_repository', `${path} is not a git repository (${gitMessage(error)})`);
    }
  }

  /** The text of a file at a revision (branch, remote branch or commit), or `undefined` when there is none. */
  async readFileAtRevision(repoPath: string, revision: string, file: string): Promise<string | undefined> {
    try {
      const commit = await this.resolve(repoPath, revision);
      return (await this.git(repoPath, ['show', `${commit}:${file}`])).stdout;
    } catch {
      return undefined;
    }
  }

  async createWorktree(spec: WorktreeSpec): Promise<WorktreeInfo> {
    const { repoPath, remote, folderId } = spec;
    const warnings: string[] = [];
    const path = join(this.options.baseDir, 'worktrees', `${basename(repoPath)}-${folderId}`);
    this.guardRoot(path);

    let commit: string;
    if (spec.pullRequest !== undefined) {
      await this.step(repoPath, ['fetch', remote, `pull/${spec.pullRequest}/head`], 'fetching the pull request');
      commit = await this.resolve(repoPath, 'FETCH_HEAD');
    } else {
      try {
        await this.git(repoPath, ['fetch', remote]);
      } catch (error) {
        warnings.push(`git fetch ${remote} failed (${gitMessage(error)}); the worktree starts from the local base`);
      }
      commit = await this.resolveBase(repoPath, spec.base, remote);
    }

    const branch = await this.freeBranch(repoPath, spec.branch, folderId);
    mkdirSync(join(this.options.baseDir, 'worktrees'), { recursive: true, mode: 0o700 });
    await this.step(repoPath, ['worktree', 'add', '-b', branch, '--', path, commit], 'creating the worktree');
    this.created.add(resolve(path));
    return { path, branch, base: commit, ...(warnings.length > 0 ? { warnings } : {}) };
  }

  async removeWorktree(info: WorktreeInfo & { readonly repoPath: string }, options: { force: boolean; deleteBranch: boolean }): Promise<void> {
    await this.step(info.repoPath, ['worktree', 'remove', ...(options.force ? ['--force'] : []), '--', info.path], 'removing the worktree');
    this.created.delete(resolve(info.path));
    if (options.deleteBranch) await this.step(info.repoPath, ['branch', options.force ? '-D' : '-d', '--', info.branch], 'deleting the branch');
  }

  private guardRoot(path: string): void {
    if (isWithin(this.options.appRoot, path)) throw new TaskStartError('not_allowed', 'a working directory cannot be inside the data directory of the app');
  }

  private async step(repoPath: string, args: readonly string[], what: string): Promise<void> {
    try {
      await this.git(repoPath, args);
    } catch (error) {
      throw new TaskStartError('git_failed', `${what} failed: ${gitMessage(error)}`);
    }
  }

  private async resolve(repoPath: string, rev: string): Promise<string> {
    try {
      return (await this.git(repoPath, ['rev-parse', '--verify', '--end-of-options', `${rev}^{commit}`])).stdout.trim();
    } catch (error) {
      throw new TaskStartError('git_failed', `${rev} is not a commit of the repository: ${gitMessage(error)}`);
    }
  }

  private async resolveBase(repoPath: string, base: string | undefined, remote: string): Promise<string> {
    if (base !== undefined) {
      if (base.startsWith('-')) throw new TaskStartError('invalid_source', 'a base that starts with - is refused');
      return this.resolve(repoPath, base);
    }
    try {
      return await this.resolve(repoPath, `${remote}/HEAD`);
    } catch {
      return this.resolve(repoPath, 'HEAD');
    }
  }

  /** The wanted branch name, or a name with the folder id when the branch exists. A checked name is never overwritten. */
  private async freeBranch(repoPath: string, wanted: string, folderId: string): Promise<string> {
    const named = async (name: string): Promise<string> => {
      try {
        await this.git(repoPath, ['check-ref-format', '--branch', name]);
      } catch {
        throw new TaskStartError('git_failed', `${name} is not a valid branch name`);
      }
      return name;
    };
    const first = await named(wanted);
    try {
      await this.git(repoPath, ['show-ref', '--verify', '--quiet', `refs/heads/${first}`]);
    } catch {
      return first;
    }
    return named(`${first}-${folderId.slice(0, 6)}`);
  }
}

function gitMessage(error: unknown): string {
  return error instanceof ExecError ? error.firstLine : error instanceof Error ? error.message : String(error);
}
