import { accessSync, constants, realpathSync } from 'node:fs';
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/**
 * The path primitives of the host side (`hostTools.ts` builds on them): the sandbox runtime and everything that starts
 * it (its shim, `node`, `env`, `which`) run outside the sandbox with the rights of the app. A program found in a
 * directory that the agent or the checkpoint controls instead of the real one would run unconfined, and could end with
 * status 0 for a failing check. So nothing on the host side is looked up through anything the program controls: a
 * relative or empty entry of PATH resolves in the working directory after the directory change, and an entry below a
 * directory of the program holds its files.
 */

function executable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** The file a command name resolves to, or the path itself when it has a directory part. */
export function findExecutable(name: string, pathVariable: string | undefined = process.env['PATH']): string | undefined {
  if (name.includes('/')) return executable(name) ? name : undefined;
  return (pathVariable ?? '')
    .split(delimiter)
    .filter(Boolean)
    .map((dir) => join(dir, name))
    .find(executable);
}

/**
 * The deepest existing ancestor of `path` in its native spelling, with the missing rest appended. The native form keeps
 * the letter case the volume stores: on the default case-insensitive APFS volume `BIN` and `bin` are one directory,
 * and `realpathSync` (the JavaScript version) keeps the case it is given.
 */
function nativePath(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    const parent = dirname(path);
    return parent === path ? path : join(nativePath(parent), relative(parent, path));
  }
}

/** Where macOS mounts the data volume; `/Users`, `/private`, `/opt`, `/usr/local` and the other firmlinks of `/usr/share/firmlinks` lead to it. */
const DATA_VOLUME = '/System/Volumes/Data';

/**
 * A path and its resolved form: a directory below `/tmp` or `/var` is a link on macOS, and the volume may ignore case.
 * A path through the data volume (`/System/Volumes/Data/Users/...`) is a firmlink that `realpathSync.native` keeps as
 * it is, so the spelling without that prefix is added: both sides of a comparison then share one.
 */
function spellings(path: string): string[] {
  const plain = resolve(path);
  return [...new Set([plain, ...realForms(plain)])];
}

/** Where `path` lies now: its native real path (links resolved, the missing rest appended), and that path without the prefix of the data volume. `path` is absolute. */
export function realForms(path: string): string[] {
  const native = nativePath(path);
  return native.startsWith(`${DATA_VOLUME}/`) ? [native, native.slice(DATA_VOLUME.length)] : [native];
}

/** True when the normalized absolute `path` is `directory` or lies below it, compared as text. */
export function contains(directory: string, path: string): boolean {
  return path === directory || path.startsWith(directory.endsWith(sep) ? directory : `${directory}${sep}`);
}

let tick: Map<string, readonly string[]> | undefined;

/**
 * The spellings of a directory of an excluded set, computed once per turn of the event loop: one lookup compares many
 * candidates and PATH entries against the same set, and a set of a few hundred directories would otherwise cost a
 * real path for every directory at every comparison. The next turn computes them again, so a directory that was
 * replaced by a link is compared by what it is at the next lookup.
 */
function directorySpellings(directory: string): readonly string[] {
  if (tick === undefined) {
    tick = new Map();
    queueMicrotask(() => {
      tick = undefined;
    });
  }
  let forms = tick.get(directory);
  if (forms === undefined) {
    forms = spellings(directory);
    tick.set(directory, forms);
  }
  return forms;
}

/** True when `path` is `directory` or lies below it, in any spelling of either. */
export function isWithinAny(path: string, directories: readonly string[]): boolean {
  const mine = spellings(path);
  return directories.some((directory) => directorySpellings(directory).some((candidate) => mine.some((own) => contains(candidate, own))));
}

/**
 * The entries of `pathVariable` that a host-side lookup may use: absolute and outside `excluded`. A relative entry
 * (`bin`, `.`) and an empty one (a leading, trailing or double colon, which means the working directory) are not
 * absolute and are dropped.
 */
export function trustedPath(pathVariable: string | undefined, excluded: readonly string[] = []): string {
  const entries = (pathVariable ?? '').split(delimiter).filter((entry) => isAbsolute(entry) && !isWithinAny(entry, excluded));
  return [...new Set(entries)].join(delimiter);
}

/**
 * The only variables the host-side process of `srt` has besides its PATH and the carriers of `insideRoute`. The process
 * is `/bin/sh` (bash in sh mode on macOS) running the shim of `srt`, which starts Node: bash imports exported functions
 * (`BASH_FUNC_*`) and expands `PS4` under `SHELLOPTS`, Node reads `NODE_OPTIONS`, the loader reads `DYLD_*`, and a shell
 * may read `ENV`, `BASH_ENV`, `CDPATH` and `IFS`, all before or while the program runs outside the sandbox. A list of
 * what may stay is the safe form, since a new variable of that kind is not on it. These stay: the identity and the
 * locale of the user, the temporary directory, and the names that `srt` 0.0.83 reads (`SRT_*`, `CLAUDE_CODE_TMPDIR`,
 * `CLAUDE_TMPDIR`) or composes with before it sets them for the program (the proxy variables, the trust-store variables,
 * `JAVA_TOOL_OPTIONS`, the `GIT_*` variables it extends); the program inherits them from `srt`, which sets or extends
 * them. Every other variable of the profile, its PATH included, reaches the program through `insideRoute`.
 */
const HOST_SIDE_NAMES: ReadonlySet<string> = new Set([
  'HOME', 'USER', 'LOGNAME', 'TMPDIR', 'LANG', 'LANGUAGE', 'TERM',
  'CLAUDE_CODE_TMPDIR', 'CLAUDE_TMPDIR', 'SANDBOX_RUNTIME',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'ALL_PROXY', 'GRPC_PROXY', 'http_proxy', 'https_proxy', 'no_proxy', 'all_proxy', 'grpc_proxy',
  'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'CURL_CA_BUNDLE', 'REQUESTS_CA_BUNDLE', 'PIP_CERT', 'GIT_SSL_CAINFO', 'AWS_CA_BUNDLE', 'CARGO_HTTP_CAINFO', 'DENO_CERT', 'CLOUDSDK_CORE_CUSTOM_CA_CERTS_FILE', 'NIX_SSL_CERT_FILE',
  'JAVA_TOOL_OPTIONS', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_PARAMETERS', 'GIT_SSH_COMMAND', 'SRT_SSH_PROXY_COMMAND',
]);
const HOST_SIDE_PREFIXES: readonly string[] = ['LC_', 'SRT_', 'GIT_CONFIG_KEY_', 'GIT_CONFIG_VALUE_'];

export const isHostSideVariable = (name: string): boolean => HOST_SIDE_NAMES.has(name) || HOST_SIDE_PREFIXES.some((prefix) => name.startsWith(prefix));

/** The variables of `env` the host-side process of `srt` keeps, and all the others, the PATH of the profile included, which go to the program inside the sandbox. The caller gives the host side its own PATH. */
export function splitHostVariables(env: Readonly<Record<string, string>>): { readonly host: Record<string, string>; readonly inside: Record<string, string> } {
  const host: Record<string, string> = {};
  const inside: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) (isHostSideVariable(name) ? host : inside)[name] = value;
  return { host, inside };
}

/** The prefix of the variables that carry a value of the profile through the host-side processes to the program inside the sandbox. No shell, Node, the loader or `srt` reads a name that starts with it. */
export const INSIDE_PREFIX = 'AGIDE_INSIDE_';
/** The one argument of the route: the names of the carried variables, never a value. */
export const INSIDE_NAMES_ARGUMENT = 'AGIDE_INSIDE_NAMES=';

const SHELL_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
/**
 * Names that the launcher shell inside the sandbox (bash 3.2 in sh mode) cannot export with the value it is given: it
 * refuses them as read-only, or it sets or computes them itself. Measured on macOS by exporting each through the
 * route and reading it back in the program; bash 4 adds `BASHOPTS` and `BASHPID`.
 */
const SHELL_OWN_NAMES: ReadonlySet<string> = new Set([
  '_', 'BASH_ARGC', 'BASH_ARGV', 'BASH_COMMAND', 'BASH_LINENO', 'BASH_SOURCE', 'BASH_SUBSHELL', 'BASH_VERSINFO', 'BASHOPTS', 'BASHPID',
  'DIRSTACK', 'EUID', 'FUNCNAME', 'GROUPS', 'HISTCMD', 'LINENO', 'OPTIND', 'PPID', 'RANDOM', 'SECONDS', 'SHELLOPTS', 'SHLVL', 'UID',
]);

export interface InsideRoute {
  /** `AGIDE_INSIDE_<name>` for each passed variable, with its value: part of the environment of the host-side process. */
  readonly carriers: Record<string, string>;
  /** The names that the launcher inside the sandbox sets from their carriers. */
  readonly names: readonly string[];
  /** Names that do not reach the program: not a name a shell can set, one that the shell sets itself, one of the route's own, or on macOS a `DYLD_` name. */
  readonly dropped: readonly string[];
}

/**
 * How the variables of the profile reach the program inside the sandbox without being an argument of any process.
 * On macOS every local account can read the arguments of a process (`ps -axww`), and only the user and root can
 * read its environment, so a value goes into the environment of the host-side process under a name with
 * `INSIDE_PREFIX`, which nothing on the host side reads, and the launcher inside the sandbox (`insideArgv`,
 * `launcherArgv` in `statusLauncher.ts`) exports it under its own name and removes the carrier. Only the list of
 * names is an argument.
 */
export function insideRoute(inside: Readonly<Record<string, string>>, platform: NodeJS.Platform = process.platform): InsideRoute {
  const carriers: Record<string, string> = {};
  const names: string[] = [];
  const dropped: string[] = [];
  for (const [name, value] of Object.entries(inside)) {
    // macOS removes the `DYLD_` variables when it starts a protected program: the launcher starts the program through `/usr/bin/env`, and `srt` runs `sandbox-exec`.
    if (!SHELL_NAME.test(name) || SHELL_OWN_NAMES.has(name) || name.startsWith('AGIDE_INSIDE') || (platform === 'darwin' && name.startsWith('DYLD_'))) dropped.push(name);
    else {
      carriers[`${INSIDE_PREFIX}${name}`] = value;
      names.push(name);
    }
  }
  return { carriers, names, dropped };
}
