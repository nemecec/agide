import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { homedir } from 'node:os';
import type { PermissionMode } from './types';

// Variables a parent Claude Code session injects. `CLAUDE_CONFIG_DIR` is not among them: it selects the login.
const INHERITED = /^(CLAUDECODE|CLAUDE_CODE_.*|CLAUDE_JOB_DIR|CLAUDE_PID|CLAUDE_AGENTS_.*|CLAUDE_EFFORT|AI_AGENT)$/;

/** The environment of a launched `claude`: the base environment without injected variables, plus a terminal type. */
export function claudeEnv(base: NodeJS.ProcessEnv, extra: NodeJS.ProcessEnv = {}): Record<string, string> {
  const merged: NodeJS.ProcessEnv = { ...base };
  for (const key of Object.keys(merged)) if (INHERITED.test(key)) delete merged[key];
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries({ ...merged, TERM: 'xterm-256color', COLORTERM: 'truecolor', ...extra })) {
    if (value !== undefined) env[key] = value;
  }
  return env;
}

/**
 * Arguments added to every `claude` launch from `AGIDE_CLAUDE_ARGS`, a JSON array of strings, such as
 * `["--model","haiku"]` for test runs. Throws on any other value, so a typo does not launch an unintended model.
 */
export function claudeArgsFromEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env['AGIDE_CLAUDE_ARGS'];
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || !parsed.every((arg) => typeof arg === 'string')) {
    throw new Error('AGIDE_CLAUDE_ARGS must be a JSON array of strings');
  }
  return parsed;
}

/**
 * Working directory of a session started without one: `AGIDE_SESSION_CWD`, else a directory of its own per folder
 * under `Agide` in the home directory. The home directory itself is never the default, because the app's data
 * lives below it.
 */
export function defaultSessionCwd(folderId: string, env: NodeJS.ProcessEnv = process.env): string {
  return env['AGIDE_SESSION_CWD'] || join(env['HOME'] || homedir(), 'Agide', folderId);
}

/**
 * Finds the `claude` executable. An app started from the Finder has a short PATH, so the usual install
 * locations are tried before PATH.
 */
export function resolveClaudeBinary(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env['AGIDE_CLAUDE_BIN'];
  if (explicit) return explicit;
  const candidates = [
    join(homedir(), '.local', 'bin', 'claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    ...(env['PATH'] ?? '').split(delimiter).filter(Boolean).map((dir) => join(dir, 'claude')),
  ];
  return candidates.find((path) => existsSync(path)) ?? 'claude';
}

/** Modes `AGIDE_PERMISSION_MODE` may name. `bypassPermissions` needs a per-session confirmation, so it is not among them. */
const DEFAULT_MODES: readonly PermissionMode[] = ['default', 'acceptEdits', 'plan', 'auto'];

/**
 * The permission mode of sessions that name none: `AGIDE_PERMISSION_MODE`, else `default` (the CLI's prompting
 * mode, every tool call asks). Throws on any other value, so a typo does not start sessions in a looser mode.
 */
export function defaultPermissionModeFromEnv(env: NodeJS.ProcessEnv = process.env): PermissionMode {
  const raw = env['AGIDE_PERMISSION_MODE'];
  if (!raw) return 'default';
  const mode = DEFAULT_MODES.find((candidate) => candidate === raw);
  if (mode === undefined) throw new Error(`AGIDE_PERMISSION_MODE must be one of ${DEFAULT_MODES.join(', ')}`);
  return mode;
}
