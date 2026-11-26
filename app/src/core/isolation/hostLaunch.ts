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

/** A path and its resolved form: a directory below `/tmp` or `/var` is a link on macOS, and the volume may ignore case. */
function spellings(path: string): string[] {
  const plain = resolve(path);
  const real = nativePath(plain);
  return real === plain ? [plain] : [plain, real];
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

/**
 * `/usr/bin/env` puts the profile's PATH back for the program inside the sandbox, which looks its own programs up
 * there, while the host-side process has the trusted PATH. A profile without PATH gets none. `inside` are the
 * variables that change how a program starts (`isLoaderVariable`): the host-side process must not have them, the
 * program does.
 */
export function insideArgv(profilePath: string | undefined, argv: readonly string[], inside: Readonly<Record<string, string>> = {}): string[] {
  const assignments = Object.entries(inside).map(([name, value]) => `${name}=${value}`);
  return ['/usr/bin/env', ...(profilePath === undefined ? ['-u', 'PATH'] : [`PATH=${profilePath}`]), ...assignments, ...argv];
}

/**
 * The variables that make Node or the dynamic loader start extra code, or look it up, before the program runs: a
 * relative value resolves in the working directory of the process that has it.
 */
export const isLoaderVariable = (name: string): boolean => name === 'NODE_OPTIONS' || name === 'NODE_PATH' || name.startsWith('DYLD_') || name.startsWith('LD_');

/** `env` without the loader variables, and those variables on their own. */
export function splitLoaderVariables(env: Readonly<Record<string, string>>): { readonly host: Record<string, string>; readonly inside: Record<string, string> } {
  const host: Record<string, string> = {};
  const inside: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) (isLoaderVariable(name) ? inside : host)[name] = value;
  return { host, inside };
}
