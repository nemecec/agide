import { useSyncExternalStore } from 'react';
import type { TreeNode } from '../../../core/tree/types';
import type { SwarmResults, SwarmStatus, SwarmSummary } from '../../../core/swarm/types';
import { api } from '../../api';
import { findAgent } from './swarmModel';

export interface SwarmsData {
  readonly swarms: readonly SwarmStatus[];
  /** Parent of each folder that holds a swarm, so a project folder can show the cap label. */
  readonly parents: Readonly<Record<string, string | null>>;
  readonly loaded: boolean;
}

const EMPTY: SwarmsData = { swarms: [], parents: {}, loaded: false };
const REFRESH_MS = 3000;

async function load(): Promise<SwarmsData | undefined> {
  const listed = await api().invoke<{ swarms: SwarmSummary[] }>('swarm_list', { limit: 100 });
  if (!listed.ok || !Array.isArray(listed.value.swarms)) return undefined;
  const statuses = await Promise.all(listed.value.swarms.map((summary) => api().invoke<SwarmStatus>('swarm_status', { swarmId: summary.id })));
  const swarms = statuses.flatMap((status) => (status.ok ? [status.value] : []));
  const parents: Record<string, string | null> = {};
  if (swarms.length > 0) {
    const tree = await api().invoke<{ nodes: TreeNode[] }>('ui_list_tree');
    if (tree.ok) {
      const byId = new Map(tree.value.nodes.map((node) => [node.id, node]));
      for (const swarm of swarms) parents[swarm.folderId] = byId.get(swarm.folderId)?.parentId ?? null;
    }
  }
  return { swarms, parents, loaded: true };
}

/**
 * One shared copy of the swarms for every row, pane and card in the window. It loads with the first subscriber,
 * again on every swarm event and on a timer (the spend moves between events), and stops with the last one.
 */
class SwarmFeed {
  private data: SwarmsData = EMPTY;
  private readonly listeners = new Set<() => void>();
  private off: (() => void) | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private ticket = 0;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1) this.start();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stop();
    };
  };

  readonly snapshot = (): SwarmsData => this.data;

  readonly reload = (): void => {
    const ticket = ++this.ticket;
    void load().then((next) => {
      if (ticket !== this.ticket || next === undefined) return;
      this.data = JSON.stringify(next) === JSON.stringify(this.data) ? this.data : next;
      this.listeners.forEach((listener) => listener());
    });
  };

  private start(): void {
    this.reload();
    this.off = api().subscribe((event) => {
      if (event.type.startsWith('swarm.')) this.reload();
    });
    this.timer = setInterval(this.reload, REFRESH_MS);
  }

  private stop(): void {
    this.off?.();
    this.off = undefined;
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    this.ticket++;
    this.data = EMPTY;
  }
}

let feed = new SwarmFeed();

/** For tests: a fresh feed, so one test's data and subscription do not reach the next. */
export function resetSwarmFeed(): void {
  feed = new SwarmFeed();
}

const subscribe = (listener: () => void): (() => void) => feed.subscribe(listener);
const snapshot = (): SwarmsData => feed.snapshot();

export function useSwarms(): SwarmsData & { readonly reload: () => void } {
  const data = useSyncExternalStore(subscribe, snapshot);
  return { ...data, reload: feed.reload };
}

export const useSwarmByFolder = (folderId: string): SwarmStatus | undefined => useSwarms().swarms.find((swarm) => swarm.folderId === folderId);
export const useSwarmById = (swarmId: string): { readonly swarm: SwarmStatus | undefined; readonly loaded: boolean } => {
  const { swarms, loaded } = useSwarms();
  return { swarm: swarms.find((swarm) => swarm.id === swarmId), loaded };
};
export const useSwarmAgent = (sessionId: string): ReturnType<typeof findAgent> => findAgent(useSwarms().swarms, sessionId);

/** Reads the results of a swarm once; the Results tab reloads it when the swarm changes. */
export async function fetchResults(swarmId: string): Promise<{ readonly results?: SwarmResults; readonly error?: string }> {
  const result = await api().invoke<SwarmResults>('swarm_results', { swarmId });
  return result.ok ? { results: result.value } : { error: result.error.message };
}

/** The swarms as last loaded, for code that is not a component, such as a menu builder. */
export const currentSwarms = (): readonly SwarmStatus[] => feed.snapshot().swarms;
