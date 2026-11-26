import { homedir } from 'node:os';
import { join } from 'node:path';

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
  const claude = input.claudeConfigDir === undefined ? [join(home, '.claude'), join(home, '.claude.json')] : [input.claudeConfigDir];
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
 * roots of the agents' workspaces. A check adds its own `writeDirs` (checkout, temporary directory, clones).
 */
export function agentWritableDirectories(input: AgentWritableInput): string[] {
  const home = input.home ?? homedir();
  return [...new Set([...sessionWriteAllowances(input), ...srtDefaultWritePaths(home), ...(input.agentRoots ?? [])])];
}
