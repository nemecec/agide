import { describe, expect, it } from 'vitest';
import { countOtherLive, type LiveCountInput } from './liveCount';

const input = (overrides: Partial<LiveCountInput>): LiveCountInput => ({
  appStarted: [],
  isSwarmAgent: () => false,
  taskStartSessions: [],
  statusOf: () => 'running',
  ...overrides,
});

describe('countOtherLive', () => {
  it('counts nothing when no other process runs', () => {
    expect(countOtherLive(input({})), 'an empty profile').toBe(0);
  });

  it('counts app-started agent records and leaves out session-started ones', () => {
    const appStarted = [
      { sessionId: 'a', origin: 'app-started' },
      { sessionId: 'b', origin: 'session-started' },
    ];
    expect(countOtherLive(input({ appStarted })), 'only the app-started record holds a slot').toBe(1);
  });

  it('leaves out the agents of swarms, which the manager counts itself', () => {
    const appStarted = [
      { sessionId: 'swarm-agent', origin: 'app-started' },
      { sessionId: 'other', origin: 'app-started' },
    ];
    expect(countOtherLive(input({ appStarted, isSwarmAgent: (id) => id === 'swarm-agent' })), 'a swarm agent is not counted twice').toBe(1);
  });

  it('counts a task-start session while it lives and not once it exited or is unknown', () => {
    const statuses: Record<string, string> = { live: 'running', waiting: 'waiting', gone: 'exited' };
    expect(countOtherLive(input({ taskStartSessions: ['live', 'waiting', 'gone', 'unknown'], statusOf: (id) => statuses[id] })), 'running and waiting sessions hold a slot').toBe(2);
  });

  it('adds both kinds', () => {
    expect(countOtherLive(input({ appStarted: [{ sessionId: 'a', origin: 'app-started' }], taskStartSessions: ['t'] })), 'one of each').toBe(2);
  });
});
