import { lstat, readFile, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { hostTools } from '../../isolation/hostTools';
import { blankingEnv, driverSettings as sharedDriverSettings } from '../../swarm/workspace/git';

/**
 * Git calls of the review capture. Nothing from the repository's configuration or from files an agent can write
 * runs a program: hooks, fsmonitor, the pager, external diff, textconv, clean, smudge and process filters and merge
 * drivers are switched off, and attributes come from the empty tree (0040 sections 4.2 and 17, probe P42).
 */

export const GIT_TIMEOUT_MS = 60_000;
export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
export const ZERO_OID = '0000000000000000000000000000000000000000';
/** The largest stdout a call may produce; a larger diff fails the capture. */
export const GIT_MAX_OUTPUT_BYTES = 256 * 1024 * 1024;

export class ReviewGitError extends Error {
  constructor(
    message: string,
    readonly stderr = '',
    readonly exitCode?: number,
  ) {
    super(message);
    this.name = 'ReviewGitError';
  }
}

const GUARD_CONFIG = [
  'core.fsmonitor=false',
  'core.hooksPath=/dev/null',
  'core.untrackedCache=false',
  'core.attributesFile=/dev/null',
  'core.pager=cat',
  'core.quotepath=true',
  'core.autocrlf=false',
  'core.safecrlf=false',
  'core.filemode=true',
  'core.symlinks=true',
  'commit.gpgsign=false',
  'tag.gpgsign=false',
  'color.ui=never',
  'diff.noprefix=false',
  'diff.mnemonicPrefix=false',
  'diff.renames=false',
] as const;

/** The flags every diff of the review carries: no external diff, no textconv, the same prefixes whatever the user configured. */
export const DIFF_FLAGS = ['--no-ext-diff', '--no-textconv', '--no-color', '--src-prefix=a/', '--dst-prefix=b/'] as const;

const COMMIT_IDENTITY = { GIT_AUTHOR_NAME: 'Agide', GIT_AUTHOR_EMAIL: 'agide.invalid', GIT_COMMITTER_NAME: 'Agide', GIT_COMMITTER_EMAIL: 'agide.invalid' };

export interface GitCallResult {
  readonly stdout: Buffer;
}

/** Runs `git` without a shell. A test double can record calls or replace the program. */
export type GitExec = (args: readonly string[], options: { readonly env: NodeJS.ProcessEnv; readonly timeoutMs: number; readonly cwd?: string }) => Promise<GitCallResult>;

export const execGit: GitExec = (args, { env, timeoutMs, cwd }) =>
  new Promise((resolvePromise, reject) => {
    hostTools().execFileBuffer('git', args, { env, timeout: timeoutMs, maxBuffer: GIT_MAX_OUTPUT_BYTES, ...(cwd === undefined ? {} : { cwd }) }, (error, stdout, stderr) => {
      if (error === null) resolvePromise({ stdout });
      else reject(new ReviewGitError(firstLine(stderr.toString('utf8')) || error.message, stderr.toString('utf8'), typeof error.code === 'number' ? error.code : undefined));
    });
  });

const firstLine = (text: string): string => text.split('\n').find((line) => line.trim() !== '')?.trim() ?? '';

export interface GitCallOptions {
  readonly env?: Readonly<Record<string, string>>;
  readonly identity?: boolean;
}

/** One git directory, optionally with a work tree, and the driver names blanked for it. */
export class GuardedGit {
  private constructor(
    private readonly exec: GitExec,
    private readonly timeoutMs: number,
    readonly gitDir: string,
    readonly workTree: string | undefined,
    private readonly blanked: readonly string[],
  ) {}

  /**
   * Lists every `filter.<name>` and `merge.<name>` of the effective configuration, so each can be blanked for the
   * calls that follow: `info/attributes` of the common directory can name a driver that `--attr-source` does not switch off.
   */
  static async open(gitDir: string, options: { readonly workTree?: string; readonly exec?: GitExec; readonly timeoutMs?: number } = {}): Promise<GuardedGit> {
    const exec = options.exec ?? execGit;
    const timeoutMs = options.timeoutMs ?? GIT_TIMEOUT_MS;
    const bare = new GuardedGit(exec, timeoutMs, gitDir, options.workTree, []);
    // `config --get-regexp` exits 1 when nothing matches.
    const listing = await bare.runRaw(['config', '--includes', '--null', '--get-regexp', '^(filter|merge)\\.'], {}).catch((error: unknown) => {
      if (error instanceof ReviewGitError && error.exitCode === 1) return Buffer.alloc(0);
      throw error;
    });
    return new GuardedGit(exec, timeoutMs, gitDir, options.workTree, driverSettings(listing));
  }

  /** The common git directory of a repository or one of its worktrees, as an absolute real path. */
  static async commonDirOf(repoPath: string, exec: GitExec = execGit): Promise<string> {
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')));
    const { stdout } = await exec(['-C', repoPath, '-c', 'core.fsmonitor=false', 'rev-parse', '--path-format=absolute', '--git-common-dir'], { env: { ...env, GIT_TERMINAL_PROMPT: '0' }, timeoutMs: GIT_TIMEOUT_MS });
    return realpath(stdout.toString('utf8').trim());
  }

  private baseArgs(): string[] {
    return [`--git-dir=${this.gitDir}`, ...(this.workTree === undefined ? [] : [`--work-tree=${this.workTree}`]), `--attr-source=${EMPTY_TREE}`, ...GUARD_CONFIG.flatMap((setting) => ['-c', setting])];
  }

  private environment(options: GitCallOptions): NodeJS.ProcessEnv {
    const inherited = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')));
    const config = blankingEnv(this.blanked);
    return { ...inherited, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', ...config, ...(options.identity === true ? COMMIT_IDENTITY : {}), ...options.env };
  }

  private async runRaw(args: readonly string[], options: GitCallOptions): Promise<Buffer> {
    return (await this.exec([...this.baseArgs(), ...args], { env: this.environment(options), timeoutMs: this.timeoutMs })).stdout;
  }

  /** stdout as bytes. */
  bytes(args: readonly string[], options: GitCallOptions = {}): Promise<Buffer> {
    return this.runRaw(args, options);
  }

  /** stdout as UTF-8 text. */
  async text(args: readonly string[], options: GitCallOptions = {}): Promise<string> {
    return (await this.runRaw(args, options)).toString('utf8');
  }

  /** stdout with one character per byte, for diff text that is decoded line by line later. */
  async latin1(args: readonly string[], options: GitCallOptions = {}): Promise<string> {
    return (await this.runRaw(args, options)).toString('latin1');
  }

  /** The same guard on the same git directory with another work tree. */
  withWorkTree(workTree: string | undefined): GuardedGit {
    return new GuardedGit(this.exec, this.timeoutMs, this.gitDir, workTree, this.blanked);
  }
}

/** The settings that blank the drivers named in `git config --null --get-regexp` output (shared with the swarm's `Git`). */
export function driverSettings(listing: Buffer): string[] {
  return sharedDriverSettings(listing.toString('utf8'));
}

/**
 * The git directory of an agent's worktree, checked against the common directory: the `.git` entry of the worktree
 * is writable by the agent, so it must be a file that names `<common>/worktrees/<name>`, whose `gitdir` file names
 * this worktree back.
 */
export async function worktreeGitDir(worktreePath: string, commonDir: string): Promise<string> {
  const root = await realpath(worktreePath);
  const common = await realpath(commonDir);
  const entry = join(root, '.git');
  if (!(await lstat(entry)).isFile()) throw new ReviewGitError('the .git entry of the worktree is not a file');
  const pointer = /^gitdir: (.+)$/m.exec(await readFile(entry, 'utf8'));
  if (pointer === null) throw new ReviewGitError('the .git file of the worktree does not name a git directory');
  const gitDir = await realpath(resolve(root, pointer[1]!.trim())).catch(() => '');
  if (gitDir === '') throw new ReviewGitError('the git directory named by the worktree does not exist');
  const inside = relative(root, gitDir);
  if (inside === '' || (!inside.startsWith('..') && !isAbsolute(inside))) throw new ReviewGitError('the .git file of the worktree points to a directory inside the worktree');
  if (dirname(gitDir) !== join(common, 'worktrees') || basename(dirname(gitDir)) !== 'worktrees') throw new ReviewGitError('the .git file of the worktree does not point into the worktrees directory of the repository');
  const registered = (await readFile(join(gitDir, 'gitdir'), 'utf8').catch(() => '')).trim();
  if (registered === '' || (await realpath(dirname(registered)).catch(() => '')) !== root) throw new ReviewGitError('the .git file of the worktree points to a directory registered for another worktree');
  return gitDir;
}
