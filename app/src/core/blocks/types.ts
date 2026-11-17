import type { Unsubscribe } from '../events/EventBus';
import type { ContextKey, WindowId } from './context';
import type { LayoutDocument, PaneInstance } from './layout';
import type { BlockManifest, PaneManifest } from './manifest';

/** Where a block comes from. Only `first-party` may use the block id `agide`. */
export type BlockOrigin = 'first-party' | 'local' | 'plugin';

export interface RegisteredBlock {
  readonly manifest: BlockManifest;
  readonly origin: BlockOrigin;
  readonly enabled: boolean;
}

export interface RegisteredPaneType {
  readonly blockId: string;
  readonly blockVersion: string;
  readonly origin: BlockOrigin;
  readonly enabled: boolean;
  readonly pane: PaneManifest;
}

/** Why an instance renders as `agide/placeholder` (0020 section 4). Its config stays as it was. */
export type PlaceholderReason = 'missing' | 'disabled' | 'version';

export type PaneResolution =
  | { readonly status: 'ok'; readonly paneType: RegisteredPaneType }
  | { readonly status: 'placeholder'; readonly reason: PlaceholderReason; readonly message: string };

export type BlockErrorCode = 'invalid' | 'exists' | 'reserved' | 'not_found';

export class BlockError extends Error {
  constructor(
    readonly code: BlockErrorCode,
    message: string,
    readonly issues?: readonly { readonly path: string; readonly message: string }[],
  ) {
    super(message);
    this.name = 'BlockError';
  }
}

/**
 * Block types by id, in the main process. Registration validates the manifest without running block code.
 * Layouts refer to pane types by id and resolve them here.
 */
export interface BlockRegistry {
  /** Validates and registers a manifest. Throws `invalid`, `exists` (block id or pane type taken) or `reserved`. */
  register(manifest: unknown, origin: BlockOrigin): Unsubscribe;
  list(): RegisteredBlock[];
  paneType(type: string): RegisteredPaneType | undefined;
  /** Every pane type, sorted by type id. */
  paneTypes(): RegisteredPaneType[];
  /** A disabled block's instances become placeholders. Throws `not_found`. */
  setEnabled(blockId: string, enabled: boolean): void;
  resolve(instance: Pick<PaneInstance, 'type' | 'version'>): PaneResolution;
  subscribe(listener: (event: BlocksEvent) => void): Unsubscribe;
}

/** What the layout module gives the other modules. Layout files, history and shared context come with the slice. */
export interface LayoutService {
  readonly blocks: BlockRegistry;
  /** A shipped preset or a layout of the profile. */
  get(layoutId: string): LayoutDocument | undefined;
  list(): { readonly id: string; readonly title: string }[];
}

/** Events of the block, layout and shared context modules. */
export type BlocksEvent =
  | { readonly type: 'blocks.changed'; readonly blockIds: readonly string[] }
  | { readonly type: 'layout.applied'; readonly layoutId: string; readonly revision: number }
  | { readonly type: 'context.changed'; readonly windowId: WindowId; readonly key: ContextKey };
