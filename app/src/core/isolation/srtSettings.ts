import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { NetworkPolicy } from './types';

/** Hosts the CLI needs for the API and the sign-in flow. Always allowed. */
export const ANTHROPIC_HOSTS: readonly string[] = ['api.anthropic.com', '*.anthropic.com', 'claude.ai', '*.claude.ai', 'platform.claude.com'];

/** Loopback: the app MCP server. srt sets NO_PROXY for it, so the allowlist entry only documents the intent. */
export const LOOPBACK_HOSTS: readonly string[] = ['127.0.0.1', 'localhost'];

/**
 * What a session may reach when its network policy is `unrestricted`. srt always enforces an allowlist and has no
 * allow-everything entry, so the provider uses the hosts of ordinary source hosting and package registries.
 */
export const DEVELOPMENT_HOSTS: readonly string[] = [
  'github.com',
  '*.github.com',
  '*.githubusercontent.com',
  'registry.npmjs.org',
  'pypi.org',
  'files.pythonhosted.org',
];

/** The configuration srt reads with `-s`. Only the keys the provider sets. */
export interface SrtSettings {
  readonly allowPty: true;
  readonly network: {
    readonly allowedDomains: readonly string[];
    readonly deniedDomains: readonly string[];
    readonly allowLocalBinding: true;
  };
  readonly filesystem: {
    readonly denyRead: readonly string[];
    readonly allowRead: readonly string[];
    readonly denyWrite: readonly string[];
    readonly allowWrite: readonly string[];
  };
}

export interface SrtSettingsInput {
  /** Directories the agent writes: the workspace and the session's hook inbox. */
  readonly writeDirs: readonly string[];
  /** The profile's Claude configuration directory, or undefined for the CLI default (`~/.claude` and `~/.claude.json`). */
  readonly claudeConfigDir: string | undefined;
  readonly extraWritePaths?: readonly string[];
  readonly extraDenyRead?: readonly string[];
  readonly network: NetworkPolicy;
  readonly home?: string;
  readonly uid?: number;
  readonly platform?: NodeJS.Platform;
}

/** The temp directory the CLI's Bash tool writes (I1: the tool fails with EPERM when it is not writable). */
export function claudeTempDir(uid: number, platform: NodeJS.Platform): string {
  return platform === 'darwin' ? `/private/tmp/claude-${uid}` : `/tmp/claude-${uid}`;
}

/**
 * Files and directories of a Claude configuration directory that change what a later, unsandboxed session loads
 * (user settings with hooks, instructions, commands, agents, skills, plugins). A sandboxed session reads them and
 * cannot write them. `.claude.json` stays writable because the CLI keeps its own state there.
 */
export const CLAUDE_CONFIG_PROTECTED: readonly string[] = ['settings.json', 'settings.local.json', 'CLAUDE.md', 'keybindings.json', 'commands', 'agents', 'skills', 'plugins', 'hooks'];

/** A path and its resolved form: Seatbelt matches resolved paths, and a workspace under `/tmp` or `/var` is a link. */
function withResolved(path: string): string[] {
  try {
    const resolved = realpathSync(path);
    return resolved === path ? [path] : [path, resolved];
  } catch {
    return [path];
  }
}

export function srtAllowedDomains(network: NetworkPolicy): string[] {
  const entries = network.mode === 'unrestricted' ? [...DEVELOPMENT_HOSTS] : network.allow.map((entry) => (entry.port === undefined ? entry.host : `${entry.host}:${entry.port}`));
  return [...new Set([...ANTHROPIC_HOSTS, ...LOOPBACK_HOSTS, ...entries])];
}

/** Settings of probe I1 (`notes/probes-m3-isolation.md`) with the paths and hosts of one session. */
export function buildSrtSettings(input: SrtSettingsInput): SrtSettings {
  const home = input.home ?? homedir();
  const claude =
    input.claudeConfigDir === undefined ? [join(home, '.claude'), join(home, '.claude.json')] : [input.claudeConfigDir];
  const configDir = input.claudeConfigDir ?? join(home, '.claude');
  const protectedPaths = CLAUDE_CONFIG_PROTECTED.map((name) => join(configDir, name));
  const writes = [...input.writeDirs, ...claude, claudeTempDir(input.uid ?? process.getuid?.() ?? 0, input.platform ?? process.platform), ...(input.extraWritePaths ?? [])];
  return {
    allowPty: true,
    network: { allowedDomains: srtAllowedDomains(input.network), deniedDomains: [], allowLocalBinding: true },
    filesystem: {
      denyRead: [...(input.extraDenyRead ?? [])],
      allowRead: [],
      denyWrite: [...new Set(protectedPaths.flatMap(withResolved))],
      allowWrite: [...new Set(writes.flatMap(withResolved))],
    },
  };
}

export interface ToolSrtSettingsInput {
  /** Directories the program may write: its checkout and a temporary directory. */
  readonly writeDirs: readonly string[];
  readonly network: 'none' | 'development';
  readonly extraDenyRead?: readonly string[];
}

/** Settings for a program without an agent (0040 section 6): writes limited to `writeDirs`, no hosts or the development hosts. */
export function buildToolSrtSettings(input: ToolSrtSettingsInput): SrtSettings {
  return {
    allowPty: true,
    network: { allowedDomains: input.network === 'development' ? [...DEVELOPMENT_HOSTS] : [], deniedDomains: [], allowLocalBinding: true },
    filesystem: { denyRead: [...(input.extraDenyRead ?? [])], allowRead: [], denyWrite: [], allowWrite: [...new Set(input.writeDirs.flatMap(withResolved))] },
  };
}
