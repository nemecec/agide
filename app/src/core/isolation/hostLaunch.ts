import { accessSync, constants, existsSync, mkdirSync, realpathSync } from 'node:fs';
import { delimiter, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { IsolationError } from './types';

/**
 * Host-side starts of a sandbox: the sandbox runtime and everything that starts it (its shim, `node`, `env`, `which`)
 * run outside the sandbox with the rights of the app, in a directory that the agent or the checkpoint controls. A
 * program found there instead of the real one would run unconfined, and could end with status 0 for a failing check.
 * So nothing on the host side is looked up through anything the program controls: a relative or empty entry of PATH
 * resolves in the working directory after the directory change, and an entry below a directory of the program holds
 * its files.
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

/** A path and its resolved form: a directory below `/tmp` or `/var` is a link on macOS. */
function spellings(path: string): string[] {
  const plain = resolve(path);
  try {
    const real = realpathSync(plain);
    return real === plain ? [plain] : [plain, real];
  } catch {
    return [plain];
  }
}

function within(path: string, directory: string): boolean {
  const from = relative(directory, path);
  return from === '' || (from !== '..' && !from.startsWith(`..${sep}`) && !isAbsolute(from));
}

/** True when `path` is `directory` or lies below it, in any spelling of either. */
export function isWithinAny(path: string, directories: readonly string[]): boolean {
  const mine = spellings(path);
  return directories.some((directory) => spellings(directory).some((candidate) => mine.some((own) => within(own, candidate))));
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

/** The absolute file of a host-side program: looked up on the trusted entries of the app's PATH, or the path made absolute. Undefined when it is not executable or lies in `excluded`. */
export function locateHostBinary(binary: string, appPath: string | undefined, excluded: readonly string[] = []): string | undefined {
  const found = binary.includes('/') ? findExecutable(resolve(binary)) : findExecutable(binary, trustedPath(appPath, excluded));
  return found === undefined || isWithinAny(found, excluded) ? undefined : found;
}

export interface HostLaunch {
  /** The absolute file to spawn. */
  readonly file: string;
  /** The PATH of the spawned process: trusted entries only. */
  readonly path: string;
}

/**
 * The absolute sandbox runtime and the PATH its process gets, from the app's own PATH and not from the profile or the
 * checkout. `excluded` are the directories the sandboxed program controls.
 */
export function hostLaunch(binary: string, appPath: string | undefined, excluded: readonly string[]): HostLaunch {
  const file = locateHostBinary(binary, appPath, excluded);
  if (file === undefined) throw new IsolationError('failed', `the sandbox runtime (${binary}) was not found as an executable on the trusted PATH of the app (the absolute entries outside the directories that the program may write)`);
  return { file, path: trustedPath(appPath, excluded) };
}

/**
 * `/usr/bin/env` puts the profile's PATH back for the program inside the sandbox, which looks its own programs up
 * there, while the host-side process has the trusted PATH. A profile without PATH gets none.
 */
export function insideArgv(profilePath: string | undefined, argv: readonly string[]): string[] {
  return ['/usr/bin/env', ...(profilePath === undefined ? ['-u', 'PATH'] : [`PATH=${profilePath}`]), ...argv];
}

const EMPTY_DIRECTORY = '/var/empty';

/**
 * A working directory for the host-side process that no program of the checkpoint can write and that holds no
 * checkout: the sandbox starts the program in the directory it names, and the launcher changes into the checkout.
 * `/var/empty` is owned by root; a system without it gets a private empty directory below `fallbackRoot`.
 */
export function neutralDirectory(fallbackRoot: string, system: string = EMPTY_DIRECTORY): string {
  if (existsSync(system)) return system;
  const directory = join(fallbackRoot, '.cwd');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  return directory;
}
