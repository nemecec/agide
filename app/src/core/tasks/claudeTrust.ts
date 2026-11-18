import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** The login's `.claude.json`: in `CLAUDE_CONFIG_DIR` when the profile sets one, else in the home directory. */
export function claudeJsonPath(env: NodeJS.ProcessEnv): string {
  const dir = env['CLAUDE_CONFIG_DIR'];
  return dir ? join(dir, '.claude.json') : join(env['HOME'] || homedir(), '.claude.json');
}

function trustedProjects(file: string): ReadonlySet<string> {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { projects?: Record<string, { hasTrustDialogAccepted?: unknown }> };
    return new Set(Object.entries(parsed.projects ?? {}).filter(([, entry]) => entry.hasTrustDialogAccepted === true).map(([path]) => path));
  } catch {
    return new Set();
  }
}

/**
 * Whether the login already trusts the directory: an entry for it or for an ancestor, the walk ending at the
 * git root (P24). Read only; the app never writes this file.
 */
export function isFolderTrusted(dir: string, claudeJson: string): boolean {
  const trusted = trustedProjects(claudeJson);
  if (trusted.size === 0) return false;
  let current: string;
  try {
    current = realpathSync(dir);
  } catch {
    current = dir;
  }
  for (;;) {
    if (trusted.has(current)) return true;
    if (existsSync(join(current, '.git'))) return false;
    const parent = dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}
