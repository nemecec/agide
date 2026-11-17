import { randomUUID } from 'node:crypto';
import type { Unsubscribe } from '../events/EventBus';
import { processLiveness, statusOf, type Liveness } from './registryStatus';
import type { ProfileId, ProfileRegistry, ProfileStatus, RegistryEntry } from './types';

/** Shared state of in-memory registries, standing in for the `registry/` directory. */
export class InMemoryRegistryHub {
  readonly entries = new Map<ProfileId, RegistryEntry>();
  private readonly listeners = new Set<() => void>();

  changed(): void {
    for (const listener of this.listeners) listener();
  }

  watch(listener: () => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export interface InMemoryProfileRegistryOptions {
  readonly profileId: ProfileId;
  readonly pid?: number;
  readonly liveness?: Liveness;
}

/** Reference implementation of `ProfileRegistry`. Registries on one hub see each other's entries. */
export class InMemoryProfileRegistry implements ProfileRegistry {
  readonly ownProfileId: ProfileId;
  private readonly pid: number;
  private readonly instanceId = randomUUID();
  private readonly liveness: Liveness;
  private readonly unwatch: Unsubscribe;
  private readonly listeners = new Set<(statuses: ProfileStatus[]) => void>();

  constructor(
    private readonly hub: InMemoryRegistryHub,
    options: InMemoryProfileRegistryOptions,
  ) {
    this.ownProfileId = options.profileId;
    this.pid = options.pid ?? process.pid;
    this.liveness = options.liveness ?? processLiveness;
    this.unwatch = hub.watch(() => {
      const statuses = this.statuses();
      for (const listener of this.listeners) listener(statuses);
    });
  }

  publish(update: { readonly unread?: number | undefined }): void {
    const entry: RegistryEntry = {
      schema: 1,
      profileId: this.ownProfileId,
      pid: this.pid,
      instanceId: this.instanceId,
      updatedAt: this.liveness.now().toISOString(),
      ...(update.unread === undefined ? {} : { unread: update.unread }),
    };
    this.hub.entries.set(this.ownProfileId, entry);
    this.hub.changed();
  }

  withdraw(): void {
    if (this.hub.entries.delete(this.ownProfileId)) this.hub.changed();
  }

  statuses(): ProfileStatus[] {
    return [...this.hub.entries.values()]
      .map((entry) => statusOf(entry, this.liveness))
      .sort((a, b) => a.profileId.localeCompare(b.profileId));
  }

  subscribe(listener: (statuses: ProfileStatus[]) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.unwatch();
    this.listeners.clear();
  }
}
