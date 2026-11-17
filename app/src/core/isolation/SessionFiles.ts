import { chmodSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { IsolationError, type SessionFileName } from './types';

const SESSION_ID = /^[A-Za-z0-9_-]{1,64}$/;
const NAMES: readonly SessionFileName[] = ['mcp.json', 'settings.json'];

/**
 * Session files on the host: `<root>/<sessionId>/<name>`, directories 0700, files 0600, written to a
 * temporary name and renamed, so the CLI never reads a partial file.
 */
export class SessionFiles {
  constructor(readonly root: string) {}

  write(sessionId: string, name: SessionFileName, content: string): string {
    if (!SESSION_ID.test(sessionId)) throw new IsolationError('invalid', `session id ${sessionId} is not usable as a directory name`);
    if (!NAMES.includes(name)) throw new IsolationError('invalid', `${String(name)} is not a session file`);
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    chmodSync(this.root, 0o700);
    const dir = this.dirOf(sessionId);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
    const path = join(dir, name);
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

  private dirOf(sessionId: string): string {
    return join(this.root, sessionId);
  }
}
