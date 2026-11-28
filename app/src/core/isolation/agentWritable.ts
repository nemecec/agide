import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { contains, isWithinAny, realForms } from './hostLaunch';

/**
 * The directories a sandboxed agent of a profile may write. One source for two readers: `buildSrtSettings` writes
 * the allowances of `sessionWriteAllowances` into the settings of `srt`, and the host-side lookup of programs
 * (`hostTools.ts`) never uses a directory of `agentWritableDirectories`, so a program the agent planted in a place it
 * can write does not run outside the sandbox. The second list is built from the first, so they cannot drift apart.
 */

/** The temp directory the CLI's Bash tool writes (I1: the tool fails with EPERM when it is not writable). */
export function claudeTempDir(uid: number, platform: NodeJS.Platform): string {
  return platform === 'darwin' ? `/private/tmp/claude-${uid}` : `/tmp/claude-${uid}`;
}

/**
 * What `srt` makes writable whatever the settings say: `SANDBOX_OWN_WRITE_PATHS` (`/tmp/claude`, `/private/tmp/claude`)
 * and `HOME_CONVENIENCE_WRITE_DIRS` (`.npm/_logs`, `.claude/debug` below the home directory) in
 * `dist/sandbox/sandbox-utils.js` of `@anthropic-ai/sandbox-runtime` 0.0.83, read by `getDefaultWritePaths`. The
 * stdio devices that list also holds are files and hold no program.
 */
export function srtDefaultWritePaths(home: string): string[] {
  return ['/tmp/claude', '/private/tmp/claude', join(home, '.npm', '_logs'), join(home, '.claude', 'debug')];
}

/** The Claude configuration of the CLI default login: the directory and the file beside it. */
export function defaultClaudePaths(home: string): string[] {
  return [join(home, '.claude'), join(home, '.claude.json')];
}

export interface WriteAllowanceInput {
  /** Directories the program or the session writes: the workspace and the hook inbox, or the checkout, its temporary directory and its clones. */
  readonly writeDirs: readonly string[];
  /** The profile's Claude configuration directory, or undefined for the CLI default (`~/.claude` and `~/.claude.json`). */
  readonly claudeConfigDir: string | undefined;
  readonly extraWritePaths?: readonly string[] | undefined;
  readonly home?: string | undefined;
  readonly uid?: number | undefined;
  readonly platform?: NodeJS.Platform | undefined;
}

/** The write allowances of an agent session in the settings of `srt`: `buildSrtSettings` puts exactly these into `allowWrite`. */
export function sessionWriteAllowances(input: WriteAllowanceInput): string[] {
  const home = input.home ?? homedir();
  const claude = input.claudeConfigDir === undefined ? defaultClaudePaths(home) : [input.claudeConfigDir];
  return [...input.writeDirs, ...claude, claudeTempDir(input.uid ?? process.getuid?.() ?? 0, input.platform ?? process.platform), ...(input.extraWritePaths ?? [])];
}

export interface AgentWritableInput extends WriteAllowanceInput {
  /**
   * Directories below which agents get their workspaces (the task base: worktrees, swarm workspaces, review
   * checkouts). Another agent of the profile may write any workspace below them, not only the one of this launch.
   */
  readonly agentRoots?: readonly string[] | undefined;
}

/**
 * Everything any sandboxed agent of the profile may write: the session allowances, the defaults of `srt` and the
 * roots of the agents' workspaces. A check adds its own `writeDirs` (checkout, temporary directory, clones). The
 * Claude configuration of the default login is always in it, also for a profile with a directory of its own: the
 * agents of the default profile write it from another profile process, and `~/.claude/local` is where older
 * installs of the CLI put their program.
 */
export function agentWritableDirectories(input: AgentWritableInput): string[] {
  const home = input.home ?? homedir();
  return [...new Set([...sessionWriteAllowances(input), ...srtDefaultWritePaths(home), ...defaultClaudePaths(home), ...(input.agentRoots ?? [])])];
}

/**
 * Where the set of a profile comes from: what the profile and its options say. The launch directories come from
 * `AgentWritableRegistry.add`.
 */
export type AgentWritableSource = Omit<AgentWritableInput, 'writeDirs'>;

/** Where a registry keeps what it learned, so a restart does not forget it (`AgentWritableStore`). */
export interface AgentWritableMemory {
  load(): string[];
  record(paths: readonly string[]): void;
  /** The text of the command that deletes `paths` from the memory, for a user who checked them; undefined when there is none. */
  forgetCommand?(paths: readonly string[]): string | undefined;
}

/** How long a registry waits after a failed read or write of its memory before it tries again. */
export const MEMORY_RETRY_MS = 30_000;

/** The rows of `paths` that no other row contains, in their order. */
function outermost(paths: readonly string[]): string[] {
  const unique = [...new Set(paths)];
  return unique.filter((path) => !unique.some((other) => other !== path && contains(other, path)));
}

/**
 * The one set of directories that the sandboxed agents of a profile process may write. The host tools
 * (`hostTools.ts`) read it at each lookup. The srt and container providers add what a launch makes writable (the
 * workspace, the working directory and the hook inbox, the Claude directory a container mounts) before they start the
 * program, and the session module adds the directory of the hook inboxes. Each lookup also takes in what the profile
 * says at that moment (`extraWritePaths`, the Claude directory, the task base), read once per turn of the event loop. A
 * directory is never removed: what an agent planted there stays after its session ends, after the option that allowed
 * it is removed and after a restart. With `memory` every directory is kept in the profile database and loaded again at
 * start.
 *
 * The set in memory stays small: a directory whose real path lies within a directory of the set (a workspace below
 * the task base, an inbox below the directory of the inboxes) adds nothing, and a new directory that contains rows of
 * the set takes their place in memory (their rows stay in the database). A directory is kept as it is spelled and,
 * when it differs, as its real path at that moment, so a link that is changed later does not take it out of the set.
 * A failed write of the memory keeps the directory in memory and writes it again at a later lookup.
 */
export class AgentWritableRegistry {
  /** The directories in memory: no one lies within another. */
  private rows: string[] = [];
  /** Directories of `rows` that the memory does not hold yet. */
  private readonly unwritten = new Set<string>();
  private loaded = false;
  private sourced = false;
  private retryAt = 0;
  private readonly reported = new Set<string>();

  constructor(
    private readonly source: () => AgentWritableSource = () => ({ claudeConfigDir: undefined }),
    private readonly memory?: AgentWritableMemory,
    private readonly now: () => number = Date.now,
  ) {
    this.sync();
  }

  /** Adds directories; a relative one is made absolute, an undefined one and an empty one are ignored. A new one is recorded in the memory. */
  add(directories: Iterable<string | undefined>): void {
    this.readSource();
    this.insert(directories);
  }

  /** Everything an agent may write now or could write before: what the profile says now, every added directory and everything the memory holds. */
  directories(): string[] {
    this.readSource();
    this.sync();
    return [...this.rows];
  }

  /**
   * The text for a program that is refused because it lies in a directory that was recorded at a launch, such as the
   * home directory: the recorded directories that hold one of `paths` and the command that forgets them. Undefined when
   * no recorded directory holds them, or when the profile names one that does now (`extraWritePaths`, the task base).
   */
  recordedHolding(paths: readonly string[]): string | undefined {
    if (paths.some((path) => isWithinAny(path, agentWritableDirectories({ ...this.source(), writeDirs: [] })))) return undefined;
    const holding = [...new Set([...this.safeLoad(), ...this.rows])].filter((row) => paths.some((path) => isWithinAny(path, [row]))).sort();
    if (holding.length === 0) return undefined;
    const command = this.memory?.forgetCommand?.(holding);
    const forget = command === undefined ? 'the app forgets it when it starts with a new profile database' : `after checking that it holds nothing an agent wrote, quit the app and run: ${command}`;
    return `recorded as writable by an agent: ${holding.join(', ')}; ${forget}`;
  }

  private readSource(): void {
    if (this.sourced) return;
    this.sourced = true;
    queueMicrotask(() => {
      this.sourced = false;
    });
    this.insert(agentWritableDirectories({ ...this.source(), writeDirs: [] }));
  }

  private insert(directories: Iterable<string | undefined>): void {
    const fresh: string[] = [];
    for (const directory of directories) {
      if (directory === undefined || directory === '') continue;
      const absolute = resolve(directory);
      const real = realForms(absolute);
      // A directory is judged by where it lies: a link into a directory of the set adds nothing.
      if (real.some((form) => this.covers(form))) continue;
      fresh.push(...[absolute, ...real].filter((form) => !this.covers(form)));
    }
    if (fresh.length === 0) return;
    const added = outermost(fresh);
    this.rows = [...this.rows.filter((row) => !added.some((path) => contains(path, row))), ...added];
    if (this.memory !== undefined) for (const path of added) this.unwritten.add(path);
    this.sync();
  }

  private covers(path: string): boolean {
    return this.rows.some((row) => contains(row, path));
  }

  /** Loads the memory when that failed before and writes what it does not hold yet; after a failure it waits `MEMORY_RETRY_MS`. */
  private sync(): void {
    if (this.memory === undefined || this.now() < this.retryAt || (this.loaded && this.unwritten.size === 0)) return;
    try {
      if (!this.loaded) {
        const stored = this.memory.load();
        this.loaded = true;
        this.rows = outermost([...stored, ...this.rows]);
      }
      if (this.unwritten.size > 0) {
        const batch = [...this.unwritten];
        this.memory.record(batch);
        for (const path of batch) this.unwritten.delete(path);
      }
    } catch (error) {
      this.retryAt = this.now() + MEMORY_RETRY_MS;
      this.report(this.loaded ? 'written to' : 'read from', error);
    }
  }

  private safeLoad(): string[] {
    try {
      return this.memory?.load() ?? [];
    } catch {
      return [];
    }
  }

  private report(what: string, error: unknown): void {
    if (this.reported.has(what)) return;
    this.reported.add(what);
    console.warn(`The directories that agents may write could not be ${what} the profile database; the app keeps them in memory and tries again later: ${error instanceof Error ? error.message : String(error)}`);
  }
}
