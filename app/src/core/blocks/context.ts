import type { NodeId } from '../tree/types';

/**
 * Shared context keys per window (0020 section 3). Keys hold references, never surface content.
 * Agents see context only through observation, filtered by their folder.
 */
export const CONTEXT_KEYS = ['node.current', 'node.secondary', 'surface.focused', 'selection.object', 'inbox.item.current', 'window.layout'] as const;

export type ContextKey = (typeof CONTEXT_KEYS)[number];

/** `data` is untrusted and at most `SELECTION_DATA_MAX_BYTES` as JSON. */
export interface SelectionObject {
  readonly kind: string;
  readonly id: string;
  readonly label: string;
  readonly data?: unknown;
}

export const SELECTION_DATA_MAX_BYTES = 32 * 1024;

export interface ContextValues {
  readonly 'node.current': NodeId;
  readonly 'node.secondary': NodeId;
  readonly 'surface.focused': string;
  readonly 'selection.object': SelectionObject;
  readonly 'inbox.item.current': string;
  readonly 'window.layout': string;
}

export type WindowId = string;
