import { join } from 'node:path';

/**
 * Paths the sandboxed check may not read. `srt` allows reads everywhere unless a path is denied, so the list holds at
 * least what the agent's own session may not read, and everything the app keeps: the app root with the data, tools
 * and Claude directories of every profile and the profile registry, the app's logs and crash dumps, and the Claude
 * configuration directory of the profile that runs the check: for the default login (`cli-default`) that is
 * `~/.claude` and `~/.claude.json`, outside the app root, and it holds the transcripts of the agents and reviewers.
 * The checkout, the
 * clones and the temporary directory of a run live below the task base, not below the app root. Credentials in the
 * real home directory that no tool reads by default are denied too; files that tools read by default (`.npmrc`,
 * `settings.xml`) stay readable, so the check can read a few files of the user that are not secret to the tools.
 */

/** Locations below the home directory that hold credentials and that no build tool needs. */
export const HOME_CREDENTIAL_PATHS: readonly string[] = ['.ssh', '.gnupg', '.aws', '.netrc', '.git-credentials', '.pypirc', join('.config', 'gh'), join('.docker', 'config.json')];

export interface CheckDenyReadInput {
  /** `extraDenyRead` of the profile's isolation options: what the agent's own session may not read. */
  readonly agent: readonly string[] | undefined;
  /** The app root: the directory that holds `profiles/` and `registry/`. */
  readonly appRoot: string;
  /** The app's logs and crash dumps, and other directories of the app that the check has no use for. */
  readonly appDirs: readonly string[];
  readonly home: string;
  /** The Claude configuration paths of the profile that runs the check (`claudeConfigPaths`). */
  readonly claude: readonly string[];
}

export function checkDenyRead(input: CheckDenyReadInput): string[] {
  return [...new Set([...(input.agent ?? []), input.appRoot, ...input.appDirs, ...input.claude, ...HOME_CREDENTIAL_PATHS.map((path) => join(input.home, path))])];
}

/**
 * The Claude configuration of a profile: its own directory (a profile that adopted an inherited `CLAUDE_CONFIG_DIR`
 * has it as its directory), or for the default login `~/.claude` and the file `~/.claude.json` beside it, the same
 * rule as the agent's sandbox.
 */
export function claudeConfigPaths(input: { readonly configured: string | undefined; readonly home: string }): string[] {
  return input.configured === undefined ? [join(input.home, '.claude'), join(input.home, '.claude.json')] : [input.configured];
}
