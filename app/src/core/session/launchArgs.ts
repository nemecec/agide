import type { PermissionMode } from './types';
import { hookSettings, type HookEventName } from './hooks';
import type { SettingsFragment } from './launchContributions';

/** The CLI calls the prompting mode `manual`; the app contract calls it `default`. */
export function cliPermissionMode(mode: PermissionMode): string {
  return mode === 'default' ? 'manual' : mode;
}

export interface LaunchArgsInput {
  readonly sessionId: string;
  /** True for a reopened session: `--resume` in place of `--session-id`. */
  readonly resume: boolean;
  readonly permissionMode: PermissionMode;
  /** Directory the hook commands write their payload files to. */
  readonly inboxDir: string;
  /** Path of the app MCP server config file, as the CLI sees it. The file carries the bearer token, so the token never appears in the arguments. */
  readonly mcpConfigPath?: string | undefined;
  /** Absolute paths the CLI may not read or edit. Rules cover the CLI's file tools; a shell command is not covered. */
  readonly denyPaths?: readonly string[];
  /** Merged launch contributions (`mergeContributions`): hooks and rules are added to the app's own. */
  readonly settings?: SettingsFragment;
  /** Base hook events whose write-only app command a contribution replaces. */
  readonly replacesBaseHooks?: readonly HookEventName[];
  /** Arguments the integrator adds, such as the app MCP server config. */
  readonly extraArgs?: readonly string[];
}

/** Claude Code settings write an absolute path with a leading double slash. */
function denyRules(paths: readonly string[]): string[] {
  return paths.flatMap((path) => [`Read(/${path}/**)`, `Edit(/${path}/**)`]);
}

/** The `--settings` JSON: the app's hooks, its deny rules for the app root and the merged contributions. */
export function launchSettings(input: Pick<LaunchArgsInput, 'inboxDir' | 'denyPaths' | 'settings' | 'replacesBaseHooks'>): Record<string, unknown> {
  const { hooks: extraHooks, permissions: extraRules, ...rest } = input.settings ?? {};
  const replaced = new Set(input.replacesBaseHooks ?? []);
  const hooks: Record<string, { hooks: unknown[] }[]> = {};
  for (const [event, entries] of Object.entries(hookSettings(input.inboxDir).hooks)) {
    if (!replaced.has(event as HookEventName)) hooks[event] = [...entries];
  }
  for (const [event, list] of Object.entries(extraHooks ?? {})) {
    if (list && list.length > 0) hooks[event] = [...(hooks[event] ?? []), { hooks: [...list] }];
  }
  const deny = [...denyRules(input.denyPaths ?? []), ...(extraRules?.deny ?? [])];
  const permissions = {
    ...(deny.length === 0 ? {} : { deny }),
    ...(extraRules?.ask?.length ? { ask: [...extraRules.ask] } : {}),
    ...(extraRules?.allow?.length ? { allow: [...extraRules.allow] } : {}),
  };
  return { ...rest, hooks, ...(Object.keys(permissions).length === 0 ? {} : { permissions }) };
}

/**
 * Arguments of one `claude` launch. User settings load and project settings do not, so a checkout's own
 * hooks and servers stay out. The app's hooks come in through `--settings` and never touch the user's files.
 */
export function buildLaunchArgs(input: LaunchArgsInput): string[] {
  return [
    input.resume ? '--resume' : '--session-id',
    input.sessionId,
    '--permission-mode',
    cliPermissionMode(input.permissionMode),
    '--setting-sources',
    'user',
    '--settings',
    JSON.stringify(launchSettings(input)),
    ...(input.mcpConfigPath === undefined ? [] : ['--mcp-config', input.mcpConfigPath]),
    ...(input.extraArgs ?? []),
  ];
}
