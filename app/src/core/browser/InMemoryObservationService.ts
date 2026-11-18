import type { Caller } from '../commands/types';
import type { Unsubscribe } from '../events/EventBus';
import type { ObserveMode } from '../surfaces/types';
import { isBareOrigin } from './origin';
import { OBSERVATION_DEFAULT } from './services';
import {
  ObservationError,
  type BrowserEvent,
  type NewObservationLogEntry,
  type ObservationLogEntry,
  type ObservationService,
  type ServiceId,
} from './types';

/** Observation switches and access log in memory. The SQLite `observation_log` implementation passes the same contract. */
export class InMemoryObservationService implements ObservationService {
  private readonly surfaces = new Map<string, { service: ServiceId; mode?: ObserveMode }>();
  private readonly entries: ObservationLogEntry[] = [];
  private readonly listeners = new Set<(event: BrowserEvent) => void>();
  private nextId = 1;

  constructor(private readonly now: () => Date = () => new Date()) {}

  register(surfaceId: string, service: ServiceId): void {
    if (!this.surfaces.has(surfaceId)) this.surfaces.set(surfaceId, { service });
  }

  forget(surfaceId: string): void {
    this.surfaces.delete(surfaceId);
  }

  mode(surfaceId: string): ObserveMode {
    const surface = this.require(surfaceId);
    return surface.mode ?? OBSERVATION_DEFAULT[surface.service];
  }

  setMode(surfaceId: string, mode: ObserveMode, caller: Caller): void {
    if (caller.kind !== 'ui') throw new ObservationError('not_user', 'only the user changes what an agent may observe');
    const surface = this.require(surfaceId);
    if (this.mode(surfaceId) === mode) return;
    surface.mode = mode;
    this.emit({ type: 'browser.observation_changed', surfaceId, mode });
  }

  record(entry: NewObservationLogEntry): ObservationLogEntry {
    if (!isBareOrigin(entry.origin)) throw new ObservationError('invalid', 'the access log keeps the origin only, without path, query or fragment');
    if (!Number.isInteger(entry.bytes) || entry.bytes < 0) throw new ObservationError('invalid', 'bytes must be a whole number');
    const stored: ObservationLogEntry = { ...entry, id: this.nextId++, at: this.now().toISOString() };
    this.entries.push(stored);
    this.emit({ type: 'browser.accessed', entry: stored });
    return stored;
  }

  log(filter: { readonly nodeId?: string; readonly sessionId?: string; readonly limit?: number } = {}): ObservationLogEntry[] {
    return this.entries
      .filter((entry) => (filter.nodeId === undefined || entry.nodeId === filter.nodeId) && (filter.sessionId === undefined || entry.sessionId === filter.sessionId))
      .reverse()
      .slice(0, filter.limit ?? 100);
  }

  prune(before: Date): number {
    const keep = this.entries.filter((entry) => new Date(entry.at) >= before);
    const removed = this.entries.length - keep.length;
    this.entries.splice(0, this.entries.length, ...keep);
    return removed;
  }

  subscribe(listener: (event: BrowserEvent) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private require(surfaceId: string): { service: ServiceId; mode?: ObserveMode } {
    const surface = this.surfaces.get(surfaceId);
    if (!surface) throw new ObservationError('not_found', `surface ${surfaceId} is not a recorded browser surface`);
    return surface;
  }

  private emit(event: BrowserEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
