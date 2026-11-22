import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, delimiter, isAbsolute, join } from 'node:path';

/** What a reviewer started with `--setting-sources user` loads from the Claude configuration directory. */
const FILES = ['CLAUDE.md', 'settings.json', 'settings.local.json', join('plugins', 'installed_plugins.json')];
const DIRECTORIES = ['skills', 'agents', 'commands', 'output-styles', 'hooks'];

function hookCommands(settings: unknown): string[] {
  const hooks = (settings as { hooks?: unknown } | null)?.hooks;
  if (typeof hooks !== 'object' || hooks === null) return [];
  const commands: string[] = [];
  for (const groups of Object.values(hooks)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups as { hooks?: unknown }[]) {
      if (!Array.isArray(group?.hooks)) continue;
      for (const hook of group.hooks as { command?: unknown }[]) if (typeof hook?.command === 'string') commands.push(hook.command);
    }
  }
  return commands;
}

const INTERPRETERS = /^(sh|bash|zsh|dash|fish|node|deno|bun|ruby|perl|php|python[0-9.]*|uv|uvx|npx|tsx)$/;

function expand(word: string, claudeDir: string, home: string): string {
  return word
    .replace(/^["']|["']$/g, '')
    .replace(/^\$\{?CLAUDE_CONFIG_DIR\}?/, claudeDir)
    .replace(/^(~|\$HOME|\$\{HOME\})(?=\/|$)/, home);
}

/** A bare program name resolved through `PATH`, or undefined when no executable file of that name is found. */
function onPath(name: string): string | undefined {
  for (const directory of (process.env['PATH'] ?? '').split(delimiter)) {
    if (directory === '') continue;
    const candidate = join(directory, name);
    if (isRegularFile(candidate)) return candidate;
  }
  return undefined;
}

function isRegularFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The files a hook command runs: in each simple command the program, and the script after an interpreter. Arguments
 * and directories are left out, because a log file or a project path among them would change the hash on every run.
 */
function scriptPaths(command: string, claudeDir: string): string[] {
  const home = homedir();
  const found: string[] = [];
  for (const simple of command.split(/&&|\|\||[;|]/)) {
    const words = simple.trim().split(/\s+/).filter((word) => word !== '' && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word));
    if (words[0] === 'env') words.shift();
    const program = expand(words[0] ?? '', claudeDir, home);
    if (program === '') continue;
    const candidates = [program];
    if (INTERPRETERS.test(basename(program))) {
      const script = words.slice(1).find((word) => !word.startsWith('-'));
      if (script !== undefined) candidates.push(expand(script, claudeDir, home));
    }
    for (const candidate of candidates) {
      const resolved = isAbsolute(candidate) ? candidate : candidate.includes('/') ? undefined : onPath(candidate);
      if (resolved !== undefined && !isDirectory(resolved)) found.push(resolved);
    }
  }
  return found;
}

/**
 * The files and directories of the user's Claude configuration that a reviewer would load: instructions and
 * settings, skills, agents, commands, output styles, hooks, the plugin manifest, and the programs and scripts the
 * settings name as hook commands. The caller hashes them before a swarm starts and again before each reviewer starts.
 */
export function userConfigPaths(claudeDir: string): string[] {
  const paths = [...FILES.map((file) => join(claudeDir, file)), ...DIRECTORIES.map((directory) => join(claudeDir, directory))];
  try {
    const settings: unknown = JSON.parse(readFileSync(join(claudeDir, 'settings.json'), 'utf8'));
    for (const command of hookCommands(settings)) paths.push(...scriptPaths(command, claudeDir));
  } catch {
    // No readable settings file: its own hash covers its absence.
  }
  return [...new Set(paths)];
}
