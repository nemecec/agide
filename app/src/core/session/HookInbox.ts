import { mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { HOOK_FILE_SUFFIX } from './hooks';

/**
 * Reads the payload files that hook commands drop into a directory and delivers them as parsed JSON, oldest
 * first (by modification time, then name), deleting each file after the read. The directory is emptied when
 * the inbox is created, so payloads of an earlier process are not replayed. Files that are not valid JSON
 * are deleted without delivery.
 */
export class HookInbox {
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly dir: string,
    private readonly onRecord: (record: unknown) => void,
    intervalMs = 50,
  ) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.timer = setInterval(() => this.drain(), intervalMs);
    this.timer.unref();
  }

  /** Delivers the files that arrived since the last call. */
  drain(): void {
    let names: string[];
    try {
      names = readdirSync(this.dir).filter((name) => name.endsWith(HOOK_FILE_SUFFIX));
    } catch {
      return;
    }
    const files = names
      .map((name) => ({ name, mtime: mtimeOf(join(this.dir, name)) }))
      .sort((a, b) => (a.mtime === b.mtime ? a.name.localeCompare(b.name) : a.mtime < b.mtime ? -1 : 1));
    for (const { name } of files) {
      const path = join(this.dir, name);
      let text: string;
      try {
        text = readFileSync(path, 'utf8');
        rmSync(path, { force: true });
      } catch {
        continue;
      }
      this.deliver(text);
    }
  }

  /** Delivers the rest and stops. */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.drain();
  }

  /** Stops and removes the directory. */
  dispose(): void {
    this.stop();
    rmSync(this.dir, { recursive: true, force: true });
  }

  private deliver(text: string): void {
    if (!text.trim()) return;
    let record: unknown;
    try {
      record = JSON.parse(text);
    } catch {
      return;
    }
    this.onRecord(record);
  }
}

function mtimeOf(path: string): bigint {
  try {
    return statSync(path, { bigint: true }).mtimeNs;
  } catch {
    return 0n;
  }
}
