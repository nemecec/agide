/** What a swarm's cap check knows about the other app-started processes. */
export interface LiveCountInput {
  /** Agent records of app-started processes that run or wait. */
  readonly appStarted: readonly { readonly sessionId: string; readonly origin: string }[];
  /** True for a session that is an agent of a swarm; the manager counts those itself. */
  readonly isSwarmAgent: (sessionId: string) => boolean;
  /** Sessions that agents started with `task_start`. */
  readonly taskStartSessions: readonly string[];
  readonly statusOf: (sessionId: string) => string | undefined;
}

const isLive = (status: string | undefined): boolean => status !== undefined && status !== 'exited';

/** The processes that share the cap with a swarm's own agents: other app-started agents and live `task_start` sessions. */
export function countOtherLive(input: LiveCountInput): number {
  const others = input.appStarted.filter((record) => record.origin === 'app-started' && !input.isSwarmAgent(record.sessionId)).length;
  return others + input.taskStartSessions.filter((id) => isLive(input.statusOf(id))).length;
}
