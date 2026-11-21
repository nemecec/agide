import { useSyncExternalStore } from 'react';

/** The small dialogs of the swarm UI that menus and buttons open: confirm a stop, send a message, show the definition. */
export type SwarmDialogRequest =
  | { readonly kind: 'stop-swarm'; readonly swarmId: string }
  | { readonly kind: 'stop-agent'; readonly swarmId: string; readonly agent: string }
  | { readonly kind: 'send'; readonly swarmId: string; readonly agent: string }
  | { readonly kind: 'definition'; readonly swarmId: string };

let current: SwarmDialogRequest | null = null;
const listeners = new Set<() => void>();
const emit = (): void => listeners.forEach((listener) => listener());

export function openSwarmDialog(request: SwarmDialogRequest): void {
  current = request;
  emit();
}

export function closeSwarmDialog(): void {
  if (current === null) return;
  current = null;
  emit();
}

export function useSwarmDialog(): SwarmDialogRequest | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
}
