import { chmodSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { IsolationError, SESSION_FILE_NAMES, type SessionFileName } from './types';

const SESSION_ID = /^[A-Za-z0-9_-]{1,64}$/;
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const NAMES = SESSION_FILE_NAMES;

/**
 * Session files on the host: `<root>/<sessionId>/<name>`, directories 0700, files 0600, written to a
 * temporary name and renamed, so the CLI never reads a partial file.
 */
export class SessionFiles {
  constructor(readonly root: string) {}

  write(sessionId: string, name: SessionFileName, content: string): string {
    if (!NAMES.includes(name)) throw new IsolationError('invalid', `${String(name)} is not a session file`);
    return this.writePrivate(sessionId, name, content);
  }

  /** Writes a file of a provider's own, such as a generated sandbox configuration, with the same modes and atomic rename. */
  writePrivate(sessionId: string, fileName: string, content: string): string {
    if (!SESSION_ID.test(sessionId)) throw new IsolationError('invalid', `session id ${sessionId} is not usable as a directory name`);
    if (!FILE_NAME.test(fileName)) throw new IsolationError('invalid', `${fileName} is not usable as a file name`);
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    chmodSync(this.root, 0o700);
    const dir = this.dirOf(sessionId);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
    const path = join(dir, fileName);
    const temporary = `${path}.${randomBytes(6).toString('hex')}.tmp`;
    writeFileSync(temporary, content, { mode: 0o600, flag: 'wx' });
    renameSync(temporary, path);
    return path;
  }

  /** Removes one file of a session, for a file the CLI reads once at start. */
  removeFile(sessionId: string, name: SessionFileName): void {
    if (SESSION_ID.test(sessionId) && NAMES.includes(name)) rmSync(join(this.dirOf(sessionId), name), { force: true });
  }

  /** Removes every session directory. A process that crashed leaves them, and no session runs when the app starts. */
  removeAll(): void {
    let names: string[];
    try {
      names = readdirSync(this.root);
    } catch {
      return;
    }
    for (const name of names) rmSync(join(this.root, name), { recursive: true, force: true });
  }

  remove(sessionId: string): void {
    if (SESSION_ID.test(sessionId)) rmSync(this.dirOf(sessionId), { recursive: true, force: true });
  }

  dirOf(sessionId: string): string {
    return join(this.root, sessionId);
  }
}
