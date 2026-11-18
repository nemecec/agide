import { useSyncExternalStore } from 'react';

/** Dialogs that float above the layout (0029). One shows at a time; opening another replaces it. */
export type DialogRequest =
  | { readonly kind: 'new-session'; readonly folderId: string }
  | { readonly kind: 'new-task'; readonly parentFolderId: string | null }
  | { readonly kind: 'settings' };

let current: DialogRequest | null = null;
const listeners = new Set<() => void>();

export function openDialog(request: DialogRequest): void {
  current = request;
  for (const listener of listeners) listener();
}

export function closeDialog(): void {
  if (current === null) return;
  current = null;
  for (const listener of listeners) listener();
}

export function currentDialog(): DialogRequest | null {
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useDialog(): DialogRequest | null {
  return useSyncExternalStore(subscribe, currentDialog);
}
