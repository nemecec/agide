import { execFile } from 'node:child_process';
import { lstat, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { cleanLine } from '../../inbox/text';
import { blankingEnv, COMMIT_IDENTITY, DRIVER_LISTING, driverSettings, EMPTY_TREE, GUARD_CONFIG } from '../../swarm/workspace/git';
import type { MergeOutcome, Merger } from '../types';

const TIMEOUT_MS = 60_000;
const ZERO_TIP = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

interface GitResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs git without a shell and keeps the exit code, since `merge-tree` answers a conflict with exit 1. */
function runGit(args: readonly string[], env: NodeJS.ProcessEnv): Promise<GitResult> {
  return new Promise((resolveResult) => {
    execFile('git', [...args], { env, timeout: TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' }, (error, stdout, stderr) => {
      const code = error === null ? 0 : typeof (error as { code?: unknown }).code === 'number' ? ((error as { code: number }).code) : 128;
      resolveResult({ code, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

const firstLine = (text: string): string => text.split('\n').find((line) => line.trim() !== '')?.trim() ?? 'git failed';

/**
 * The git steps of 0040 section 15.3. Nothing runs in a worktree an agent can write: the steps read and write
 * objects through the common directory (`--git-dir`, no work tree), attributes come from the empty tree, hooks are off,
 * and every filter and merge driver the effective configuration names is blanked. The target moves by a
 * compare-and-swap of its ref, or by a fast-forward in the main checkout when it has the target checked out and is clean.
 */
export class GitMerger implements Merger {
  /** `beforeMove` runs after the merge commits exist and before the target moves; tests use it to move the target first. */
  constructor(
    private readonly env: () => NodeJS.ProcessEnv = () => process.env,
    private readonly beforeMove: () => Promise<void> | void = () => undefined,
  ) {}

  async merge(input: Parameters<Merger['merge']>[0]): Promise<MergeOutcome> {
    const { commonDir, target, goal, steps, dryRun } = input;
    const env = await this.guardedEnv(commonDir);
    const git = (args: readonly string[], extra: NodeJS.ProcessEnv = {}) => runGit([`--git-dir=${commonDir}`, `--attr-source=${EMPTY_TREE}`, ...GUARD_CONFIG.flatMap((setting) => ['-c', setting]), ...args], { ...env, ...extra });

    const ref = `refs/heads/${target}`;
    const valid = (await runGit([`--git-dir=${commonDir}`, 'check-ref-format', ref], env)).code === 0;
    if (target.startsWith('-') || !valid) return { ok: false, from: '', why: `${target} is not a valid branch name` };
    const tip = await git(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]);
    const from = tip.stdout.trim();
    if (tip.code !== 0 || !ZERO_TIP.test(from)) return { ok: false, from: '', why: `${target} is not a local branch of the repository` };

    let current = from;
    const commits: { changesetId: string; commit: string }[] = [];
    for (const step of steps) {
      const exists = await git(['cat-file', '-e', `${step.checkpointCommit}^{commit}`]);
      if (exists.code !== 0) return { ok: false, from, why: `the checkpoint of ${step.agent} is missing from the repository` };
      const merged = await git(['merge-tree', '--write-tree', '--name-only', `--merge-base=${step.baseCommit}`, current, step.checkpointCommit]);
      if (merged.code === 1) {
        const [, ...rest] = merged.stdout.split('\n');
        const files = rest.slice(0, rest.indexOf('') < 0 ? rest.length : rest.indexOf('')).filter((line) => line !== '');
        return { ok: false, from, conflicts: [{ agents: [step.agent], files }], why: `${step.agent} conflicts with ${target}` };
      }
      if (merged.code !== 0) return { ok: false, from, why: cleanLine(firstLine(merged.stderr)) };
      const tree = merged.stdout.split('\n')[0]!.trim();
      const message = `Agide: ${step.agent} (${cleanLine(goal.split('\n')[0] ?? '').slice(0, 100)})`;
      const commit = await git(['commit-tree', tree, '-p', current, '-m', message], COMMIT_IDENTITY);
      if (commit.code !== 0) return { ok: false, from, why: cleanLine(firstLine(commit.stderr)) };
      current = commit.stdout.trim();
      commits.push({ changesetId: step.changesetId, commit: current });
    }
    if (dryRun) return { ok: true, from, to: current, commits };

    await this.beforeMove();
    const checkout = await this.checkoutOf(commonDir, ref, env);
    if (checkout.kind === 'untrusted') return { ok: false, from, why: `${target} is checked out in ${checkout.path}, which is not the main checkout of the repository; merge there by hand` };
    if (checkout.kind === 'none') {
      const moved = await git(['update-ref', ref, current, from]);
      return moved.code === 0 ? { ok: true, from, to: current, commits } : { ok: false, from, why: `${target} moved meanwhile; merge again` };
    }
    const where = [`--git-dir=${checkout.gitDir}`, `--work-tree=${checkout.path}`, `--attr-source=${EMPTY_TREE}`, ...GUARD_CONFIG.flatMap((setting) => ['-c', setting])];
    const status = await runGit([...where, 'status', '--porcelain', '--untracked-files=no'], env);
    if (status.code !== 0 || status.stdout.trim() !== '') return { ok: false, from, why: `commit or stash your changes in ${checkout.path} first` };
    const forwarded = await runGit([...where, 'merge', '--ff-only', current], env);
    return forwarded.code === 0 ? { ok: true, from, to: current, commits } : { ok: false, from, why: `${target} moved meanwhile: ${cleanLine(firstLine(forwarded.stderr))}` };
  }

  /** The base environment with an empty value for every filter and merge driver the effective configuration names. */
  private async guardedEnv(commonDir: string): Promise<NodeJS.ProcessEnv> {
    const base = this.env();
    const listed = await runGit([`--git-dir=${commonDir}`, ...DRIVER_LISTING], base);
    return { ...base, ...blankingEnv(driverSettings(listed.stdout)) };
  }

  /**
   * The checkout that has `ref` checked out, with its git directory: only the main checkout, whose `.git` directory is
   * the common directory, is trusted.
   */
  private async checkoutOf(commonDir: string, ref: string, env: NodeJS.ProcessEnv): Promise<{ readonly kind: 'none' } | { readonly kind: 'untrusted'; readonly path: string } | { readonly kind: 'trusted'; readonly path: string; readonly gitDir: string }> {
    const listed = await runGit([`--git-dir=${commonDir}`, 'worktree', 'list', '--porcelain'], env);
    for (const block of listed.stdout.split('\n\n')) {
      const lines = block.split('\n');
      const path = lines.find((line) => line.startsWith('worktree '))?.slice('worktree '.length);
      if (path === undefined || !lines.includes(`branch ${ref}`)) continue;
      const entry = join(path, '.git');
      const real = await realpath(commonDir);
      // Only the main checkout is merged into: a linked worktree has its own config.worktree, which an agent with a
      // worktree of the same repository can write, so its configuration is not the one blanked above.
      const main = (await lstat(entry).catch(() => undefined))?.isDirectory() === true && (await realpath(entry)) === real;
      return main ? { kind: 'trusted', path, gitDir: real } : { kind: 'untrusted', path };
    }
    return { kind: 'none' };
  }
}
