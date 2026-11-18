import type { ProviderCapabilities, ProviderId, SessionFileName } from '../isolation/types';
import type { HookEventName } from './hooks';
import type { PermissionMode, SessionInfo } from './types';

/**
 * Launch contributions (0029). Modules that add to a session's launch (permissions, browser, agents, tasks)
 * register a contributor; the session service asks every contributor before each spawn, for `create` and for
 * `resume`, and merges the answers. No module other than the session module edits the launch code.
 */

/** One hook entry in the `--settings` JSON. `timeout` is in seconds, as the CLI reads it. */
export interface HookCommandEntry {
  readonly type: 'command';
  readonly command: string;
  readonly timeout?: number;
}

/** A part of the `--settings` JSON. Merged by `mergeContributions`. */
export interface SettingsFragment {
  /** Appended after the app's own hook entry of the same event. */
  readonly hooks?: Partial<Record<HookEventName, readonly HookCommandEntry[]>>;
  readonly permissions?: {
    readonly ask?: readonly string[];
    readonly deny?: readonly string[];
    readonly allow?: readonly string[];
  };
  /** Any other top-level key, such as `sandbox` or `statusLine`. One contributor owns each key. */
  readonly [key: string]: unknown;
}

export interface LaunchContext {
  readonly session: SessionInfo;
  readonly resume: boolean;
  readonly permissionMode: PermissionMode;
  readonly provider: { readonly id: ProviderId; readonly capabilities: ProviderCapabilities };
  /** The session's hook inbox directory as the CLI inside the environment sees it. */
  readonly hookDir: string;
  /** Maps a host path into the environment. */
  toEnv(hostPath: string): string;
  /** The app MCP endpoint URL as the CLI inside the environment must use it (`/mcp/<session>`). */
  readonly mcpUrl: string;
  /** Writes a 0600 session file through the environment and returns its path inside the environment. */
  writeSessionFile(name: SessionFileName, content: string): Promise<string>;
}

export interface LaunchContribution {
  readonly settings?: SettingsFragment;
  /**
   * Base hook events whose write-only app command this contribution replaces with its own `settings.hooks`
   * entry (the permission inspector writes the payload itself). One contributor per event.
   */
  readonly replacesBaseHooks?: readonly HookEventName[];
  /** Arguments appended after the app's own, such as `--add-dir <dir>` or `--no-chrome`. No secrets. */
  readonly args?: readonly string[];
  /** Variables set for this launch on top of the profile environment. No secrets. */
  readonly env?: Readonly<Record<string, string>>;
  /** Servers added to the session's `mcp.json` next to `app`, such as `agide-browser`. Skipped when the session has no MCP grant. */
  readonly mcpServers?: Readonly<Record<string, object>>;
}

export interface LaunchContributor {
  /** Names the contributor in errors, such as `permissions`. */
  readonly id: string;
  contribute(context: LaunchContext): LaunchContribution | Promise<LaunchContribution>;
}

/** Registered by modules at init, read by the session service before every launch. */
export class LaunchContributors {
  private readonly contributors: LaunchContributor[] = [];

  /** Adds a contributor; contributions merge in registration order. Returns a function that removes it. */
  register(contributor: LaunchContributor): () => void {
    if (this.contributors.some((existing) => existing.id === contributor.id)) throw new Error(`launch contributor ${contributor.id} is registered twice`);
    this.contributors.push(contributor);
    return () => {
      const index = this.contributors.indexOf(contributor);
      if (index >= 0) this.contributors.splice(index, 1);
    };
  }

  list(): readonly LaunchContributor[] {
    return [...this.contributors];
  }
}

export interface MergedContribution {
  readonly settings: SettingsFragment;
  readonly replacesBaseHooks: readonly HookEventName[];
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly mcpServers: Readonly<Record<string, object>>;
}

const RESERVED_SERVERS = new Set(['app']);

/**
 * Merges contributions in order. Hook entries and permission rules are appended; arguments are appended;
 * every other settings key, environment variable, MCP server name and replaced hook may come from one
 * contributor only, and a second one throws, so two modules cannot silently override each other.
 */
export function mergeContributions(entries: readonly { readonly id: string; readonly contribution: LaunchContribution }[]): MergedContribution {
  const hooks: Partial<Record<HookEventName, HookCommandEntry[]>> = {};
  const rules = { ask: [] as string[], deny: [] as string[], allow: [] as string[] };
  const other: Record<string, unknown> = {};
  const owners = new Map<string, string>();
  const claim = (key: string, id: string): void => {
    const owner = owners.get(key);
    if (owner !== undefined) throw new Error(`launch contributors ${owner} and ${id} both set ${key}`);
    owners.set(key, id);
  };
  const replaced: HookEventName[] = [];
  const args: string[] = [];
  const env: Record<string, string> = {};
  const mcpServers: Record<string, object> = {};

  for (const { id, contribution } of entries) {
    const { hooks: fragmentHooks, permissions, ...rest } = contribution.settings ?? {};
    for (const [event, list] of Object.entries(fragmentHooks ?? {}) as [HookEventName, readonly HookCommandEntry[]][]) {
      (hooks[event] ??= []).push(...list);
    }
    rules.ask.push(...(permissions?.ask ?? []));
    rules.deny.push(...(permissions?.deny ?? []));
    rules.allow.push(...(permissions?.allow ?? []));
    for (const [key, value] of Object.entries(rest)) {
      claim(`settings.${key}`, id);
      other[key] = value;
    }
    for (const event of contribution.replacesBaseHooks ?? []) {
      claim(`hook ${event}`, id);
      replaced.push(event);
    }
    args.push(...(contribution.args ?? []));
    for (const [key, value] of Object.entries(contribution.env ?? {})) {
      claim(`env ${key}`, id);
      env[key] = value;
    }
    for (const [name, server] of Object.entries(contribution.mcpServers ?? {})) {
      if (RESERVED_SERVERS.has(name)) throw new Error(`launch contributor ${id} cannot replace the ${name} MCP server`);
      claim(`mcp ${name}`, id);
      mcpServers[name] = server;
    }
  }

  const permissions = Object.fromEntries(Object.entries(rules).filter(([, list]) => list.length > 0));
  return {
    settings: {
      ...other,
      ...(Object.keys(hooks).length === 0 ? {} : { hooks }),
      ...(Object.keys(permissions).length === 0 ? {} : { permissions }),
    },
    replacesBaseHooks: replaced,
    args,
    env,
    mcpServers,
  };
}
