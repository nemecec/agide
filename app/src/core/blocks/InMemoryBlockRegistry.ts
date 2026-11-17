import type { Unsubscribe } from '../events/EventBus';
import { blockManifestSchema, FIRST_PARTY_BLOCK_ID, type BlockManifest } from './manifest';
import {
  BlockError,
  type BlockOrigin,
  type BlockRegistry,
  type BlocksEvent,
  type PaneResolution,
  type RegisteredBlock,
  type RegisteredPaneType,
} from './types';
import { isValidRange, satisfiesRange } from './versionRange';

/** Reference implementation of `BlockRegistry`; the main process uses it as is unless a builder replaces it. */
export class InMemoryBlockRegistry implements BlockRegistry {
  private readonly blocks = new Map<string, { manifest: BlockManifest; origin: BlockOrigin; enabled: boolean }>();
  private readonly listeners = new Set<(event: BlocksEvent) => void>();

  register(raw: unknown, origin: BlockOrigin): Unsubscribe {
    const parsed = blockManifestSchema.safeParse(raw);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((issue) => ({ path: `/${issue.path.join('/')}`, message: issue.message }));
      throw new BlockError('invalid', `invalid block manifest: ${issues.map((i) => `${i.path} ${i.message}`).join('; ')}`, issues);
    }
    const manifest = parsed.data;
    if (manifest.id === FIRST_PARTY_BLOCK_ID && origin !== 'first-party') {
      throw new BlockError('reserved', `block id ${FIRST_PARTY_BLOCK_ID} is reserved for first-party blocks`);
    }
    if (this.blocks.has(manifest.id)) throw new BlockError('exists', `block ${manifest.id} is registered`);
    const taken = manifest.panes.find((pane) => this.paneType(pane.type));
    if (taken) throw new BlockError('exists', `pane type ${taken.type} is registered`);
    this.blocks.set(manifest.id, { manifest, origin, enabled: true });
    this.emit({ type: 'blocks.changed', blockIds: [manifest.id] });
    return () => {
      if (this.blocks.get(manifest.id)?.manifest === manifest && this.blocks.delete(manifest.id)) {
        this.emit({ type: 'blocks.changed', blockIds: [manifest.id] });
      }
    };
  }

  list(): RegisteredBlock[] {
    return [...this.blocks.values()].map((block) => ({ ...block }));
  }

  paneType(type: string): RegisteredPaneType | undefined {
    return this.paneTypes().find((entry) => entry.pane.type === type);
  }

  paneTypes(): RegisteredPaneType[] {
    return [...this.blocks.values()]
      .flatMap(({ manifest, origin, enabled }) =>
        manifest.panes.map((pane) => ({ blockId: manifest.id, blockVersion: manifest.version, origin, enabled, pane })),
      )
      .sort((a, b) => a.pane.type.localeCompare(b.pane.type));
  }

  setEnabled(blockId: string, enabled: boolean): void {
    const block = this.blocks.get(blockId);
    if (!block) throw new BlockError('not_found', `no block ${blockId}`);
    if (block.enabled === enabled) return;
    block.enabled = enabled;
    this.emit({ type: 'blocks.changed', blockIds: [blockId] });
  }

  resolve(instance: { readonly type: string; readonly version: string }): PaneResolution {
    const paneType = this.paneType(instance.type);
    if (!paneType) return { status: 'placeholder', reason: 'missing', message: `no block provides ${instance.type}` };
    if (!paneType.enabled) return { status: 'placeholder', reason: 'disabled', message: `block ${paneType.blockId} is disabled` };
    if (!isValidRange(instance.version) || !satisfiesRange(paneType.blockVersion, instance.version)) {
      return {
        status: 'placeholder',
        reason: 'version',
        message: `${instance.type} is version ${paneType.blockVersion}, the layout asks for ${instance.version}`,
      };
    }
    return { status: 'ok', paneType };
  }

  subscribe(listener: (event: BlocksEvent) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: BlocksEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
