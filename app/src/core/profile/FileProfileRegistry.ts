import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, unlinkSync, watch, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import type { Unsubscribe } from '../events/EventBus';
import { ensureDir, readOwnRegularFile, writeFileAtomic } from './fsio';
import { rootPaths, registryFile } from './paths';
import { processLiveness, statusOf, type Liveness } from './registryStatus';
import { REGISTRY_MAX_BYTES, registryEntrySchema } from './schemas';
import type { ProfileId, ProfileRegistry, ProfileStatus, RegistryEntry } from './types';

export interface FileProfileRegistryOptions {
  readonly root: string;
  readonly profileId: ProfileId;
  readonly pid?: number;
  readonly liveness?: Liveness;
  /** Entries whose profile has no definition are dropped. Absent: every well-formed entry counts. */
  readonly isKnownProfile?: (id: ProfileId) => boolean;
  /** The own entry is written again at this interval so readers see it as fresh. Default 30 seconds. */
  readonly heartbeatMs?: number;
  /** Directory poll interval, since macOS watch events can coalesce. Default 5 seconds. */
  readonly pollMs?: number;
}

const DEBOUNCE_MS = 50;

/**
 * `ProfileRegistry` over `<root>/registry/<id>.json`. The own entry is replaced atomically; other entries are
 * read only after they pass the file checks and the schema. Nothing but liveness and the unread count is stored.
 */
export class FileProfileRegistry implements ProfileRegistry {
  readonly ownProfileId: ProfileId;
  private readonly dir: string;
  private readonly pid: number;
  private readonly instanceId = randomUUID();
  private readonly liveness: Liveness;
  private readonly listeners = new Set<(statuses: ProfileStatus[]) => void>();
  private readonly timers: NodeJS.Timeout[] = [];
  private watcher: FSWatcher | undefined;
  private debounce: NodeJS.Timeout | undefined;
  private lastUpdate: { readonly unread?: number | undefined } | undefined;
  private lastEmitted = '';

  constructor(private readonly options: FileProfileRegistryOptions) {
    this.ownProfileId = options.profileId;
    this.pid = options.pid ?? process.pid;
    this.liveness = options.liveness ?? processLiveness;
    this.dir = rootPaths(options.root).registry;
    ensureDir(this.dir);
    this.watcher = watch(this.dir, () => this.scheduleCheck());
    this.watcher.on('error', () => undefined);
    this.timers.push(setInterval(() => this.check(), options.pollMs ?? 5000));
    this.timers.push(
      setInterval(() => {
        if (this.lastUpdate) this.publish(this.lastUpdate);
      }, options.heartbeatMs ?? 30_000),
    );
    for (const timer of this.timers) timer.unref();
  }

  publish(update: { readonly unread?: number | undefined }): void {
    this.lastUpdate = update;
    const entry: RegistryEntry = {
      schema: 1,
      profileId: this.ownProfileId,
      pid: this.pid,
      instanceId: this.instanceId,
      updatedAt: this.liveness.now().toISOString(),
      ...(update.unread === undefined ? {} : { unread: update.unread }),
    };
    ensureDir(this.dir);
    writeFileAtomic(registryFile(this.options.root, this.ownProfileId), `${JSON.stringify(entry)}\n`);
  }

  withdraw(): void {
    this.lastUpdate = undefined;
    try {
      unlinkSync(registryFile(this.options.root, this.ownProfileId));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  statuses(): ProfileStatus[] {
    if (!existsSync(this.dir)) return [];
    const statuses: ProfileStatus[] = [];
    for (const name of readdirSync(this.dir)) {
      if (!name.endsWith('.json')) continue;
      const entry = this.readEntry(name);
      if (entry) statuses.push(statusOf(entry, this.liveness));
    }
    return statuses.sort((a, b) => a.profileId.localeCompare(b.profileId));
  }

  subscribe(listener: (statuses: ProfileStatus[]) => void): Unsubscribe {
    if (this.listeners.size === 0) this.lastEmitted = JSON.stringify(this.statuses());
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.watcher?.close();
    this.watcher = undefined;
    clearTimeout(this.debounce);
    for (const timer of this.timers) clearInterval(timer);
    this.timers.length = 0;
    this.listeners.clear();
  }

  private readEntry(fileName: string): RegistryEntry | undefined {
    const text = readOwnRegularFile(join(this.dir, fileName), { maxBytes: REGISTRY_MAX_BYTES });
    if (text === undefined) return undefined;
    let parsed;
    try {
      parsed = registryEntrySchema.safeParse(JSON.parse(text));
    } catch {
      return undefined;
    }
    if (!parsed.success || `${parsed.data.profileId}.json` !== fileName) return undefined;
    if (this.options.isKnownProfile && !this.options.isKnownProfile(parsed.data.profileId)) return undefined;
    return parsed.data as RegistryEntry;
  }

  private scheduleCheck(): void {
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => this.check(), DEBOUNCE_MS);
    this.debounce.unref();
  }

  /** Tells subscribers only when the visible statuses changed. */
  private check(): void {
    if (this.listeners.size === 0) return;
    const statuses = this.statuses();
    const key = JSON.stringify(statuses);
    if (key === this.lastEmitted) return;
    this.lastEmitted = key;
    for (const listener of this.listeners) listener(statuses);
  }
}
