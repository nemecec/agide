/**
 * The environment of a check (0040 section 6). The app builds it from a list of names, not from its own environment:
 * the profile's environment is a copy of the app's, so a name that is not listed here does not reach the check.
 * Credentials never do, whatever the list or the policy says. The check environment also gets the per-run marker
 * (`AGIDE_CHECK_RUN`) and the proxy variables that `srt` adds; the proxy credentials only authenticate to the run's
 * own local proxy and are random for each run.
 */

const SCRUBBED_PREFIXES = ['CLAUDE_CODE', 'ANTHROPIC_', 'GH_', 'GITHUB_', 'AWS_'] as const;
/** A name that equals one of these or ends in one is scrubbed (`TOKEN`, `DEPLOY_TOKEN`, `OPENAI_APIKEY`, `SIGNING_KEY`, `NVM_AUTH_HEADER`, `GPG_PASSPHRASE`, `CI_JOB_JWT`, `KEYCHAIN_PW`). Every rule compares the upper-cased name. */
const SCRUBBED_ENDINGS = ['TOKEN', 'PASSWORD', 'PASSWD', 'PASSPHRASE', 'SECRET', 'APIKEY', '_KEY', 'HEADER', 'JWT', '_PW'] as const;
/** A name with one of these as a whole word is scrubbed (`SSH_AUTH_SOCK`, `NPM_CONFIG_AUTH`), and `GIT_AUTHOR_NAME` is not. */
const SCRUBBED_WORDS = ['AUTH', 'AUTHORIZATION', 'OAUTH'] as const;
/** A name that contains this anywhere is scrubbed (`DOCKER_CREDENTIAL_HELPER`, `GIT_CREDENTIALS`). */
const SCRUBBED_FRAGMENT = 'CREDENTIAL';

export const isScrubbedName = (name: string): boolean => {
  const upper = name.toUpperCase();
  return (
    SCRUBBED_PREFIXES.some((prefix) => upper.startsWith(prefix)) ||
    SCRUBBED_ENDINGS.some((ending) => upper.endsWith(ending)) ||
    upper.split('_').some((word) => (SCRUBBED_WORDS as readonly string[]).includes(word)) ||
    upper.includes(SCRUBBED_FRAGMENT)
  );
};

/** The names of `allowed` that the policy lists and that never reach a check, for the log of the run. */
export const droppedNames = (allowed: readonly string[]): string[] => allowed.filter(isScrubbedName);

/** Names a check gets from the profile environment: how to find programs, the language, and where toolchains live. */
export const CHECK_ENV_NAMES: readonly string[] = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'LANG',
  'LANGUAGE',
  'TERM',
  'TZ',
  'NO_COLOR',
  'JAVA_HOME',
  'JDK_HOME',
  'MAVEN_HOME',
  'M2_HOME',
  'GRADLE_HOME',
  'RUSTUP_HOME',
  'RUSTUP_TOOLCHAIN',
  'GOROOT',
  'PYENV_ROOT',
  'PYENV_VERSION',
  'ASDF_DIR',
  'ASDF_DATA_DIR',
  'VOLTA_HOME',
  'NVM_DIR',
  'NVM_BIN',
  'NVM_INC',
  'NVM_CD_FLAGS',
];
/** Prefixes of names a check gets: locale settings and the homes of the version managers. */
export const CHECK_ENV_PREFIXES: readonly string[] = ['LC_', 'SDKMAN_', 'HOMEBREW_'];

const inList = (name: string): boolean => CHECK_ENV_NAMES.includes(name) || CHECK_ENV_PREFIXES.some((prefix) => name.startsWith(prefix));

/**
 * The listed names of the profile environment, `CI=1` and `HOME` (the real home directory: toolchains below it stay
 * readable). `allowed` are the names `check.env` of the policy lists; they are copied from the profile environment
 * unless they are scrubbed names.
 */
export function checkEnvironment(profileEnv: Readonly<Record<string, string>>, allowed: readonly string[], home: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(profileEnv)) if (inList(name) && !isScrubbedName(name)) env[name] = value;
  env['HOME'] = home;
  env['CI'] = '1';
  // A scrubbed name stays scrubbed: the policy that lists it may come from an agent's branch.
  for (const name of allowed) if (Object.hasOwn(profileEnv, name) && !isScrubbedName(name) && name !== 'HOME') env[name] = profileEnv[name]!;
  return env;
}
