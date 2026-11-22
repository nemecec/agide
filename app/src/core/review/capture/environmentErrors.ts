/**
 * Output of a failed check that shows a problem of the environment, not of the code (0040 section 6). Such a run ends
 * `not_run` (rung C) and the code counts as untested, where `failed` would be sent back to the agent. A pattern that
 * names a word a test can print as well (a refused connection, a 403) counts only when the base run fails with the
 * same pattern (`needsBase`); until then the run stays a failure and is sent back. The table is data; add a pattern
 * with a test that shows what it matches and what it leaves alone.
 */

export type EnvironmentProblemKind = 'toolchain' | 'dependencies' | 'sandbox';

export interface EnvironmentPattern {
  readonly id: string;
  readonly kind: EnvironmentProblemKind;
  readonly pattern: RegExp;
  /** What the card says; it names the problem, not the output. */
  readonly reason: string;
  /** Set for a pattern that a test failure of the code can print: it ends the run `not_run` only when the base run fails with it too. */
  readonly needsBase?: true;
}

const toolchain = (id: string, pattern: RegExp): EnvironmentPattern => ({ id, kind: 'toolchain', pattern, reason: 'a program the check needs was not found' });
const dependencies = (id: string, pattern: RegExp): EnvironmentPattern => ({ id, kind: 'dependencies', pattern, reason: 'dependencies could not be fetched or the network is not available' });
const networkWord = (id: string, pattern: RegExp): EnvironmentPattern => ({ ...dependencies(id, pattern), needsBase: true });
const sandbox = (id: string, pattern: RegExp): EnvironmentPattern => ({ id, kind: 'sandbox', pattern, reason: 'the sandbox denied a file access of the check; the project needs more than the checkout, a temporary directory and the cache clones of its tools' });

export const ENVIRONMENT_PATTERNS: readonly EnvironmentPattern[] = [
  toolchain('rustup.no_version', /rustup could not choose a version/i),
  toolchain('command.not_found', /\bcommand not found\b/i),
  toolchain('shell.no_such_file', /(?:^|\n)\s*(?:[\w./-]*\/)?(?:sh|bash|zsh|env):[^\n]*(?:no such file or directory|not found)/i),
  toolchain('spawn.enoent', /\bspawn \S+ ENOENT\b/i),
  toolchain('exec.not_found', /executable file not found/i),
  toolchain('java.not_found', /unable to locate a java runtime|no 'java' command could be found|java_home is set to an invalid directory/i),
  toolchain('java.home_undefined', /java_home (?:environment )?(?:variable )?is not defined correctly|please set the java_home variable/i),
  toolchain('pyenv.version_missing', /pyenv: version [`'][^'\n]*' is not installed/i),
  toolchain('nvm.version_missing', /n\/a: version "?[^\n"]*"? is not yet installed/i),
  // Gradle and Maven name what they could not resolve; a bundler or a framework prints "Could not resolve" about the code too.
  dependencies('gradle.could_not_resolve', /could not resolve all (?:files|dependencies|artifacts) for configuration|could not resolve dependencies for project|could not resolve [\w.-]+:[\w.-]+:[\w.${}+-]+/i),
  dependencies('gradle.could_not_get', /could not get\s+['"]?https?:\/\//i),
  dependencies('proxy.connect_refused', /connect tunnel failed, response 40[13]|connection blocked by network allowlist|blocked-by-allowlist/i),
  networkWord('connection.refused', /connection refused|\bECONNREFUSED\b/i),
  networkWord('java.unknown_host', /\bUnknownHost/i),
  networkWord('dns.not_found', /\bENOTFOUND\b|\bEAI_AGAIN\b|temporary failure in name resolution/i),
  networkWord('network.unreachable', /network is unreachable/i),
  // A bare number is no evidence; the status has to be named as an HTTP answer.
  networkWord('http.denied_status', /\b(?:http|status|code|error|err)\b[^\n]{0,40}\b40[13]\b|\b40[13]\b[^\n]{0,20}\b(?:unauthorized|forbidden)\b/i),
  networkWord('proxy.denied_status', /\bproxy\b[^\n]{0,60}\b40[13]\b|\b40[13]\b[^\n]{0,60}\bproxy\b/i),
  networkWord('http.unauthorized', /\bunauthorized\b/i),
  networkWord('http.forbidden', /\bforbidden\b/i),
  sandbox('sandbox.eperm', /\bEPERM\b/i),
  sandbox('sandbox.erofs', /\bEROFS\b/i),
  sandbox('sandbox.not_permitted', /operation not permitted/i),
  sandbox('sandbox.read_only', /read-only file system/i),
];

const decides = (entry: EnvironmentPattern, confined: boolean): boolean => confined || entry.kind !== 'sandbox';

/** The first pattern that ends a failed run `not_run` on its own. Sandbox patterns count only when the check ran confined; `needsBase` patterns never count here. */
export function findEnvironmentProblem(output: string, options: { readonly confined: boolean; readonly patterns?: readonly EnvironmentPattern[] }): EnvironmentPattern | undefined {
  return (options.patterns ?? ENVIRONMENT_PATTERNS).find((entry) => entry.needsBase !== true && decides(entry, options.confined) && entry.pattern.test(output));
}

/** The first `needsBase` pattern in `output`: a possible environment problem that the base run has to confirm. */
export function findUnconfirmedProblem(output: string, patterns: readonly EnvironmentPattern[] = ENVIRONMENT_PATTERNS): EnvironmentPattern | undefined {
  return patterns.find((entry) => entry.needsBase === true && entry.pattern.test(output));
}

/**
 * What the card says: the problem, that the code was not tested, and where the evidence is. The text holds nothing
 * from the check: the reviewer reads this reason as the app's measurement, while the line that matched is in the end of
 * the output, which is shown and passed on as untrusted text.
 */
export function environmentNotRunReason(entry: EnvironmentPattern, options: { readonly sameOnBase?: boolean } = {}): string {
  const base = options.sameOnBase === true ? '; the base commit fails the same way' : '';
  return `${entry.reason} (${entry.id})${base}; the code was not tested; the end of the output shows what matched`;
}
