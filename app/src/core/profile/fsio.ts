import { randomBytes } from 'node:crypto';
import { chmodSync, closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

export const DIR_MODE = 0o700;
export const FILE_MODE = 0o600;

/** Creates the directory and its parents, then sets the mode of the last one: `mkdir` obeys the umask. */
export function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true, mode: DIR_MODE });
  chmodSync(path, DIR_MODE);
}

/** Writes a temporary file next to the target with mode 0600, syncs it and renames it over the target. */
export function writeFileAtomic(path: string, content: string): void {
  const tmp = join(dirname(path), `${basename(path)}.${randomBytes(6).toString('hex')}.tmp`);
  const fd = openSync(tmp, 'wx', FILE_MODE);
  try {
    writeSync(fd, content);
    fsyncSync(fd);
  } catch (error) {
    closeSync(fd);
    unlinkSync(tmp);
    throw error;
  }
  closeSync(fd);
  try {
    renameSync(tmp, path);
  } catch (error) {
    unlinkSync(tmp);
    throw error;
  }
}

export interface ReadLimits {
  readonly maxBytes: number;
}

/**
 * Reads a regular file of this user: a symbolic link, another uid, a larger file or a missing file gives
 * `undefined`. Other profiles' files are read this way, so the check happens before the content is used.
 */
export function readOwnRegularFile(path: string, limits: ReadLimits): string | undefined {
  let info;
  try {
    info = lstatSync(path);
  } catch {
    return undefined;
  }
  if (!info.isFile() || info.size > limits.maxBytes) return undefined;
  if (typeof process.getuid === 'function' && info.uid !== process.getuid()) return undefined;
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

/** Blocks the thread for a short time. Used before Electron's `ready`, where nothing else can run. */
export function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
