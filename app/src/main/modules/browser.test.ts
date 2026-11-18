import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeCdp, sampleDescribeNode, samplePageTree } from '../../core/browser/fakeCdp';
import { PageSession } from '../../core/browser/PageSession';
import type { TabEvent, TabInfo } from '../../core/browser/runtime';
import type { BrowserTabState } from '../../core/browser/types';
import { CommandRegistry } from '../../core/commands/index';
import { createAppEventBus, type AppEvent } from '../../core/events/index';
import { LaunchContributors } from '../../core/session/index';
import { InMemoryTreeService } from '../../core/tree/index';
import { openStore } from '../../core/store/index';
import type { BrowserViews, ViewStill } from '../browser/views';
import { initModules, type InitializedModules } from '../modules';
import * as browserModule from './browser';

class FakeViews implements BrowserViews {
  readonly pages = new Map<string, { cdp: FakeCdp; page: PageSession }>();
  readonly infos = new Map<string, TabInfo>();
  readonly placed = new Map<string, { visible: boolean; bounds: object }>();
  readonly listeners = new Set<(event: TabEvent) => void>();
  readonly destroyed: string[] = [];
  readonly loads: string[] = [];
  suspended = false;
  states: (leafId: string) => BrowserTabState | undefined = () => undefined;
  setStateSource(source: (leafId: string) => BrowserTabState | undefined): void {
    this.states = source;
  }
  ensure(leafId: string, state: BrowserTabState): void {
    if (!this.infos.has(leafId)) this.infos.set(leafId, { url: state.url, title: state.title, loading: false, canGoBack: false, canGoForward: false, crashed: false });
  }
  info(leafId: string) {
    return this.infos.get(leafId);
  }
  async page(leafId: string): Promise<PageSession> {
    let entry = this.pages.get(leafId);
    if (!entry) {
      const cdp = new FakeCdp()
        .on('Runtime.evaluate', (params: Record<string, unknown>) => {
          const expression = String(params['expression']);
          if (expression === 'location.href') return { result: { value: this.infos.get(leafId)?.url ?? 'about:blank' } };
          if (expression.includes('querySelectorAll')) return { result: { value: '[]' } };
          return { result: { value: 'Page body text' } };
        })
        .on('Accessibility.getFullAXTree', samplePageTree())
        .on('DOM.describeNode', sampleDescribeNode)
        .on('Page.getLayoutMetrics', { cssVisualViewport: { clientWidth: 800, clientHeight: 600 } })
        .on('Page.captureScreenshot', { data: 'cG5n' });
      entry = { cdp, page: new PageSession({ transport: cdp }) };
      this.pages.set(leafId, entry);
      await entry.page.attach();
    }
    return entry.page;
  }
  detach(): void {}
  async load(leafId: string, url: string): Promise<void> {
    this.loads.push(url);
    this.infos.set(leafId, { ...(this.infos.get(leafId) as TabInfo), url, title: `Title ${url}` });
  }
  readonly histories: string[] = [];
  history(leafId: string, action: string): void {
    this.histories.push(`${leafId}:${action}`);
  }
  destroy(leafId: string): void {
    this.destroyed.push(leafId);
  }
  place(leafId: string, bounds: object, visible: boolean): void {
    this.placed.set(leafId, { bounds, visible });
  }
  onEvent(listener: (event: TabEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  fire(event: TabEvent): void {
    for (const listener of this.listeners) listener(event);
  }
  setLive(): void {}
  async suspend(): Promise<ViewStill[]> {
    this.suspended = true;
    return [];
  }
  resume(): void {
    this.suspended = false;
  }
  async visibleViews(): Promise<ViewStill[]> {
    return [];
  }
  readonly cleared: string[] = [];
  readonly devtools: string[] = [];
  async clearSiteData(service: string): Promise<void> {
    this.cleared.push(service);
  }
  openDevTools(leafId: string): void {
    this.devtools.push(leafId);
  }
  zoom(): void {}
  focus(): void {}
  setActingProbe(): void {}
  policy: (leafId: string, url: string) => boolean = () => true;
  setRequestPolicy(policy: (leafId: string, url: string) => boolean): void {
    this.policy = policy;
  }
  async openExternal(): Promise<void> {}
}

let dir: string;
let views: FakeViews;
let modules: InitializedModules | undefined;
let registry: CommandRegistry;
let events: AppEvent[];
let bus: ReturnType<typeof createAppEventBus>;
const clients: Client[] = [];
const grants = new Map<string, ReturnType<InitializedModules['services']['mcp']['grant']>>();

async function start(dbPath = ':memory:'): Promise<void> {
  views = new FakeViews();
  registry = new CommandRegistry();
  bus = createAppEventBus();
  events = [];
  bus.onAny((event) => events.push(event));
  modules = await initModules({ events: bus, commands: registry, db: openStore(dbPath), dataDir: dir, browserViews: views });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'browser-module-'));
  delete process.env['CLAUDE_CONFIG_DIR'];
  grants.clear();
});
afterEach(async () => {
  await Promise.allSettled(clients.splice(0).map((client) => client.close()));
  await modules?.dispose();
  modules = undefined;
  rmSync(dir, { recursive: true, force: true });
});

const ui = { kind: 'ui' } as const;
const services = () => (modules as InitializedModules).services;

async function connect(sessionId: string, folderId: string, server: 'app' | 'browser'): Promise<Client> {
  const grant = (grants.get(sessionId) ?? services().mcp.grant(sessionId, folderId));
  grants.set(sessionId, grant);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(server === 'app' ? grant.url : `${grant.url}/browser`), { requestInit: { headers: { Authorization: `Bearer ${grant.token}` } } }));
  clients.push(client);
  return client;
}

const textOf = (result: unknown): string => ((result as { content: { type: string; text?: string }[] }).content.find((part) => part.type === 'text')?.text ?? '');

describe('browser module in the real module graph', () => {
  it('creates a tab leaf from a URL, records it with its service and shows it to the user through the tab state', async () => {
    await start();
    const folder = services().tree.createFolder({ title: 'Work' });
    const { leafId } = await services().browser.openTab({ folderId: folder.id, url: 'https://github.com/acme/app/pull/3', createdBy: 'user' });
    const leaf = services().tree.get(leafId);
    expect(leaf, 'leaf in the tree').toMatchObject({ kind: 'leaf', surfaceType: 'browser-tab', parentId: folder.id, title: 'github.com' });
    const state = (await registry.invoke('browser_tab_state', { leafId }, ui)) as { ok: true; value: Record<string, unknown> };
    expect(state.value, 'state').toMatchObject({ known: true, service: 'github', mode: 'on-demand', url: 'https://github.com/acme/app/pull/3', object: { kind: 'pull_request', id: 'acme/app#3' } });
    await expect(services().browser.openTab({ folderId: folder.id, url: 'file:///etc/passwd', createdBy: 'user' }), 'file URL').rejects.toThrow('scheme is not allowed');
    await expect(services().browser.openTab({ folderId: leafId, url: 'https://a.example', createdBy: 'user' }), 'a leaf is not a folder').rejects.toThrow('no folder');
  });

  it('renames the leaf to the page title until the user renames it', async () => {
    await start();
    const folder = services().tree.createFolder({ title: 'Work' });
    const { leafId } = await services().browser.openTab({ folderId: folder.id, url: 'https://github.com/acme/app', createdBy: 'user' });
    views.fire({ type: 'title', leafId, title: 'Sample dashboard' });
    expect(services().tree.get(leafId)?.title, 'the host title follows the page title').toBe('Sample dashboard');
    views.fire({ type: 'title', leafId, title: 'Sample dashboard 2' });
    expect(services().tree.get(leafId)?.title, 'a later page title replaces the one the app set').toBe('Sample dashboard 2');
    services().tree.rename(leafId, 'My tab');
    views.fire({ type: 'title', leafId, title: 'Another page' });
    expect(services().tree.get(leafId)?.title, 'a title the user chose stays').toBe('My tab');
  });

  it('keeps tabs, numbers and switches after a restart and removes a tab with its leaf', async () => {
    const db = join(dir, 'app.db');
    await start(db);
    const folder = services().tree.createFolder({ title: 'Work' });
    const first = await services().browser.openTab({ folderId: folder.id, url: 'https://example.com/', createdBy: 'user' });
    await registry.invoke('ui_set_observation', { nodeId: first.leafId, mode: 'off' }, ui);
    await modules?.dispose();
    await start(db);
    const restored = (await registry.invoke('browser_tab_state', { leafId: first.leafId }, ui)) as { ok: true; value: Record<string, unknown> };
    expect(restored.value, 'restored tab with its switch').toMatchObject({ known: true, mode: 'off', tabNumber: 1 });
    const second = await services().browser.openTab({ folderId: folder.id, url: 'https://example.org/', createdBy: 'user' });
    const next = (await registry.invoke('browser_tab_state', { leafId: second.leafId }, ui)) as { ok: true; value: { tabNumber: number } };
    expect(next.value.tabNumber, 'number after restart').toBe(2);
    services().tree.remove(first.leafId);
    expect(views.destroyed, 'view destroyed with the leaf').toContain(first.leafId);
    const gone = (await registry.invoke('browser_tab_state', { leafId: first.leafId }, ui)) as { ok: true; value: { known: boolean } };
    expect(gone.value.known, 'forgotten').toBe(false);
  });

  it('serves the hosted tools on the agide-browser endpoint only, and the app server does not list them', async () => {
    await start();
    const folder = services().tree.createFolder({ title: 'Work' });
    const browserTools = (await (await connect('s1', folder.id, 'browser')).listTools()).tools.map((tool) => tool.name);
    for (const name of ['navigate', 'computer', 'read_page', 'find', 'get_page_text', 'form_input', 'javascript_tool', 'read_console_messages', 'read_network_requests', 'tabs_context_mcp', 'tabs_create_mcp', 'tabs_close_mcp', 'browser_batch']) {
      expect(browserTools, `${name} on agide-browser`).toContain(name);
    }
    expect(browserTools, 'no app tools on the browser server').not.toContain('ui_list_tree');
    const appTools = (await (await connect('s2', folder.id, 'app')).listTools()).tools.map((tool) => tool.name);
    expect(appTools, 'surfaces_observe on the app server').toContain('surfaces_observe');
    expect(appTools, 'surface_highlight on the app server').toContain('surface_highlight');
    expect(appTools, 'browser_open_in_chrome on the app server').toContain('browser_open_in_chrome');
    for (const name of ['navigate', 'read_page', 'ui_set_observation', 'browser_view_place', 'browser_nav', 'browser_answer_approval', 'browser_stop_agent', 'browser_tab_state', 'browser_access_log']) {
      expect(appTools, `${name} is not an app tool`).not.toContain(name);
    }
  });

  it('reads a tab over MCP, labels the content, refuses another folder and a forged leaf, and shows the call in the access log', async () => {
    await start();
    const mine = services().tree.createFolder({ title: 'Mine' });
    const theirs = services().tree.createFolder({ title: 'Theirs' });
    const own = await services().browser.openTab({ folderId: mine.id, url: 'http://127.0.0.1:8123/page', createdBy: 'user' });
    const other = await services().browser.openTab({ folderId: theirs.id, url: 'http://127.0.0.1:8123/other', createdBy: 'user' });
    const forged = services().tree.createLeaf({ title: 'forged', parentId: mine.id, surfaceType: 'browser-tab', surfaceId: 'forged-surface' });
    const client = await connect('s1', mine.id, 'browser');

    const context = textOf(await client.callTool({ name: 'tabs_context_mcp', arguments: {} }));
    expect(context, 'own tab listed').toContain('tab 1 (web)');
    expect(context, 'other folder tab not listed').not.toContain('tab 2');
    expect(context, 'forged leaf not listed').not.toContain(forged.id);

    const page = await client.callTool({ name: 'read_page', arguments: { tabId: 1 } });
    expect(textOf(page), 'label first').toMatch(/^Untrusted page content from http:\/\/127\.0\.0\.1:8123 \(tab 1\)\./);
    expect(textOf(page), 'tree').toContain('button "Save"');

    const refused = await client.callTool({ name: 'read_page', arguments: { tabId: 2 } });
    expect(refused.isError, 'other folder is an error').toBe(true);
    expect(textOf(refused), 'wording of an unknown id').toBe('not_found: No tab with id 2 in your folder');

    const appClient = await connect('s1', mine.id, 'app');
    const forgedResult = await appClient.callTool({ name: 'surfaces_observe', arguments: { nodeId: forged.id, kind: 'text' } });
    expect(forgedResult.isError, 'forged leaf refused').toBe(true);
    expect(textOf(forgedResult), 'forged leaf wording').toContain('cannot be observed');
    const otherResult = await appClient.callTool({ name: 'surfaces_observe', arguments: { nodeId: other.leafId, kind: 'text' } });
    expect(otherResult.isError, 'other folder refused').toBe(true);

    const log = (await registry.invoke('browser_access_log', { nodeId: own.leafId }, ui)) as { ok: true; value: { entries: { kind: string; origin: string; outcome: string }[] } };
    expect(log.value.entries[0], 'access log entry').toMatchObject({ kind: 'tree', origin: 'http://127.0.0.1:8123', outcome: 'ok' });
    expect(events.some((event) => event.type === 'browser.accessed'), 'the bus carries the access').toBe(true);
  });

  it('switches observation off for the user only; the agent cannot call it and its tools and surfaces_observe refuse', async () => {
    await start();
    const mine = services().tree.createFolder({ title: 'Mine' });
    const own = await services().browser.openTab({ folderId: mine.id, url: 'http://127.0.0.1:8123/page', createdBy: 'user' });
    const agent = { kind: 'mcp', sessionId: 's1', folderId: mine.id } as const;
    expect((await registry.invoke('ui_set_observation', { nodeId: own.leafId, mode: 'live' }, agent)).ok, 'agent invoking the UI command').toBe(false);
    expect((await registry.invoke('ui_set_observation', { nodeId: own.leafId, mode: 'off' }, ui)).ok, 'user switching off').toBe(true);
    const browser = await connect('s1', mine.id, 'browser');
    const app = await connect('s1', mine.id, 'app');
    const read = await browser.callTool({ name: 'get_page_text', arguments: { tabId: 1 } });
    expect(textOf(read), 'tool refuses').toBe('failed: observation is off for this tab; the user can switch it on');
    const observed = await app.callTool({ name: 'surfaces_observe', arguments: { nodeId: own.leafId, kind: 'screenshot' } });
    expect(observed.isError, 'surfaces_observe refuses').toBe(true);
    expect(views.pages.size, 'the page was never read while off').toBe(0);
    await registry.invoke('ui_set_observation', { nodeId: own.leafId, mode: 'on-demand' }, ui);
    expect((await browser.callTool({ name: 'get_page_text', arguments: { tabId: 1 } })).isError, 'readable again').not.toBe(true);
  });

  it('turns a cross-service link event into a tab of the target service next to the source', async () => {
    await start();
    const mine = services().tree.createFolder({ title: 'Mine' });
    const source = await services().browser.openTab({ folderId: mine.id, url: 'https://acme.atlassian.net/browse/ABC-1', createdBy: 'user' });
    views.fire({ type: 'open_tab', leafId: source.leafId, url: 'https://github.com/acme/app/pull/9' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const children = services().tree.children(mine.id);
    expect(children.length, 'a second tab next to the first').toBe(2);
    const created = children.find((node) => node.id !== source.leafId);
    const state = (await registry.invoke('browser_tab_state', { leafId: created?.id }, ui)) as { ok: true; value: { service: string } };
    expect(state.value.service, 'service of the new tab').toBe('github');
  });

  it('places the view of a recorded leaf only and refuses a forged one', async () => {
    await start();
    const mine = services().tree.createFolder({ title: 'Mine' });
    const own = await services().browser.openTab({ folderId: mine.id, url: 'about:blank', createdBy: 'user' });
    const forged = services().tree.createLeaf({ title: 'forged', parentId: mine.id, surfaceType: 'browser-tab', surfaceId: 'forged' });
    const bounds = { x: 10, y: 20, width: 300, height: 200 };
    expect((await registry.invoke('browser_view_place', { leafId: own.leafId, bounds, visible: true }, ui)).ok, 'recorded leaf').toBe(true);
    expect(views.placed.get(own.leafId), 'placed').toEqual({ bounds, visible: true });
    expect((await registry.invoke('browser_view_place', { leafId: forged.id, bounds, visible: true }, ui)).ok, 'forged leaf').toBe(false);
    expect(views.placed.has(forged.id), 'no view for the forged leaf').toBe(false);
    expect((await registry.invoke('browser_view_place', { leafId: own.leafId, bounds, visible: true }, { kind: 'mcp', sessionId: 's', folderId: mine.id })).ok, 'agent cannot place views').toBe(false);
    await registry.invoke('browser_views_suspend', {}, ui);
    expect(views.suspended, 'suspended').toBe(true);
    await registry.invoke('browser_views_resume', {}, ui);
    expect(views.suspended, 'resumed').toBe(false);
  });

  it('answers a permission request through the tab state and lets the agent proceed', async () => {
    await start();
    const mine = services().tree.createFolder({ title: 'Mine' });
    const own = await services().browser.openTab({ folderId: mine.id, url: 'https://example.com/form', createdBy: 'user' });
    const browser = await connect('s1', mine.id, 'browser');
    const click = browser.callTool({ name: 'computer', arguments: { action: 'left_click', tabId: 1, coordinate: [5, 5], action_summary: 'Click Save' } });
    let approval: { id: string; origin: string; summary: string } | undefined;
    for (let i = 0; i < 50 && !approval; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      const state = (await registry.invoke('browser_tab_state', { leafId: own.leafId }, ui)) as { ok: true; value: { approvals: { id: string; origin: string; summary: string }[] } };
      approval = state.value.approvals[0];
    }
    expect(approval, 'request visible in the tab state').toMatchObject({ origin: 'https://example.com', summary: 'Click Save' });
    const [item] = services().inbox.list({ kinds: ['approval'] });
    expect(item, 'an open approval item in the folder links to the tab').toMatchObject({ folderId: mine.id, state: 'new', origin: 'browser:approval', linkNodeId: own.leafId, textAuthor: 'app' });
    expect(item?.payload, 'the agent summary travels in the payload').toMatchObject({ summary: 'Click Save', origin: 'https://example.com' });
    await registry.invoke('browser_answer_approval', { id: approval?.id, answer: 'once' }, ui);
    expect((await click).isError, 'call ran after the answer').not.toBe(true);
    expect(services().inbox.get(item?.id ?? ''), 'the item is resolved by the answer').toMatchObject({ state: 'done', resolution: 'approved' });
    expect((await registry.invoke('browser_answer_approval', { id: approval?.id, answer: 'once' }, ui)).ok, 'a request answers once').toBe(false);
  });

  it('lets an agent navigate to an https host on the profile network allowlist without asking and asks for any other host', async () => {
    await start();
    const mine = services().tree.createFolder({ title: 'Mine' });
    const own = await services().browser.openTab({ folderId: mine.id, url: 'https://example.com/', createdBy: 'user' });
    const browser = await connect('s1', mine.id, 'browser');
    expect(services().permissions.settings().network.allow, 'default allowlist names the registry').toContain('registry.npmjs.org');
    const allowed = await browser.callTool({ name: 'navigate', arguments: { tabId: 1, url: 'https://registry.npmjs.org/react' } });
    expect(allowed.isError, 'allowlisted host loads').not.toBe(true);
    expect(views.loads, 'the view loaded the allowlisted address').toContain('https://registry.npmjs.org/react');
    expect(services().inbox.list({ kinds: ['approval'] }), 'no approval item for an allowlisted host').toHaveLength(0);

    const asked = browser.callTool({ name: 'navigate', arguments: { tabId: 1, url: 'https://unlisted.example/' } });
    let approvals: { id: string }[] = [];
    for (let i = 0; i < 50 && approvals.length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      approvals = ((await registry.invoke('browser_tab_state', { leafId: own.leafId }, ui)) as { ok: true; value: { approvals: { id: string }[] } }).value.approvals;
    }
    expect(approvals, 'a host off the list asks').toHaveLength(1);
    await registry.invoke('browser_answer_approval', { id: approvals[0]?.id, answer: 'deny' }, ui);
    expect((await asked).isError, 'denied navigation is an error').toBe(true);
    expect(services().inbox.list({ kinds: ['approval'], states: ['done'] })[0], 'the item records the denial').toMatchObject({ resolution: 'denied' });
  });
});

async function openApprovals(leafId: string): Promise<{ id: string }[]> {
  let approvals: { id: string }[] = [];
  for (let i = 0; i < 100 && approvals.length === 0; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    approvals = ((await registry.invoke('browser_tab_state', { leafId }, ui)) as { ok: true; value: { approvals: { id: string }[] } }).value.approvals;
  }
  return approvals;
}

describe('browser approvals end with the thing they were asked for', () => {
  const askClick = async () => {
    await start();
    const mine = services().tree.createFolder({ title: 'Mine' });
    const own = await services().browser.openTab({ folderId: mine.id, url: 'https://example.com/form', createdBy: 'user' });
    const browser = await connect('s1', mine.id, 'browser');
    const click = browser.callTool({ name: 'computer', arguments: { action: 'left_click', tabId: 1, coordinate: [5, 5] } });
    expect(await openApprovals(own.leafId), 'the question is open').toHaveLength(1);
    return { mine, own, click };
  };

  it('denies the open question when its tab is removed', async () => {
    const { own, click } = await askClick();
    services().tree.remove(own.leafId);
    expect((await click).isError, 'the call ends as an error').toBe(true);
  });

  it('denies the open question when the user presses Stop agent', async () => {
    const { own, click } = await askClick();
    await registry.invoke('browser_stop_agent', { leafId: own.leafId }, ui);
    expect((await click).isError, 'the call ends as an error').toBe(true);
  });

  it('denies the open question when its session exits', async () => {
    const { own, click } = await askClick();
    click.catch(() => undefined);
    (services().sessions as unknown as { emit(event: object): void }).emit({ type: 'session.exited', session: { id: 's1' }, exitCode: 0, signal: null });
    const state = (await registry.invoke('browser_tab_state', { leafId: own.leafId }, ui)) as { ok: true; value: { approvals: unknown[] } };
    expect(state.value.approvals, 'no question stays open').toHaveLength(0);
    expect(services().inbox.list({ kinds: ['approval'], states: ['done'] })[0], 'the item records the denial').toMatchObject({ resolution: 'denied' });
  });

  it('denies the open question when its inbox item is dismissed', async () => {
    const { click } = await askClick();
    const [item] = services().inbox.list({ kinds: ['approval'] });
    services().inbox.resolve(item?.id ?? '', 'dismissed');
    expect((await click).isError, 'the call ends as an error').toBe(true);
  });

  it('gives an agent that has no tab a tab and an inbox item to answer when it navigates to an unlisted origin', async () => {
    await start();
    const mine = services().tree.createFolder({ title: 'Mine' });
    const browser = await connect('s1', mine.id, 'browser');
    const asked = browser.callTool({ name: 'navigate', arguments: { url: 'https://unlisted.example/' } });
    let item = services().inbox.list({ kinds: ['approval'] })[0];
    for (let i = 0; i < 100 && item === undefined; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      item = services().inbox.list({ kinds: ['approval'] })[0];
    }
    expect(item, 'an approval item exists').toMatchObject({ folderId: mine.id, origin: 'browser:approval' });
    expect(item?.linkNodeId, 'it links to the tab that carries the question').toEqual(expect.stringMatching(/.+/));
    const approvalId = (item?.payload as { approvalId: string }).approvalId;
    expect((await registry.invoke('browser_answer_approval', { id: approvalId, answer: 'deny' }, ui)).ok, 'the card can answer it').toBe(true);
    expect((await asked).isError, 'the navigation fails after the denial').toBe(true);
  });

  it('asks before an agent opens a tab in the user Chrome', async () => {
    await start();
    const mine = services().tree.createFolder({ title: 'Mine' });
    const own = await services().browser.openTab({ folderId: mine.id, url: 'https://example.com/', createdBy: 'user' });
    const agent = { kind: 'mcp', sessionId: 's1', folderId: mine.id } as const;
    const opened = registry.invoke('browser_open_in_chrome', { nodeId: own.leafId }, agent);
    const [approval] = await openApprovals(own.leafId);
    await registry.invoke('browser_answer_approval', { id: approval?.id, answer: 'deny' }, ui);
    expect((await opened).ok, 'denied open in Chrome').toBe(false);
  });
});

describe('request policy of tabs an agent drives', () => {
  it('holds agent tabs to the allowlist under srt and leaves user tabs and other providers alone', async () => {
    await start();
    const mine = services().tree.createFolder({ title: 'Mine' });
    const agentTab = await services().browser.openTab({ folderId: mine.id, url: 'about:blank', createdBy: 's1' });
    const userTab = await services().browser.openTab({ folderId: mine.id, url: 'about:blank', createdBy: 'user' });
    expect(views.policy(agentTab.leafId, 'https://exfil.example/x'), 'local provider: no limit').toBe(true);
    const profile = services().profile;
    profile.store.updateSettings(profile.id, { isolation: { ...profile.settings().isolation, provider: 'srt' } });
    expect(views.policy(agentTab.leafId, 'https://exfil.example/x'), 'agent tab, unlisted host').toBe(false);
    expect(views.policy(agentTab.leafId, 'http://127.0.0.1:3000/page'), 'agent tab, loopback').toBe(true);
    expect(views.policy(agentTab.leafId, 'https://registry.npmjs.org/react'), 'agent tab, allowlisted host').toBe(true);
    expect(views.policy(agentTab.leafId, 'https://github.com/acme/app'), 'agent tab, signed-in service on the list').toBe(false);
    expect(views.policy(userTab.leafId, 'https://exfil.example/x'), 'user tab').toBe(true);
  });
});

describe('user commands of the tab chrome', () => {
  it('goes to a typed address, refuses a bad one, opens a cross-service address in a new tab and runs history actions', async () => {
    await start();
    const mine = services().tree.createFolder({ title: 'Mine' });
    const first = await registry.invoke('browser_new_tab', { folderId: mine.id, url: 'https://acme.atlassian.net/browse/ABC-1' }, ui);
    const leafId = (first as { ok: true; value: { leafId: string } }).value.leafId;
    expect((await registry.invoke('browser_nav', { leafId, action: 'go', address: 'file:///etc/hosts' }, ui)).ok, 'file address').toBe(false);
    expect((await registry.invoke('browser_nav', { leafId, action: 'go', address: 'what is this' }, ui)).ok, 'not a URL').toBe(false);
    await registry.invoke('browser_nav', { leafId, action: 'go', address: 'acme.atlassian.net/browse/ABC-2' }, ui);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(views.loads, 'same service loads in the tab').toEqual(['https://acme.atlassian.net/browse/ABC-2']);
    const other = await registry.invoke('browser_nav', { leafId, action: 'go', address: 'github.com/acme/app' }, ui);
    expect(other, 'cross-service address opens a tab').toMatchObject({ ok: true, value: { openedInNewTab: true } });
    expect(services().tree.children(mine.id).length, 'a second tab').toBe(2);
    expect((await registry.invoke('browser_nav', { leafId, action: 'reload' }, ui)).ok, 'history action').toBe(true);
  });

  it('records the call of open in Chrome, refuses a forged leaf and keeps clear site data and DevTools for the user', async () => {
    await start();
    const mine = services().tree.createFolder({ title: 'Mine' });
    const own = await services().browser.openTab({ folderId: mine.id, url: 'about:blank', createdBy: 'user' });
    const agent = { kind: 'mcp', sessionId: 's1', folderId: mine.id } as const;
    const empty = await registry.invoke('browser_open_in_chrome', { nodeId: own.leafId }, agent);
    expect(empty.ok, 'an empty tab has nothing to open').toBe(false);
    const forged = services().tree.createLeaf({ title: 'forged', parentId: mine.id, surfaceType: 'browser-tab', surfaceId: 'forged' });
    expect((await registry.invoke('browser_open_in_chrome', { nodeId: forged.id }, agent)).ok, 'forged leaf').toBe(false);
    expect((await registry.invoke('browser_clear_site_data', { leafId: own.leafId }, agent)).ok, 'agent clearing site data').toBe(false);
    expect((await registry.invoke('browser_clear_site_data', { leafId: own.leafId }, ui)).ok, 'user clearing site data').toBe(true);
    expect((await registry.invoke('browser_devtools', { leafId: own.leafId }, agent)).ok, 'agent opening DevTools').toBe(false);
    expect((await registry.invoke('browser_stop_agent', { leafId: own.leafId }, ui)).ok, 'stop agent').toBe(true);
  });

  it('reads blocked origins from browser-blocked.json and forces observation off for them', async () => {
    writeFileSync(join(dir, 'browser-blocked.json'), JSON.stringify([{ origin: 'bank.example' }]));
    await start();
    const mine = services().tree.createFolder({ title: 'Mine' });
    const tab = await services().browser.openTab({ folderId: mine.id, url: 'https://bank.example/accounts', createdBy: 'user' });
    const state = (await registry.invoke('browser_tab_state', { leafId: tab.leafId }, ui)) as { ok: true; value: { mode: string; blocked: boolean } };
    expect(state.value, 'forced off').toMatchObject({ mode: 'off', blocked: true });
    const browser = await connect('s1', mine.id, 'browser');
    expect(textOf(await browser.callTool({ name: 'get_page_text', arguments: { tabId: 1 } })), 'tools refuse').toContain('observation is off');
  });
});

describe('launch contribution and digest', () => {
  it('adds the agide-browser server with a timeout above the approval wait, --no-chrome and a UserPromptSubmit digest hook', async () => {
    const tree = new InMemoryTreeService();
    const folder = tree.createFolder({ title: 'Work' });
    const launch = new LaunchContributors();
    const bus = createAppEventBus();
    const files = new Map<string, string>();
    const sessionListeners = new Set<(event: AppEvent) => void>();
    const handle = browserModule.init(
      { events: bus, commands: new CommandRegistry(), db: openStore(':memory:'), dataDir: dir, browserViews: (views = new FakeViews()) },
      {
        tree,
        mcp: { configFor: () => ({ mcpServers: { app: { type: 'http', url: 'http://127.0.0.1:1/mcp/s1', headers: { Authorization: 'Bearer tok' } } } }) } as never,
        sessions: { get: (id: string) => (id === 's1' ? { id, folderId: folder.id } : undefined), subscribe: (listener: (event: AppEvent) => void) => (sessionListeners.add(listener), () => sessionListeners.delete(listener)) } as never,
        profile: {} as never,
        permissions: {} as never,
        inbox: { subscribe: () => () => undefined } as never,
        launch,
      },
    );
    const [contributor] = launch.list();
    const digestFile = join(dir, 'digest.json');
    const contribution = await contributor?.contribute({
      session: { id: 's1', folderId: folder.id },
      mcpUrl: 'http://127.0.0.1:1/mcp/s1',
      writeSessionFile: async (_name: string, content: string) => {
        files.set('digest', content);
        return digestFile;
      },
    } as never);
    expect(contribution?.args, 'no Claude in Chrome by default').toEqual(['--no-chrome']);
    const server = contribution?.mcpServers?.['agide-browser'] as { url: string; timeout: number; headers: { Authorization: string } };
    expect(server.url, 'browser endpoint under the session URL').toBe('http://127.0.0.1:1/mcp/s1/browser');
    expect(server.timeout, 'timeout above the 120 s wait').toBeGreaterThan(120_000);
    expect(server.headers.Authorization, 'same bearer token').toBe('Bearer tok');
    expect(contribution?.settings?.hooks?.UserPromptSubmit?.[0]?.command, 'hook prints the digest file').toBe(`/bin/cat '${digestFile}'`);
    expect(files.get('digest'), 'digest starts empty').toBe('');

    const { leafId } = await handle.service.openTab({ folderId: folder.id, url: 'https://github.com/acme/app/pull/418?token=abc', createdBy: 'user' });
    views.infos.set(leafId, { ...(views.infos.get(leafId) as TabInfo), title: 'Fix retry' });
    views.fire({ type: 'navigated', leafId, url: 'https://github.com/acme/app/pull/418?token=abc', title: 'Fix retry' });
    await new Promise((resolve) => setTimeout(resolve, 30));
    const written = JSON.parse(files.get('digest') ?? '{}') as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
    expect(written.hookSpecificOutput.hookEventName, 'hook output shape').toBe('UserPromptSubmit');
    expect(written.hookSpecificOutput.additionalContext, 'digest line').toContain('- tab 1 (github) "Fix retry" github.com/acme/app/pull/418 [pull_request acme/app#418] navigated');
    expect(written.hookSpecificOutput.additionalContext, 'no query in the digest').not.toContain('token');

    for (const listener of sessionListeners) listener({ type: 'session.hook', sessionId: 's1', hookEvent: 'UserPromptSubmit', payload: {} } as AppEvent);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(files.get('digest'), 'digest cleared once the prompt was submitted').toBe('');
    void handle.dispose?.();
    void readFileSync;
  });
});

describe('browser module commands of the tab chrome', () => {
  async function tab(url = 'https://example.com/', service = 'web') {
    await start();
    const folder = services().tree.createFolder({ title: 'Work' });
    const { leafId } = await services().browser.openTab({ folderId: folder.id, url, createdBy: 'user' });
    return { folder, leafId, service };
  }
  const run = (id: string, input: unknown) => registry.invoke(id, input, ui);
  const failure = async (id: string, input: unknown) => {
    const result = await run(id, input);
    return result.ok ? undefined : result.error;
  };

  it('places a tab at the reported slot and parks it when no slot shows it', async () => {
    const { leafId } = await tab();
    expect(await run('browser_view_place', { leafId, bounds: { x: 1, y: 2, width: 30, height: 40 }, visible: true }), 'placed').toMatchObject({ ok: true, value: { placed: true } });
    expect(views.placed.get(leafId), 'view placed').toEqual({ bounds: { x: 1, y: 2, width: 30, height: 40 }, visible: true });
    await run('browser_view_place', { leafId, bounds: { x: 0, y: 0, width: 0, height: 0 }, visible: false });
    expect(views.placed.get(leafId)?.visible, 'parked').toBe(false);
  });

  it('refuses to place a leaf that is not a tab and a negative size', async () => {
    const { folder, leafId } = await tab();
    expect((await failure('browser_view_place', { leafId: folder.id, bounds: { x: 0, y: 0, width: 1, height: 1 }, visible: true }))?.code, 'folder is no tab').toBe('not_found');
    expect((await failure('browser_view_place', { leafId, bounds: { x: 0, y: 0, width: -1, height: 1 }, visible: true }))?.code, 'negative width').toBe('invalid_input');
  });

  it('suspends and resumes the views', async () => {
    await tab();
    expect(await run('browser_views_suspend', {}), 'suspend').toMatchObject({ ok: true, value: { stills: [] } });
    expect(views.suspended, 'views hidden').toBe(true);
    await run('browser_views_resume', {});
    expect(views.suspended, 'views shown').toBe(false);
  });

  it('runs back, forward, reload and stop on the view of the tab', async () => {
    const { leafId } = await tab();
    for (const action of ['back', 'forward', 'reload', 'stop']) await run('browser_nav', { leafId, action });
    expect(views.histories, 'history calls').toEqual([`${leafId}:back`, `${leafId}:forward`, `${leafId}:reload`, `${leafId}:stop`]);
  });

  it('loads a typed address and gives a bare host the https scheme', async () => {
    const { leafId } = await tab();
    await run('browser_nav', { leafId, action: 'go', address: 'example.org/page' });
    await vi.waitFor(() => expect(views.loads, 'loaded address').toContain('https://example.org/page'));
  });

  it('refuses a typed address that is not a URL or has a scheme the tab does not load', async () => {
    const { leafId } = await tab();
    expect((await failure('browser_nav', { leafId, action: 'go', address: 'two words' }))?.code, 'not a URL').toBe('invalid_input');
    expect((await failure('browser_nav', { leafId, action: 'go', address: 'file:///etc/passwd' }))?.code, 'file scheme').toBe('failed');
    expect((await failure('browser_nav', { leafId, action: 'go', address: 'javascript:alert(1)' }))?.code, 'script scheme').toBe('failed');
    expect(views.loads, 'nothing loaded').toEqual([]);
  });

  it('opens a typed address of another service as a new tab next to the tab and loads it in a blank tab', async () => {
    const { folder, leafId } = await tab();
    const result = await run('browser_nav', { leafId, action: 'go', address: 'https://github.com/acme/app' });
    expect(result, 'opened as new tab').toMatchObject({ ok: true, value: { openedInNewTab: true } });
    expect(services().tree.children(folder.id).filter((node) => node.kind === 'leaf' && node.surfaceType === 'browser-tab'), 'tabs in the folder').toHaveLength(2);
    const blank = await services().browser.openTab({ folderId: folder.id, url: 'about:blank', createdBy: 'user' });
    const loadInBlank = await run('browser_nav', { leafId: blank.leafId, action: 'go', address: 'https://github.com/acme/app' });
    expect(loadInBlank, 'a blank tab takes the address itself').toMatchObject({ ok: true, value: { ok: true } });
  });

  it('refuses navigation of a leaf that is not a tab', async () => {
    const { folder } = await tab();
    expect((await failure('browser_nav', { leafId: folder.id, action: 'reload' }))?.code, 'folder').toBe('not_found');
  });

  it('creates a tab in a folder from the tree command and refuses a scheme that does not load', async () => {
    const { folder } = await tab();
    const created = await run('browser_new_tab', { folderId: folder.id, url: 'https://example.net/' });
    expect(created, 'created').toMatchObject({ ok: true, value: { node: { kind: 'leaf', surfaceType: 'browser-tab' } } });
    expect((await failure('browser_new_tab', { folderId: folder.id, url: 'data:text/html,hi' }))?.message, 'data URL').toContain('scheme is not allowed');
  });

  it('clears the site data of the service of a tab and opens its developer tools', async () => {
    const { leafId } = await tab('https://github.com/acme/app');
    expect(await run('browser_clear_site_data', { leafId }), 'cleared').toMatchObject({ ok: true, value: { cleared: 'github' } });
    expect(views.cleared, 'site data cleared for the service').toEqual(['github']);
    await run('browser_devtools', { leafId });
    expect(views.devtools, 'devtools opened').toEqual([leafId]);
    expect((await failure('browser_clear_site_data', { leafId: 'nope' }))?.code, 'unknown tab').toBe('not_found');
  });

  it('does not offer the chrome commands to agents', async () => {
    const { folder, leafId } = await tab();
    const agent = { kind: 'mcp', sessionId: 's1', folderId: folder.id } as const;
    for (const [id, input] of [['browser_nav', { leafId, action: 'reload' }], ['ui_set_observation', { nodeId: leafId, mode: 'live' }], ['browser_clear_site_data', { leafId }], ['browser_answer_approval', { id: 'x', answer: 'always' }]] as const) {
      expect((await registry.invoke(id, input, agent)).ok, `${id} for an agent`).toBe(false);
    }
    expect(views.histories, 'nothing ran').toEqual([]);
  });

  it('refuses to change the observation of a leaf that is not a tab', async () => {
    const { folder } = await tab();
    expect((await failure('ui_set_observation', { nodeId: folder.id, mode: 'off' }))?.code, 'folder').toBe('not_found');
  });

  it('answers the access log of a tab and refuses an answer to a request that is gone', async () => {
    const { leafId } = await tab();
    expect(await run('browser_access_log', { nodeId: leafId }), 'empty log').toMatchObject({ ok: true, value: { entries: [] } });
    expect((await failure('browser_answer_approval', { id: 'gone', answer: 'once' }))?.code, 'unknown request').toBe('not_found');
    expect(await run('browser_stop_agent', { leafId }), 'stop without a request').toMatchObject({ ok: true, value: { stopped: true } });
  });

  it('reports a blocked address in the tab state and keeps observation off for it', async () => {
    await start();
    writeFileSync(join(dir, 'browser-blocked.json'), JSON.stringify([{ origin: 'bank.example' }]));
    await modules?.dispose();
    await start();
    const folder = services().tree.createFolder({ title: 'Work' });
    const { leafId } = await services().browser.openTab({ folderId: folder.id, url: 'https://bank.example/accounts', createdBy: 'user' });
    const state = (await run('browser_tab_state', { leafId })) as { ok: true; value: { blocked: boolean; mode: string } };
    expect(state.value, 'blocked address forces off').toMatchObject({ blocked: true, mode: 'off' });
  });

  it('ignores a blocked-address file that is not valid and observes as usual', async () => {
    await start();
    writeFileSync(join(dir, 'browser-blocked.json'), '{"origin":"bank.example"}');
    await modules?.dispose();
    await start();
    const folder = services().tree.createFolder({ title: 'Work' });
    const { leafId } = await services().browser.openTab({ folderId: folder.id, url: 'https://bank.example/accounts', createdBy: 'user' });
    const state = (await run('browser_tab_state', { leafId })) as { ok: true; value: { blocked: boolean; mode: string } };
    expect(state.value, 'invalid file blocks nothing').toMatchObject({ blocked: false, mode: 'on-demand' });
  });

  it('records the page address and title of a navigation and keeps them across a restart, except for an address that is not http', async () => {
    const db = join(dir, 'events.db');
    await start(db);
    const folder = services().tree.createFolder({ title: 'Work' });
    const { leafId } = await services().browser.openTab({ folderId: folder.id, url: 'https://example.com/', createdBy: 'user' });
    views.fire({ type: 'navigated', leafId, url: 'https://example.com/next', title: 'Next', history: { entries: [{ url: 'https://example.com/next', title: 'Next' }], index: 0 } });
    views.fire({ type: 'navigated', leafId, url: 'chrome://settings', title: '' });
    await modules?.dispose();
    await start(db);
    const state = (await run('browser_tab_state', { leafId })) as { ok: true; value: { url: string; title: string } };
    expect(state.value, 'last http address and its title').toMatchObject({ url: 'https://example.com/next', title: 'Next' });
  });

  it('shows an open dialog in the tab state until it closes', async () => {
    const { leafId } = await tab();
    views.fire({ type: 'dialog', leafId, open: true });
    expect(((await run('browser_tab_state', { leafId })) as { value: { dialog: boolean } }).value.dialog, 'open').toBe(true);
    views.fire({ type: 'dialog', leafId, open: false });
    expect(((await run('browser_tab_state', { leafId })) as { value: { dialog: boolean } }).value.dialog, 'closed').toBe(false);
  });

  it('opens a tab beside the source when a page asks for one', async () => {
    const { folder, leafId } = await tab();
    views.fire({ type: 'open_tab', leafId, url: 'https://github.com/acme/app' });
    await vi.waitFor(() => expect(services().tree.children(folder.id).filter((node) => node.kind === 'leaf' && node.surfaceType === 'browser-tab'), 'second tab').toHaveLength(2));
  });
});
