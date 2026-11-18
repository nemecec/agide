import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentFact } from '../../core/agents/index';
import { startAppModules, type AppModules } from '../appForTests';
import type { AgentsRuntime } from './agents';

let dir: string;
let app: AppModules;
const saved = { ...process.env };
const ui = { kind: 'ui' } as const;
const AT = '2026-11-17T10:00:00.000Z';

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'agents-module-'));
  delete process.env['CLAUDE_CONFIG_DIR'];
  delete process.env['AGIDE_PERMISSION_MODE'];
  app = await startAppModules({ dataDir: dir });
});
afterEach(async () => {
  await app.close();
  process.env = { ...saved };
  rmSync(dir, { recursive: true, force: true });
});

const call = (id: string, input: unknown = {}) => app.commands.invoke(id, input, ui);
const apply = (...facts: AgentFact[]) => facts.forEach((fact) => app.services.agents.store.apply(fact));
const ref = (agentKey: string, sessionId = 's1') => ({ sessionId, agentKey });
const started = (agentKey: string, extra: Partial<Extract<AgentFact, { kind: 'started' }>> = {}): AgentFact => ({ kind: 'started', ref: ref(agentKey), at: AT, description: `agent ${agentKey}`, ...extra });
const ended = (agentKey: string, outcome: 'completed' | 'failed'): AgentFact => ({ kind: 'ended', ref: ref(agentKey), at: '2026-11-17T10:05:00.000Z', outcome, basis: 'reported' });
const valueOf = async <T>(id: string, input: unknown = {}): Promise<T> => {
  const result = await call(id, input);
  if (!result.ok) throw new Error(`${id} failed: ${result.error.message}`);
  return result.value as T;
};
const errorOf = async (id: string, input: unknown): Promise<{ code: string; message: string } | undefined> => {
  const result = await call(id, input);
  return result.ok ? undefined : result.error;
};

describe('agents commands', () => {
  it('list the agents of every session with their state and the settings in force', async () => {
    apply(started('a1'), started('a2'));
    const { agents, settings } = await valueOf<{ agents: { agentKey: string; state: string }[]; settings: Record<string, number> }>('agents_list');
    expect(agents.map((agent) => agent.agentKey).sort(), 'agents').toEqual(['a1', 'a2']);
    expect(settings, 'settings').toHaveProperty('maxConcurrentAppStarted');
  });

  it('keep transcript paths out of the answers', async () => {
    apply(started('a1', { transcriptPath: 'projects/a1.jsonl' }));
    const { agents } = await valueOf<{ agents: object[] }>('agents_list');
    expect(JSON.stringify(agents), 'no path in the list').not.toContain('projects/a1.jsonl');
  });

  it('list finished agents in the history and filter by state', async () => {
    apply(started('a1'), started('a2'), ended('a1', 'completed'), ended('a2', 'failed'));
    const all = await valueOf<{ agents: { agentKey: string }[] }>('agents_history');
    expect(all.agents.map((agent) => agent.agentKey).sort(), 'both finished').toEqual(['a1', 'a2']);
    const failed = await valueOf<{ agents: { agentKey: string }[] }>('agents_history', { states: ['failed'] });
    expect(failed.agents.map((agent) => agent.agentKey), 'failed only').toEqual(['a2']);
  });

  it('dismiss and hold a node by its reference', async () => {
    apply(started('a1'), ended('a1', 'completed'));
    expect(await valueOf('agents_dismiss', ref('a1')), 'dismissed').toEqual({ dismissed: true });
    expect(await valueOf('agents_hold', { ...ref('a1'), held: true }), 'held').toEqual({ held: true });
    expect(await valueOf('agents_hold', { ...ref('a1'), held: false }), 'released').toEqual({ held: false });
  });

  it('refuse a reference without a session or an agent key', async () => {
    expect((await errorOf('agents_dismiss', { sessionId: '', agentKey: 'a' }))?.code, 'empty session').toBe('invalid_input');
    expect((await errorOf('agents_hold', { sessionId: 's1', agentKey: 'a' }))?.code, 'missing held flag').toBe('invalid_input');
  });

  it('answer that a transcript is unavailable when no file exists, with the summary the record has', async () => {
    apply(started('a1'), { kind: 'ended', ref: ref('a1'), at: AT, outcome: 'completed', basis: 'reported', summary: 'did the thing' });
    const transcript = await valueOf<{ available: boolean; summary: string | null; entries: unknown[] }>('agents_transcript', ref('a1'));
    expect(transcript, 'unavailable').toMatchObject({ available: false, summary: 'did the thing', entries: [] });
    expect(await valueOf('agents_transcript', ref('unknown')), 'unknown agent').toMatchObject({ available: false, summary: null });
  });

  it('refuse to read a transcript path outside the allowed directories', async () => {
    apply(started('a1', { transcriptPath: '/etc/hosts' }));
    expect(await valueOf('agents_transcript', ref('a1')), 'path outside the roots').toMatchObject({ available: false });
  });

  it('merge changed settings into the profile and answer the resolved settings', async () => {
    const resolved = await valueOf<{ removeDoneAfterSeconds: number; usage: { rateWindowMinutes: number } }>('agents_settings_set', { removeDoneAfterSeconds: 45 });
    expect(resolved.removeDoneAfterSeconds, 'new delay').toBe(45);
    const list = await valueOf<{ settings: { removeDoneAfterSeconds: number } }>('agents_list');
    expect(list.settings.removeDoneAfterSeconds, 'kept for the next list').toBe(45);
    const usageOnly = await valueOf<{ removeDoneAfterSeconds: number; usage: { alertUsdPerMinute: number } }>('agents_settings_set', { usage: { alertUsdPerMinute: 3 } });
    expect(usageOnly.usage.alertUsdPerMinute, 'usage threshold').toBe(3);
    expect(usageOnly.removeDoneAfterSeconds, 'earlier change kept').toBe(45);
  });

  it('refuse settings outside the schema', async () => {
    expect((await errorOf('agents_settings_set', { removeDoneAfterSeconds: -1 }))?.code, 'negative delay').toBe('invalid_input');
  });
});

describe('usage commands', () => {
  it('answer the usage state with the window, the ranking and the app-started count', async () => {
    const state = await valueOf<{ windowMinutes: number; ranking: unknown[]; appStarted: { running: number; cap: number } }>('usage_state');
    expect(state.windowMinutes, 'window').toBeGreaterThan(0);
    expect(state.ranking, 'empty ranking').toEqual([]);
    expect(state.appStarted, 'no app-started agents').toMatchObject({ running: 0 });
  });

  it('refuse to pause or stop a session that does not exist', async () => {
    expect((await errorOf('usage_pause', { sessionId: 'nope' }))?.code, 'pause').toBe('not_found');
    expect((await errorOf('usage_stop', { sessionId: 'nope' }))?.code, 'stop').toBe('not_found');
  });

  it('refuse an alert action for an item that is not a usage alert', async () => {
    expect((await errorOf('usage_alert_action', { itemId: 'missing', action: 'pause' }))?.code, 'unknown item').toBe('not_found');
    expect((await errorOf('usage_alert_action', { itemId: 'x', action: 'explode' }))?.code, 'unknown action').toBe('invalid_input');
  });

  it('do not offer the commands to agents', async () => {
    const result = await app.commands.invoke('usage_stop', { sessionId: 's1' }, { kind: 'mcp', sessionId: 's1', folderId: 'f1' });
    expect(result.ok, 'refused for an MCP caller').toBe(false);
  });
});

describe('app-started agents', () => {
  it('refuse a start at the cap and tell the user in the inbox', async () => {
    const { beginAppStarted } = app.services.agents as AgentsRuntime;
    const cap = (await valueOf<{ settings: { maxConcurrentAppStarted: number } }>('agents_list')).settings.maxConcurrentAppStarted;
    for (let index = 0; index < cap; index++) expect(beginAppStarted(`s${index}`, null, { description: 'x' }).ok, `start ${index}`).toBe(true);
    const refused = beginAppStarted('over', null);
    expect(refused.ok, 'refused at the cap').toBe(false);
    const items = app.services.inbox.list({});
    expect(items.some((item) => item.message.includes('An agent start was refused')), 'inbox alert').toBe(true);
  });
});
