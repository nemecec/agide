import { z } from 'zod';
import { CONTEXT_KEYS, SELECTION_DATA_MAX_BYTES, type ContextKey, type ContextValues, type WindowId } from '../blocks/context';
import type { BlocksEvent } from '../blocks/types';

const idValue = z.string().min(1).max(200);

const selectionObject = z
  .object({ kind: z.string().min(1).max(60), id: z.string().min(1).max(200), label: z.string().max(200), data: z.json().optional() })
  .strict()
  .refine((value) => value.data === undefined || Buffer.byteLength(JSON.stringify(value.data)) <= SELECTION_DATA_MAX_BYTES, {
    message: `data is at most ${SELECTION_DATA_MAX_BYTES} bytes as JSON`,
    path: ['data'],
  });

const VALUE_SCHEMAS: Record<ContextKey, z.ZodType> = {
  'node.current': idValue,
  'node.secondary': idValue,
  'surface.focused': idValue,
  'selection.object': selectionObject,
  'inbox.item.current': idValue,
  'window.layout': idValue,
};

export class ContextError extends Error {}

/** The shared context per window (0020 section 3). Changes emit `context.changed` with the key and the window. */
export class ContextStore {
  private readonly windows = new Map<WindowId, Map<ContextKey, unknown>>();

  constructor(private readonly emit: (event: BlocksEvent) => void) {}

  get<K extends ContextKey>(windowId: WindowId, key: K): ContextValues[K] | undefined {
    return this.windows.get(windowId)?.get(key) as ContextValues[K] | undefined;
  }

  all(windowId: WindowId): Partial<ContextValues> {
    return Object.fromEntries(this.windows.get(windowId) ?? []) as Partial<ContextValues>;
  }

  /** Throws `ContextError` for an unknown key or a value of the wrong shape. Emits only when the value changed. */
  set<K extends ContextKey>(windowId: WindowId, key: K, value: ContextValues[K]): void {
    if (!CONTEXT_KEYS.includes(key)) throw new ContextError(`unknown context key ${String(key)}; keys: ${CONTEXT_KEYS.join(', ')}`);
    const parsed = VALUE_SCHEMAS[key].safeParse(value);
    if (!parsed.success) throw new ContextError(`context ${key}: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`);
    const values = this.windows.get(windowId) ?? new Map<ContextKey, unknown>();
    this.windows.set(windowId, values);
    if (JSON.stringify(values.get(key)) === JSON.stringify(parsed.data)) return;
    values.set(key, parsed.data);
    this.emit({ type: 'context.changed', windowId, key });
  }

  clear(windowId: WindowId, key: ContextKey): void {
    if (this.windows.get(windowId)?.delete(key)) this.emit({ type: 'context.changed', windowId, key });
  }
}
