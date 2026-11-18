import { describe, expect, it } from 'vitest';
import { historyOf, summarise, toView, withoutPaths, type AgentNodeView } from './view';
import type { AgentRecord } from './types';

const NOW = Date.parse('2026-11-17T10:10:00.000Z');
const view = (over: Partial<AgentNodeView>): AgentNodeView => ({
  sessionId: 's',
  agentKey: 'a',
  origin: 'session-started',
  state: 'done',
  label: 'agent',
  hasTranscript: true,
  tokens: { input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 },
  startedAt: '2026-11-17T10:00:00.000Z',
  hidden: false,
  ...over,
});

describe('summarise', () => {
  it('counts running, waiting and failed agents apart, and agents that finished in the last minute', () => {
    const summary = summarise(
      [
        view({ state: 'running' }),
        view({ state: 'waiting' }),
        view({ state: 'done', endedAt: '2026-11-17T10:09:30.000Z' }),
        view({ state: 'failed', endedAt: '2026-11-17T10:09:05.000Z' }),
        view({ state: 'done', endedAt: '2026-11-17T10:05:00.000Z' }),
      ],
      NOW,
    );
    expect(summary, 'running excludes the waiting agent, the failed agent has its own count').toEqual({ running: 1, waiting: 1, failed: 1, finishedRecently: 1 });
  });

  it('keeps counting a failed agent whose node is still shown, and drops one that ended long ago and is hidden', () => {
    const summary = summarise(
      [
        view({ state: 'failed', endedAt: '2026-11-17T10:00:00.000Z', hidden: false }),
        view({ state: 'failed', endedAt: '2026-11-17T10:01:00.000Z', hidden: true }),
      ],
      NOW,
    );
    expect(summary.failed, 'only the failed agent that is still in the tree').toBe(1);
  });
});

describe('historyOf', () => {
  const rows = [
    view({ agentKey: 'a', state: 'done', endedAt: '2026-11-17T10:01:00.000Z', folderId: 'f1', label: 'Read files' }),
    view({ agentKey: 'b', state: 'failed', endedAt: '2026-11-17T10:05:00.000Z', folderId: 'f2', label: 'Run tests', origin: 'app-started' }),
    view({ agentKey: 'c', state: 'running', folderId: 'f1' }),
  ];

  it('lists only finished agents, newest end first', () => {
    expect(historyOf(rows).map((r) => r.agentKey), 'order').toEqual(['b', 'a']);
  });

  it('filters by state, origin, folder, end time and text', () => {
    expect(historyOf(rows, { states: ['failed'] }).map((r) => r.agentKey), 'state').toEqual(['b']);
    expect(historyOf(rows, { origin: 'app-started' }).map((r) => r.agentKey), 'origin').toEqual(['b']);
    expect(historyOf(rows, { folderIds: ['f1'] }).map((r) => r.agentKey), 'folder').toEqual(['a']);
    expect(historyOf(rows, { endedSince: '2026-11-17T10:03:00.000Z' }).map((r) => r.agentKey), 'time range').toEqual(['b']);
    expect(historyOf(rows, { text: 'READ' }).map((r) => r.agentKey), 'text, case-insensitive').toEqual(['a']);
  });
});

describe('toView', () => {
  it('labels with the description, then the type, then the key, and carries the hidden flag', () => {
    const record = (over: Partial<AgentRecord>): AgentRecord => ({ ref: { sessionId: 's', agentKey: 'k' }, origin: 'session-started', state: 'running', openRequests: [], tokens: view({}).tokens, startedAt: 't', updatedAt: 't', ...over });
    expect(toView(record({ description: 'd', agentType: 't' }), { hidden: false }).label, 'description').toBe('d');
    expect(toView(record({ agentType: 't' }), { hidden: false }).label, 'type').toBe('t');
    expect(toView(record({}), { hidden: true }), 'key and hidden').toMatchObject({ label: 'k', hidden: true });
  });
});

describe('withoutPaths', () => {
  it('drops the transcript path and keeps every other field', () => {
    expect(withoutPaths({ id: 'a', transcriptPath: 'projects/x.jsonl', state: 'done' }), 'path removed').toEqual({ id: 'a', state: 'done' });
  });

  it('leaves a record without a path as it is', () => {
    expect(withoutPaths({ id: 'a', transcriptPath: undefined }), 'no path').toEqual({ id: 'a' });
  });
});
