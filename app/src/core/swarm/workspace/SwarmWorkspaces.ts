import { existsSync } from 'node:fs';
import { chmod, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import type { Workspace } from '../definition';
import { Git, type Collected, type NumstatRow } from './git';

export const PATCH_PREVIEW_MAX_BYTES = 100_000;

export interface WorkspaceOptions {
  readonly git: Git;
  /** The profile's `swarms` directory: the stored patches. */
  readonly dataRoot: string;
  /**
   * Where the directories an agent reads or writes go: inputs and scratch directories. Outside the app root, since
   * every launch denies the CLI's Read and Edit tools there. Defaults to `dataRoot`.
   */
  readonly agentRoot?: string;
  /** The directory that holds the agents' git worktrees (`~/Agide/worktrees`). */
  readonly worktreeBase: string;
  /** The application data root: no working directory is created inside it. */
  readonly appRoot: string;
}

/** What `prepare` needs to know about one agent. */
export interface WorkspaceRequest {
  readonly swarmId: string;
  readonly name: string;
  readonly workspace: Workspace;
  readonly repoPath?: string | undefined;
  readonly baseCommit?: string | undefined;
}

export interface PreviewConflict {
  readonly agent: string;
  readonly files: readonly string[];
}

export interface PreparedWorkspace {
  readonly kind: Workspace;
  readonly cwd: string;
  readonly branch?: string;
  /** The commit the collection diffs against: the base, or the merge preview's commit. */
  readonly base?: string;
  readonly inputsDir: string;
  readonly conflicts: readonly PreviewConflict[];
}

/** A finished agent's patch, input to a merge preview. */
export interface PreviewInput {
  readonly agent: string;
  readonly patchFile: string;
}

export interface StoredCollection extends Collected {
  readonly patchFile: string;
}

export interface WorktreeRemoval {
  readonly agent: string;
  readonly path: string;
  readonly branch: string | undefined;
  readonly removed: boolean;
  readonly forced: boolean;
  readonly patchFile?: string;
  readonly branchDeleted: boolean;
  readonly note?: string;
}

const isWithin = (root: string, path: string): boolean => {
  const from = relative(resolve(root), resolve(path));
  return from === '' || (!from.startsWith('..') && !isAbsolute(from));
};

/**
 * Workspaces of swarm agents (0037 section 4): a git worktree per editing agent, a detached worktree for a
 * readonly agent, a scratch directory, the inputs directory, result collection with stored patches, merge
 * previews and the removal rules. The app creates worktrees itself, so they are outside any sandbox.
 */
export class SwarmWorkspaces {
  constructor(private readonly options: WorkspaceOptions) {}

  get git(): Git {
    return this.options.git;
  }

  swarmDir(swarmId: string): string {
    return join(this.options.dataRoot, swarmId);
  }

  /** The swarm's directory for inputs and scratch directories. */
  agentDir(swarmId: string): string {
    return join(this.options.agentRoot ?? this.options.dataRoot, swarmId);
  }

  patchPath(swarmId: string, name: string, suffix = ''): string {
    return join(this.swarmDir(swarmId), `${name}${suffix}.patch`);
  }

  /** The repository a path belongs to and the commit `base` (default `HEAD`) names in it. */
  async resolveRepository(path: string, base: string | undefined): Promise<{ readonly root: string; readonly commit: string }> {
    const root = await this.options.git.topLevel(path);
    return { root, commit: await this.options.git.resolveCommit(root, base ?? 'HEAD') };
  }

  async prepare(request: WorkspaceRequest, previews: readonly PreviewInput[] = []): Promise<PreparedWorkspace> {
    const dir = this.agentDir(request.swarmId);
    if (isWithin(this.options.appRoot, dir)) throw new Error('a working directory cannot be inside the data directory of the app');
    await this.ensurePrivate(dir);
    const inputsDir = join(dir, 'inputs', request.name);
    await mkdir(inputsDir, { recursive: true, mode: 0o700 });
    if (request.workspace === 'scratch') {
      const cwd = join(dir, 'scratch', request.name);
      await mkdir(cwd, { recursive: true, mode: 0o700 });
      return { kind: 'scratch', cwd, inputsDir, conflicts: [] };
    }
    const { repoPath, baseCommit } = request;
    if (repoPath === undefined || baseCommit === undefined) throw new Error(`${request.name} needs a repository for a ${request.workspace} workspace`);
    const short = request.swarmId.slice(0, 8);
    const path = await this.freePath(join(this.options.worktreeBase, `${basename(repoPath)}-${short}-${request.name}`), short);
    if (isWithin(this.options.appRoot, path)) throw new Error('a working directory cannot be inside the data directory of the app');
    await mkdir(this.options.worktreeBase, { recursive: true, mode: 0o700 });
    if (request.workspace === 'worktree') {
      const branch = await this.freeBranch(repoPath, `agide/swarm-${short}/${request.name}`, short);
      await this.options.git.addWorktree(repoPath, path, baseCommit, branch);
      return { kind: 'worktree', cwd: path, branch, base: baseCommit, inputsDir, conflicts: [] };
    }
    await this.options.git.addWorktree(repoPath, path, baseCommit);
    if (previews.length === 0) return { kind: 'readonly', cwd: path, base: baseCommit, inputsDir, conflicts: [] };
    return this.applyPreview(path, baseCommit, inputsDir, previews);
  }

  /** Applies the earlier agents' patches in order; a patch that does not apply is named and handed over as a file. */
  private async applyPreview(path: string, baseCommit: string, inputsDir: string, previews: readonly PreviewInput[]): Promise<PreparedWorkspace> {
    const conflicts: PreviewConflict[] = [];
    for (const preview of previews) {
      if (await this.options.git.applyPatch(path, preview.patchFile)) {
        await this.options.git.commitAll(path, `Agide merge preview: ${preview.agent}`);
        continue;
      }
      conflicts.push({ agent: preview.agent, files: await this.options.git.patchPaths(path, preview.patchFile).catch(() => []) });
      await copyFile(preview.patchFile, join(inputsDir, `${preview.agent}.patch`));
    }
    const base = await this.options.git.commitAll(path, 'Agide merge preview');
    return { kind: 'readonly', cwd: path, base: base || baseCommit, inputsDir, conflicts };
  }

  /** Diffs the worktree against `base` and stores the patch (directory 0700, file 0600). */
  async collect(swarmId: string, name: string, cwd: string, base: string, suffix = ''): Promise<StoredCollection> {
    const collected = await this.options.git.collect(cwd, base);
    const patchFile = this.patchPath(swarmId, name, suffix);
    await this.ensurePrivate(this.swarmDir(swarmId));
    await writeFile(patchFile, Buffer.from(collected.patch, 'latin1'), { mode: 0o600 });
    await chmod(patchFile, 0o600);
    return { ...collected, patchFile };
  }

  async readPatch(patchFile: string): Promise<{ readonly text: string; readonly truncated: boolean }> {
    const text = await readFile(patchFile, 'utf8');
    return text.length > PATCH_PREVIEW_MAX_BYTES ? { text: text.slice(0, PATCH_PREVIEW_MAX_BYTES), truncated: true } : { text, truncated: false };
  }

  /** The tracked files of the base commit, for the `owns` overlap check. */
  trackedFiles(repo: string, commit: string): Promise<string[]> {
    return this.options.git.trackedFiles(repo, commit);
  }

  /** A readonly worktree or merge preview that ended with the swarm: removed after its patch is stored. */
  async removeReadonly(repo: string, cwd: string): Promise<void> {
    if (!existsSync(cwd)) return;
    await this.options.git.removeWorktree(repo, cwd, true);
  }

  /**
   * Removes one editing worktree. A clean worktree goes without `--force`. One with changes goes with `--force`
   * only after its patch is stored; when the patch cannot be stored the worktree stays. A branch goes only when
   * it is merged into the base commit or the caller asked for it.
   */
  async removeWorktree(input: {
    swarmId: string;
    agent: string;
    repo: string;
    cwd: string;
    branch: string | undefined;
    base: string;
    deleteBranch: boolean;
  }): Promise<WorktreeRemoval> {
    const { git } = this.options;
    const { agent, cwd, branch, repo } = input;
    const result = (fields: Partial<WorktreeRemoval>): WorktreeRemoval => ({ agent, path: cwd, branch, removed: false, forced: false, branchDeleted: false, ...fields });
    if (!existsSync(cwd)) return result({ removed: true, note: 'the worktree was already gone' });
    let forced = false;
    let patchFile: string | undefined;
    try {
      if (await git.hasChanges(cwd)) {
        patchFile = (await this.collect(input.swarmId, agent, cwd, input.base, '-removal')).patchFile;
        await git.verifyPatch(repo, input.base, patchFile);
        forced = true;
      }
      await git.removeWorktree(repo, cwd, forced);
    } catch (error) {
      return result({ note: `kept: ${(error as Error).message}`, ...(patchFile === undefined ? {} : { patchFile }) });
    }
    let branchDeleted = false;
    if (branch !== undefined) {
      const merged = await git.isAncestor(repo, branch, input.base);
      if (merged || input.deleteBranch) {
        try {
          await git.deleteBranch(repo, branch, !merged);
          branchDeleted = true;
        } catch (error) {
          return result({ removed: true, forced, branchDeleted, note: `branch kept: ${(error as Error).message}`, ...(patchFile === undefined ? {} : { patchFile }) });
        }
      }
    }
    return result({ removed: true, forced, branchDeleted, ...(patchFile === undefined ? {} : { patchFile }) });
  }

  /** Removes a swarm's scratch directories and inputs. Patches stay until the retention setting prunes them. */
  async removeScratchAndInputs(swarmId: string): Promise<void> {
    await rm(join(this.agentDir(swarmId), 'scratch'), { recursive: true, force: true });
    await rm(join(this.agentDir(swarmId), 'inputs'), { recursive: true, force: true });
  }

  private async ensurePrivate(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await chmod(dir, 0o700);
  }

  /** The wanted path, or the same with a suffix when it exists. A path is never reused. */
  private async freePath(wanted: string, suffix: string): Promise<string> {
    let candidate = wanted;
    for (let attempt = 1; existsSync(candidate); attempt += 1) candidate = `${wanted}-${suffix}${attempt > 1 ? `-${attempt}` : ''}`;
    return candidate;
  }

  /** The wanted branch name, or the name with a suffix when the branch exists. A checked name is never overwritten. */
  private async freeBranch(repo: string, wanted: string, suffix: string): Promise<string> {
    await this.options.git.checkBranchName(repo, wanted);
    if (!(await this.options.git.branchExists(repo, wanted))) return wanted;
    const next = `${wanted}-${suffix}`;
    await this.options.git.checkBranchName(repo, next);
    return next;
  }
}

export type { NumstatRow };
