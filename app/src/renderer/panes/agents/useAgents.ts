import { useSyncExternalStore } from 'react';
import type { AppEvent } from '../../../core/events/index';
import type { AgentNodeView } from '../../../core/agents/view';
import type { UsageState } from '../../../core/usage/types';
import { api } from '../../api';

export interface AgentsData {
  readonly agents: readonly AgentNodeView[];
  readonly waitingSessions: readonly string[];
  readonly settings: { readonly removeDoneAfterSeconds: number; readonly removeFailedAfterSeconds: number; readonly maxConcurrentAppStarted: number };
  /** Client time of the last load or clock tick. */
  readonly now: number;
}

const EMPTY: AgentsData = { agents: [], waitingSessions: [], settings: { removeDoneAfterSeconds: 10, removeFailedAfterSeconds: 300, maxConcurrentAppStarted: 4 }, now: 0 };

/**
 * One shared copy of a command's answer for every row and decoration in the window. It loads when the first
 * component subscribes, loads again on the named events and on a timer, and stops with the last subscriber.
 */
class SharedFeed<T> {
  private data: T;
  private readonly listeners = new Set<() => void>();
  private off: (() => void) | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private ticket = 0;

  constructor(
    private readonly initial: T,
    private readonly load: () => Promise<T | undefined>,
    private readonly reloadOn: (event: AppEvent) => boolean,
    private readonly everyMs: number,
    private readonly tick?: (data: T) => T,
  ) {
    this.data = initial;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1) this.start();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stop();
    };
  };

  readonly snapshot = (): T => this.data;

  readonly reload = (): void => {
    const ticket = ++this.ticket;
    void this.load().then((value) => {
      if (ticket !== this.ticket || value === undefined) return;
      this.data = value;
      this.listeners.forEach((listener) => listener());
    });
  };

  private start(): void {
    this.reload();
    this.off = api().subscribe((event) => {
      if (this.reloadOn(event)) this.reload();
    });
    this.timer = setInterval(() => {
      if (this.tick) {
        this.data = this.tick(this.data);
        this.listeners.forEach((listener) => listener());
      } else this.reload();
    }, this.everyMs);
  }

  private stop(): void {
    this.off?.();
    this.off = undefined;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.data = this.initial;
  }
}

const agentsFeed = (): SharedFeed<AgentsData> =>
  new SharedFeed<AgentsData>(
    EMPTY,
    async () => {
      const result = await api().invoke<{ agents: AgentNodeView[]; waitingSessions: string[]; settings: AgentsData['settings'] }>('agents_list', {});
      return result.ok ? { agents: result.value.agents, waitingSessions: result.value.waitingSessions, settings: result.value.settings, now: Date.now() } : undefined;
    },
    (event) => event.type === 'agents.changed',
    5000,
    // The clock moves elapsed times and the finished tally without a round trip.
    (data) => ({ ...data, now: Date.now() }),
  );

const usageFeed = (): SharedFeed<UsageState | undefined> =>
  new SharedFeed<UsageState | undefined>(
    undefined,
    async () => {
      const result = await api().invoke<UsageState>('usage_state', {});
      return result.ok ? result.value : undefined;
    },
    (event) => event.type === 'usage.changed',
    3000,
  );

let agents = agentsFeed();
let usage = usageFeed();

/** For tests: fresh feeds, so one test's data and subscriptions do not reach the next. */
export function resetAgentsFeeds(): void {
  agents = agentsFeed();
  usage = usageFeed();
}

export function useAgents(): AgentsData & { reload: () => void } {
  const data = useSyncExternalStore(agents.subscribe, agents.snapshot);
  return { ...data, now: data.now || Date.now(), reload: agents.reload };
}

export function useUsageState(): UsageState | undefined {
  return useSyncExternalStore(usage.subscribe, usage.snapshot);
}
