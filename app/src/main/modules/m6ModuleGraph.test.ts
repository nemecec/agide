import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryHookEndpoint } from '../../core/hooks/index';
import { createViewHandlers } from '../../core/inbox/views/createViewHandlers';
import { createSummaryHandlers } from '../../core/summary/createSummaryHandlers';
import { startAppModules, type AppModules } from '../appForTests';
import * as askModule from './ask';
import * as inboxModule from './inbox';
import * as sessionModule from './session';

vi.mock('./session', async (original) => {
  const actual = await original<typeof import('./session')>();
  return { ...actual, init: vi.fn(actual.init) };
});
vi.mock('../../core/summary/createSummaryHandlers', async (original) => {
  const actual = await original<typeof import('../../core/summary/createSummaryHandlers')>();
  return { ...actual, createSummaryHandlers: vi.fn(actual.createSummaryHandlers) };
});
vi.mock('../../core/inbox/views/createViewHandlers', async (original) => {
  const actual = await original<typeof import('../../core/inbox/views/createViewHandlers')>();
  return { ...actual, createViewHandlers: vi.fn(actual.createViewHandlers) };
});
vi.mock('./inbox', async (original) => {
  const actual = await original<typeof import('./inbox')>();
  return { ...actual, init: vi.fn(actual.init) };
});
vi.mock('./ask', async (original) => {
  const actual = await original<typeof import('./ask')>();
  return { ...actual, init: vi.fn(actual.init) };
});

let dir: string;
let app: AppModules | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'm6-graph-'));
});
afterEach(async () => {
  await app?.close();
  app = undefined;
  rmSync(dir, { recursive: true, force: true });
});

const depsOf = (init: unknown): Record<string, unknown> => {
  const call = vi.mocked(init as (ctx: unknown, deps: Record<string, unknown>) => unknown).mock.calls.at(-1);
  return call?.[1] ?? {};
};

describe('the hook endpoint in the module graph', () => {
  it('reaches the session, inbox and ask modules through their deps, the same object the hooks module made', async () => {
    app = await startAppModules({ dataDir: dir });
    const endpoint = app.services.hooks;
    expect(endpoint, 'the hooks module holds an endpoint').toBeInstanceOf(InMemoryHookEndpoint);
    expect(depsOf(sessionModule.init)['hooks'], 'the session module receives the endpoint').toBe(endpoint);
    expect(depsOf(inboxModule.init)['hooks'], 'the inbox module receives the endpoint').toBe(endpoint);
    expect(depsOf(askModule.init)['hooks'], 'the ask module receives the endpoint').toBe(endpoint);
  });

  it('calls the contributor of the ask module on a UserPromptSubmit and gives it the notices queued for that session', async () => {
    app = await startAppModules({ dataDir: dir });
    const endpoint = app.services.hooks as InMemoryHookEndpoint;
    const delivered: string[] = [];
    app.services.delivery.enqueue({ recordId: 'a1', sessionId: 's7', noticeLine: 'n', contextLine: 'Ask a1 was answered.', onDelivered: (how) => delivered.push(how) });
    app.services.delivery.enqueue({ recordId: 'a2', sessionId: 's1', noticeLine: 'n', contextLine: 'Ask a2 was answered.', onDelivered: (how) => delivered.push(`other:${how}`) });
    const token = endpoint.grant('s7').token;
    const body = JSON.stringify({ session_id: 's7', hook_event_name: 'UserPromptSubmit', prompt: 'go on' });
    const result = await endpoint.receive({ sessionId: 's7', token, body });
    expect(result.reply, 'the reply carries the context line of the session').toEqual({
      hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'Ask a1 was answered.' },
    });
    expect(delivered, 'the notice of the session is reported as context and the notice of another session stays queued').toEqual(['context']);
    const again = await endpoint.receive({ sessionId: 's7', token, body });
    expect(again.reply, 'a taken notice is not given twice').toEqual({});
  });

  it('removes the contributor when the app closes', async () => {
    app = await startAppModules({ dataDir: dir });
    const endpoint = app.services.hooks as InMemoryHookEndpoint;
    const delivery = app.services.delivery;
    const token = endpoint.grant('s1').token;
    await app.close();
    app = undefined;
    delivery.enqueue({ recordId: 'a1', sessionId: 's1', noticeLine: 'n', contextLine: 'x', onDelivered: () => undefined });
    const result = await endpoint.receive({ sessionId: 's1', token, body: JSON.stringify({ session_id: 's1', hook_event_name: 'UserPromptSubmit' }) });
    expect(result.reply, 'a closed ask module adds nothing to the reply').toEqual({});
  });
});

describe('the handler factories of the inbox module', () => {
  it('gets the profile, the services and the database, so that the builders of views and summaries edit no module file', async () => {
    app = await startAppModules({ dataDir: dir });
    const summary = vi.mocked(createSummaryHandlers).mock.calls.at(-1)?.[0];
    expect(summary?.profile, 'the summarizer reads the profile for its config directory').toBe(app.services.profile);
    expect(summary?.sessions, 'the summarizer reads the sessions').toBe(app.services.sessions);
    expect(summary?.inbox, 'the summarizer reads the inbox').toBe(app.services.inbox);
    expect(summary?.tree, 'the summarizer reads the tree').toBe(app.services.tree);
    expect(summary?.db, 'the summarizer keeps its counters in the database').toBeDefined();
    const views = vi.mocked(createViewHandlers).mock.calls.at(-1)?.[0];
    expect(views?.inbox, 'the views read the inbox').toBe(app.services.inbox);
    expect(views?.tracker, 'the views reach the view tracker').toBeDefined();
  });
});
