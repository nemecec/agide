import type { PermissionMode } from './types';
import { hookSettings } from './hooks';

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
  /** Arguments the integrator adds, such as the app MCP server config. */
  readonly extraArgs?: readonly string[];
}

/** Claude Code settings write an absolute path with a leading double slash. */
function denyRules(paths: readonly string[]): { permissions?: { deny: string[] } } {
  if (paths.length === 0) return {};
  return { permissions: { deny: paths.flatMap((path) => [`Read(/${path}/**)`, `Edit(/${path}/**)`]) } };
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
    JSON.stringify({ ...hookSettings(input.inboxDir), ...denyRules(input.denyPaths ?? []) }),
    ...(input.mcpConfigPath === undefined ? [] : ['--mcp-config', input.mcpConfigPath]),
    ...(input.extraArgs ?? []),
  ];
}
