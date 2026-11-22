import { join } from 'node:path';

/** The environment of a check (0040 section 6): the profile's launch environment without credentials of the agent, plus `CI=1`. */

const SCRUBBED_PREFIXES = ['CLAUDE_CODE', 'ANTHROPIC_', 'GH_', 'GITHUB_', 'AWS_'] as const;
const SCRUBBED_SUFFIXES = ['_TOKEN', '_KEY', '_SECRET', '_PASSWORD'] as const;

export const isScrubbedName = (name: string): boolean => SCRUBBED_PREFIXES.some((prefix) => name.startsWith(prefix)) || SCRUBBED_SUFFIXES.some((suffix) => name.endsWith(suffix));

/** `allowed` are the names `check.env` of the policy lists; they are copied from the profile environment unless they are scrubbed names. */
export function checkEnvironment(profileEnv: Readonly<Record<string, string>>, allowed: readonly string[]): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(profileEnv)) if (!isScrubbedName(name)) env[name] = value;
  env['CI'] = '1';
  // A scrubbed name stays scrubbed: the policy that lists it may come from an agent's branch.
  for (const name of allowed) if (Object.hasOwn(profileEnv, name) && !isScrubbedName(name)) env[name] = profileEnv[name]!;
  return env;
}

/**
 * Where a confined check keeps what tools write by default: the home directory, the XDG directories and the cache
 * variables of the common package managers point below `directory`, so the check needs no other writable place
 * besides its checkout and its temporary directory.
 */
export function cacheEnvironment(directory: string): Record<string, string> {
  const at = (...parts: string[]): string => join(directory, ...parts);
  return {
    HOME: at('home'),
    XDG_CACHE_HOME: at('xdg', 'cache'),
    XDG_CONFIG_HOME: at('xdg', 'config'),
    XDG_DATA_HOME: at('xdg', 'data'),
    XDG_STATE_HOME: at('xdg', 'state'),
    npm_config_cache: at('npm'),
    YARN_CACHE_FOLDER: at('yarn'),
    PNPM_HOME: at('pnpm'),
    PIP_CACHE_DIR: at('pip'),
    UV_CACHE_DIR: at('uv'),
    CARGO_HOME: at('cargo'),
    GRADLE_USER_HOME: at('gradle'),
    GOCACHE: at('go', 'build'),
    GOMODCACHE: at('go', 'mod'),
  };
}

/** The per-swarm cache directory of the checks, below the review data of the swarm; it is removed with the swarm. */
export const checkCacheDirectory = (dataDir: string, swarmId: string): string => join(dataDir, 'review', swarmId, 'check-cache');
