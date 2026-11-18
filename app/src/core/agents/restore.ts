import type { AgentRecord, AgentStore } from './types';

/**
 * After an app restart no process of the old run is alive (0027 section 2): rows still `running` or `waiting` end,
 * as `completed` when the agent's metadata says it finished and as `lost` otherwise.
 */
export function repairAfterRestart(store: AgentStore, at: string, finished: (record: AgentRecord) => boolean): AgentRecord[] {
  const open = store.list({ states: ['running', 'waiting'] });
  for (const record of open) {
    store.apply({ kind: 'ended', ref: record.ref, at, outcome: finished(record) ? 'completed' : 'lost', basis: 'derived' });
  }
  return open;
}
