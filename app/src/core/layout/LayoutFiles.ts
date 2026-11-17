import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, watch, writeFileSync, type FSWatcher } from 'node:fs';
import { join } from 'node:path';

const LAYOUT_FILE = /^([a-z][a-z0-9-]{0,63})\.json$/;

export const hashText = (text: string): string => createHash('sha256').update(text).digest('hex');

/** The layout files of one profile, `layouts/<id>.json`, and the file that names the window's layout. */
export class LayoutFiles {
  private watcher: FSWatcher | undefined;
  private timer: NodeJS.Timeout | undefined;
  private readonly pending = new Set<string>();

  constructor(
    readonly dir: string,
    private readonly windowFile: string,
  ) {
    mkdirSync(dir, { recursive: true });
  }

  path(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  ids(): string[] {
    return readdirSync(this.dir).flatMap((name) => LAYOUT_FILE.exec(name)?.[1] ?? []);
  }

  read(id: string): { text: string; hash: string } | undefined {
    try {
      const text = readFileSync(this.path(id), 'utf8');
      return { text, hash: hashText(text) };
    } catch {
      return undefined;
    }
  }

  /** Writes through a temporary name and a rename, so a reader never sees half a file. Returns the content hash. */
  write(id: string, document: unknown): string {
    const text = `${JSON.stringify(document, null, 2)}\n`;
    const temporary = join(this.dir, `.${id}.${process.pid}.tmp`);
    writeFileSync(temporary, text);
    renameSync(temporary, this.path(id));
    return hashText(text);
  }

  /** Keeps the original of a file that was migrated in memory, as `<id>.v<N>.json`, unless it exists already. */
  keepOriginal(id: string, version: number): void {
    const target = join(this.dir, `${id}.v${version}.json`);
    if (existsSync(this.path(id)) && !existsSync(target)) copyFileSync(this.path(id), target);
  }

  readWindowLayout(): string | undefined {
    try {
      const value = (JSON.parse(readFileSync(this.windowFile, 'utf8')) as { layoutId?: unknown }).layoutId;
      return typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value) ? value : undefined;
    } catch {
      return undefined;
    }
  }

  writeWindowLayout(layoutId: string): void {
    const temporary = `${this.windowFile}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify({ layoutId }));
    renameSync(temporary, this.windowFile);
  }

  remove(id: string): void {
    rmSync(this.path(id), { force: true });
  }

  /** Calls `onChange` with the layout id after a file of the directory changed; bursts of events become one call. */
  watch(onChange: (id: string) => void, debounceMs = 60): void {
    this.watcher = watch(this.dir, (_event, name) => {
      const id = name === null ? undefined : LAYOUT_FILE.exec(String(name))?.[1];
      if (id === undefined) return;
      this.pending.add(id);
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        const ids = [...this.pending];
        this.pending.clear();
        for (const changed of ids) onChange(changed);
      }, debounceMs);
    });
  }

  close(): void {
    clearTimeout(this.timer);
    this.watcher?.close();
    this.watcher = undefined;
  }
}
