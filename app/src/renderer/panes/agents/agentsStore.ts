import { useSyncExternalStore } from 'react';

/** Small view state shared by the tree rows and the history and transcript panes. */
interface AgentsViewState {
  readonly showFinished: boolean;
  readonly selected: { readonly sessionId: string; readonly agentKey: string } | undefined;
}

let state: AgentsViewState = { showFinished: false, selected: undefined };
const listeners = new Set<() => void>();

export const getAgentsView = (): AgentsViewState => state;

export function setAgentsView(change: Partial<AgentsViewState>): void {
  state = { ...state, ...change };
  listeners.forEach((listener) => listener());
}

export function useAgentsView(): AgentsViewState {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, getAgentsView);
}
