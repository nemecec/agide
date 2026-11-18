import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TabEvent } from '../../core/browser/runtime';
import type { BrowserTabState } from '../../core/browser/types';

let nextContentsId = 1;

class FakeContents extends EventEmitter {
  readonly id = nextContentsId++;
  destroyed = false;
  url = '';
  loading = false;
  zoom = 1;
  loadError: Error | undefined;
  readonly loads: string[] = [];
  readonly debugger = Object.assign(new EventEmitter(), {
    attached: false,
    isAttached() {
      return this.attached;
    },
    attach() {
      this.attached = true;
    },
    detach() {
      this.attached = false;
    },
    sendCommand: vi.fn(async () => ({})),
  });
  readonly navigationHistory = {
    entries: [] as { url: string; title: string }[],
    index: 0,
    restored: undefined as unknown,
    getAllEntries() {
      return this.entries;
    },
    getActiveIndex() {
      return this.index;
    },
    canGoBack: () => false,
    canGoForward: () => false,
    goBack: vi.fn(),
    goForward: vi.fn(),
    restore: vi.fn(async function (this: unknown, value: unknown) {
      (this as { restored: unknown }).restored = value;
    }),
  };
  windowOpenHandler: unknown;
  getURL = () => this.url;
  getTitle = () => 'title';
  isLoading = () => this.loading;
  isDestroyed = () => this.destroyed;
  loadURL = vi.fn(async (url: string) => {
    this.loads.push(url);
    queueMicrotask(() => this.emit('did-stop-loading'));
    if (this.loadError) throw this.loadError;
    this.url = url;
  });
  reload = vi.fn();
  stop = vi.fn();
  focus = vi.fn();
  openDevTools = vi.fn();
  close = vi.fn(() => void (this.destroyed = true));
  setZoomFactor = (factor: number) => void (this.zoom = factor);
  getZoomFactor = () => this.zoom;
  setWindowOpenHandler = (handler: unknown) => void (this.windowOpenHandler = handler);
  capturePage = vi.fn(async () => ({ toPNG: () => Buffer.from('png') }));
}

class FakeView {
  readonly webContents = new FakeContents();
  bounds: unknown;
  visible: boolean | undefined;
  constructor(readonly options: { webPreferences: Record<string, unknown> }) {
    views.push(this);
  }
  setBounds(bounds: unknown) {
    this.bounds = bounds;
  }
  setVisible(visible: boolean) {
    this.visible = visible;
  }
}

class FakeWindow {
  readonly children = new Set<FakeView>();
  destroyed = false;
  readonly webContents = { getZoomFactor: () => 1 };
  readonly contentView = {
    addChildView: (view: FakeView) => {
      for (const window of allWindows) if (window !== this) window.children.delete(view);
      this.children.add(view);
    },
    removeChildView: (view: FakeView) => void this.children.delete(view),
  };
  constructor(readonly options?: object) {
    allWindows.push(this);
  }
  destroy() {
    this.destroyed = true;
  }
}

class FakeSession extends EventEmitter {
  readonly cookies = { get: vi.fn(async () => [{ value: 'cookie-value-1' }]) };
  readonly clearStorageData = vi.fn(async () => undefined);
  readonly handlers: Record<string, unknown> = {};
  readonly webRequest = {
    onBeforeRequest: (_filter: unknown, listener: unknown) => void (this.handlers['beforeRequest'] = listener),
  };
  setPermissionRequestHandler = (handler: unknown) => void (this.handlers['request'] = handler);
  setPermissionCheckHandler = (handler: unknown) => void (this.handlers['check'] = handler);
  setDevicePermissionHandler = (handler: unknown) => void (this.handlers['device'] = handler);
  setDisplayMediaRequestHandler = (handler: unknown) => void (this.handlers['media'] = handler);
}

const views: FakeView[] = [];
const allWindows: FakeWindow[] = [];
const sessions = new Map<string, FakeSession>();
const openExternal = vi.fn(async (_url: string) => undefined);

vi.mock('electron', () => ({
  BaseWindow: FakeWindow,
  BrowserWindow: FakeWindow,
  WebContentsView: FakeView,
  shell: { openExternal: (url: string) => openExternal(url) },
  session: {
    fromPartition: (name: string) => {
      let existing = sessions.get(name);
      if (!existing) {
        existing = new FakeSession();
        sessions.set(name, existing);
      }
      return existing;
    },
  },
}));

const { ElectronViews } = await import('./ElectronViews');

const state = (over: Partial<BrowserTabState> = {}): BrowserTabState => ({ tabNumber: 1, service: 'web', url: 'https://a.test/', title: 'A', zoom: 1, createdBy: 'user', ...over }) as BrowserTabState;

let main: FakeWindow;
let events: TabEvent[];
let electronViews: InstanceType<typeof ElectronViews>;

beforeEach(() => {
  views.length = 0;
  allWindows.length = 0;
  sessions.clear();
  openExternal.mockClear();
  main = new FakeWindow();
  events = [];
  electronViews = new ElectronViews({ mainWindow: () => main as never });
  electronViews.onEvent((event) => events.push(event));
});

const parking = () => allWindows.find((window) => window !== main)!;

describe('ElectronViews: view creation', () => {
  it('creates a sandboxed view with the service partition and loads the stored address', () => {
    electronViews.ensure('leaf1', state());
    expect(views, 'one view').toHaveLength(1);
    expect(views[0]!.options.webPreferences, 'preferences').toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true });
    expect(views[0]!.webContents.loads, 'loaded').toEqual(['https://a.test/']);
    expect(sessions.has('persist:web'), 'partition named by service').toBe(true);
    expect(electronViews.owns(views[0]!.webContents), 'owned contents').toBe(true);
    expect(electronViews.owns({}), 'foreign contents').toBe(false);
  });

  it('creates a view once per leaf and does not load a blank tab', () => {
    electronViews.ensure('leaf1', state({ url: 'about:blank' }));
    electronViews.ensure('leaf1', state({ url: 'about:blank' }));
    expect(views, 'one view').toHaveLength(1);
    expect(views[0]!.webContents.loads, 'no load for about:blank').toEqual([]);
  });

  it('restores the stored history when there is one', () => {
    electronViews.ensure('leaf1', state({ history: { index: 1, entries: [{ url: 'https://a.test/', title: 'A' }, { url: 'https://a.test/b', title: 'B' }] } }));
    expect(views[0]!.webContents.navigationHistory.restored, 'restored entries').toMatchObject({ index: 1 });
    expect(views[0]!.webContents.loads, 'no extra load').toEqual([]);
  });

  it('parks a new view in the hidden window at the size of a normal tab', () => {
    electronViews.ensure('leaf1', state());
    expect(parking().children.has(views[0]!), 'in the parking window').toBe(true);
    expect(parking().options, 'never shown').toMatchObject({ show: false });
    expect(views[0]!.bounds, 'parked size').toEqual({ x: 0, y: 0, width: 1024, height: 768 });
  });

  it('shares one session per service and gives each service its own', () => {
    electronViews.ensure('a', state({ service: 'web' }));
    electronViews.ensure('b', state({ service: 'web' }));
    electronViews.ensure('c', state({ service: 'jira' }));
    expect([...sessions.keys()].sort(), 'partitions').toEqual(['persist:jira', 'persist:web']);
  });

  it('applies the partition permission policy to each new session', () => {
    electronViews.ensure('a', state());
    const handlers = sessions.get('persist:web')!.handlers;
    const request = handlers['request'] as (c: unknown, permission: string, callback: (granted: boolean) => void) => void;
    const answers: boolean[] = [];
    request({}, 'media', (granted) => answers.push(granted));
    request({}, 'fullscreen', (granted) => answers.push(granted));
    expect(answers, 'media denied, fullscreen granted').toEqual([false, true]);
  });
});

describe('ElectronViews: placement', () => {
  it('moves the view into the window at the zoom-scaled bounds and shows it', () => {
    electronViews.ensure('leaf1', state());
    electronViews.place('leaf1', { x: 10, y: 20, width: 300, height: 200 }, true);
    expect(main.children.has(views[0]!), 'in the main window').toBe(true);
    expect(views[0]!.bounds, 'bounds').toEqual({ x: 10, y: 20, width: 300, height: 200 });
    expect(views[0]!.visible, 'shown').toBe(true);
  });

  it('scales the bounds by the zoom factor of the window', () => {
    (main.webContents as { getZoomFactor: () => number }).getZoomFactor = () => 1.5;
    electronViews.ensure('leaf1', state());
    electronViews.place('leaf1', { x: 10, y: 20, width: 100, height: 100 }, true);
    expect(views[0]!.bounds, 'scaled').toEqual({ x: 15, y: 30, width: 150, height: 150 });
  });

  it('parks the view when the slot is hidden and when no window exists', () => {
    electronViews.ensure('leaf1', state());
    electronViews.place('leaf1', { x: 0, y: 0, width: 100, height: 100 }, true);
    electronViews.place('leaf1', { x: 0, y: 0, width: 0, height: 0 }, false);
    expect(parking().children.has(views[0]!), 'parked again').toBe(true);
    expect(main.children.has(views[0]!), 'out of the main window').toBe(false);
    expect(views[0]!.visible, 'still visible so that frames keep coming').toBe(true);
    const detached = new ElectronViews({ mainWindow: () => undefined });
    detached.ensure('x', state());
    detached.place('x', { x: 0, y: 0, width: 10, height: 10 }, true);
    expect(views[1]!.bounds, 'parked without a window').toEqual({ x: 0, y: 0, width: 1024, height: 768 });
  });

  it('creates the view of a leaf it has not seen from the state source and refuses an unknown leaf', () => {
    electronViews.setStateSource((leafId) => (leafId === 'known' ? state() : undefined));
    electronViews.place('known', { x: 0, y: 0, width: 10, height: 10 }, true);
    expect(views, 'view created on demand').toHaveLength(1);
    expect(() => electronViews.place('unknown', { x: 0, y: 0, width: 10, height: 10 }, true), 'unknown leaf').toThrow('no browser tab unknown');
  });

  it('reports the placed views with their bounds and a capture on request', async () => {
    electronViews.ensure('a', state());
    electronViews.ensure('b', state());
    electronViews.place('a', { x: 1, y: 2, width: 30, height: 40 }, true);
    expect(await electronViews.visibleViews(false), 'bounds only').toEqual([{ leafId: 'a', bounds: { x: 1, y: 2, width: 30, height: 40 } }]);
    const [still] = await electronViews.visibleViews(true);
    expect(still?.dataUrl, 'png data url').toBe(`data:image/png;base64,${Buffer.from('png').toString('base64')}`);
  });

  it('reports a view without a capture when the capture fails', async () => {
    electronViews.ensure('a', state());
    electronViews.place('a', { x: 1, y: 2, width: 30, height: 40 }, true);
    views[0]!.webContents.capturePage.mockRejectedValueOnce(new Error('gone'));
    const [still] = await electronViews.visibleViews(true);
    expect(still, 'no data url').toEqual({ leafId: 'a', bounds: { x: 1, y: 2, width: 30, height: 40 } });
  });

  it('hides the placed views while suspended and shows them again on resume', async () => {
    electronViews.ensure('a', state());
    electronViews.place('a', { x: 1, y: 2, width: 30, height: 40 }, true);
    const stills = await electronViews.suspend();
    expect(stills.map((still) => still.leafId), 'captured').toEqual(['a']);
    expect(views[0]!.visible, 'hidden').toBe(false);
    electronViews.place('a', { x: 5, y: 5, width: 30, height: 40 }, true);
    expect(views[0]!.visible, 'a placement during suspension keeps it hidden').toBe(false);
    electronViews.resume();
    expect(views[0]!.visible, 'shown after resume').toBe(true);
  });
});

describe('ElectronViews: hidden placement, suspension and request policy', () => {
  it('creates no view and loads nothing when a leaf without a view is placed hidden', () => {
    electronViews.setStateSource(() => state());
    electronViews.place('evicted', { x: 0, y: 0, width: 0, height: 0 }, false);
    expect(views, 'no view for a hidden placement').toHaveLength(0);
  });

  it('keeps a view that is placed for the first time during a suspension hidden until resume', async () => {
    electronViews.ensure('a', state());
    electronViews.ensure('b', state());
    electronViews.place('a', { x: 1, y: 2, width: 30, height: 40 }, true);
    await electronViews.suspend();
    electronViews.place('b', { x: 1, y: 2, width: 30, height: 40 }, true);
    expect(views[1]!.visible, 'a view placed during the suspension is hidden').not.toBe(true);
    electronViews.resume();
    expect(views[1]!.visible, 'shown after resume').toBe(true);
  });

  it('cancels a request of a view that the policy refuses and lets the others through', () => {
    electronViews.ensure('a', state());
    electronViews.setRequestPolicy((leafId, url) => !(leafId === 'a' && url.includes('evil')));
    const listener = sessions.get('persist:web')!.handlers['beforeRequest'] as (details: { webContentsId: number; url: string }, callback: (answer: { cancel: boolean }) => void) => void;
    const answers: boolean[] = [];
    listener({ webContentsId: views[0]!.webContents.id, url: 'https://evil.test/x' }, (answer) => answers.push(answer.cancel));
    listener({ webContentsId: views[0]!.webContents.id, url: 'https://good.test/x' }, (answer) => answers.push(answer.cancel));
    listener({ webContentsId: -1, url: 'https://evil.test/x' }, (answer) => answers.push(answer.cancel));
    expect(answers, 'refused, allowed, unknown contents allowed').toEqual([true, false, false]);
  });
});

describe('ElectronViews: limits and removal', () => {
  it('destroys the longest unused parked view when the live limit is reached and keeps placed views', () => {
    electronViews.ensure('shown', state());
    electronViews.place('shown', { x: 0, y: 0, width: 10, height: 10 }, true);
    for (let index = 0; index < 7; index++) electronViews.ensure(`p${index}`, state());
    expect(views, 'limit reached').toHaveLength(8);
    electronViews.ensure('extra', state());
    expect(views[0]!.webContents.destroyed, 'placed view stays').toBe(false);
    expect(views[1]!.webContents.destroyed, 'oldest parked view destroyed').toBe(true);
    expect(electronViews.info('p0'), 'its info is gone').toBeUndefined();
  });

  it('removes the view from its window and closes the contents on destroy, and ignores an unknown leaf', () => {
    electronViews.ensure('a', state());
    electronViews.place('a', { x: 0, y: 0, width: 10, height: 10 }, true);
    electronViews.destroy('a');
    expect(main.children.size, 'removed from the window').toBe(0);
    expect(views[0]!.webContents.close, 'contents closed').toHaveBeenCalled();
    expect(() => electronViews.destroy('missing')).not.toThrow();
  });

  it('destroys every view and the parking window on dispose', () => {
    electronViews.ensure('a', state());
    electronViews.ensure('b', state());
    electronViews.dispose();
    expect(views.every((view) => view.webContents.destroyed), 'all closed').toBe(true);
    expect(parking().destroyed, 'parking window destroyed').toBe(true);
  });
});

describe('ElectronViews: navigation and events', () => {
  it('loads an address and waits for the load to stop', async () => {
    electronViews.ensure('a', state({ url: 'about:blank' }));
    await electronViews.load('a', 'https://b.test/');
    expect(views[0]!.webContents.loads, 'loaded').toEqual(['https://b.test/']);
  });

  it('ignores an aborted load and reports any other failure with the address', async () => {
    electronViews.ensure('a', state({ url: 'about:blank' }));
    views[0]!.webContents.loadError = new Error('ERR_ABORTED (-3)');
    await expect(electronViews.load('a', 'https://b.test/'), 'aborted load').resolves.toBeUndefined();
    views[0]!.webContents.loadError = new Error('ERR_NAME_NOT_RESOLVED (-105)');
    await expect(electronViews.load('a', 'https://b.test/'), 'dns failure').rejects.toThrow('could not load https://b.test/: ERR_NAME_NOT_RESOLVED');
  });

  it('runs the history actions on the view', () => {
    electronViews.ensure('a', state());
    const contents = views[0]!.webContents;
    electronViews.history('a', 'back');
    electronViews.history('a', 'forward');
    electronViews.history('a', 'reload');
    electronViews.history('a', 'stop');
    expect([contents.navigationHistory.goBack.mock.calls.length, contents.navigationHistory.goForward.mock.calls.length, contents.reload.mock.calls.length, contents.stop.mock.calls.length], 'one call each').toEqual([1, 1, 1, 1]);
  });

  it('describes a view and says nothing about a leaf without one', () => {
    electronViews.ensure('a', state());
    views[0]!.webContents.url = 'https://a.test/x';
    expect(electronViews.info('a'), 'info').toMatchObject({ url: 'https://a.test/x', title: 'title', loading: false, crashed: false });
    views[0]!.webContents.url = '';
    expect(electronViews.info('a')?.url, 'blank when no url').toBe('about:blank');
    expect(electronViews.info('missing'), 'unknown leaf').toBeUndefined();
  });

  it('turns page events into tab events', () => {
    electronViews.ensure('a', state());
    const contents = views[0]!.webContents;
    contents.url = 'https://a.test/next';
    contents.navigationHistory.entries = [{ url: 'https://a.test/next', title: 'N' }];
    contents.emit('did-navigate');
    contents.emit('page-title-updated', {}, 'New title');
    contents.emit('render-process-gone');
    contents.emit('focus');
    contents.emit('blur');
    expect(events.map((event) => event.type), 'event order').toEqual(['navigated', 'title', 'crashed', 'focus', 'focus']);
    expect(events[0], 'navigated carries the history').toMatchObject({ url: 'https://a.test/next', history: { entries: [{ url: 'https://a.test/next', title: 'N' }], index: 0 } });
    expect(electronViews.info('a')?.crashed, 'crash flag').toBe(true);
  });

  it('clears the crash flag with the next load', async () => {
    electronViews.ensure('a', state());
    views[0]!.webContents.emit('render-process-gone');
    await electronViews.load('a', 'https://a.test/');
    expect(electronViews.info('a')?.crashed, 'cleared').toBe(false);
  });

  it('asks for another tab when the page navigates to another service', () => {
    electronViews.ensure('a', state({ service: 'web' }));
    const guarded = views[0]!.webContents;
    const event = { url: 'https://github.com/x', isMainFrame: true, preventDefault: vi.fn() };
    guarded.emit('will-navigate', event);
    expect(event.preventDefault, 'cancelled').toHaveBeenCalled();
    expect(events, 'open_tab event').toEqual([{ type: 'open_tab', leafId: 'a', url: 'https://github.com/x' }]);
  });

  it('cancels a navigation to a scheme that is not allowed without opening a tab', () => {
    electronViews.ensure('a', state());
    const event = { url: 'file:///etc/passwd', isMainFrame: true, preventDefault: vi.fn() };
    views[0]!.webContents.emit('will-navigate', event);
    expect(event.preventDefault, 'cancelled').toHaveBeenCalled();
    expect(events, 'no tab').toEqual([]);
  });

  it('denies every window.open of a sign-in pop-up of the view that the guard does not allow', () => {
    electronViews.ensure('a', state());
    const handler = views[0]!.webContents.windowOpenHandler as (details: { url: string }) => { action: string };
    expect(handler({ url: 'javascript:alert(1)' }).action, 'script URL').toBe('deny');
    expect(handler({ url: 'https://accounts.google.com/o/oauth2' }).action, 'sign-in pop-up').toBe('allow');
  });

  it('owns an allowed pop-up and denies its own pop-ups', () => {
    electronViews.ensure('a', state());
    const popup = { webContents: new FakeContents(), destroy: vi.fn() };
    views[0]!.webContents.emit('did-create-window', popup);
    expect(electronViews.owns(popup.webContents), 'popup owned').toBe(true);
    expect((popup.webContents.windowOpenHandler as () => { action: string })().action, 'no pop-up of a pop-up').toBe('deny');
    views[0]!.webContents.emit('destroyed');
    expect(popup.destroy, 'popup closed with the view').toHaveBeenCalled();
  });

  it('cancels a download that starts during an agent call and tells the module', () => {
    electronViews.ensure('a', state());
    electronViews.setActingProbe((leafId) => leafId === 'a');
    const session = sessions.get('persist:web')!;
    const download = { preventDefault: vi.fn() };
    session.emit('will-download', download, {}, views[0]!.webContents);
    expect(download.preventDefault, 'cancelled').toHaveBeenCalled();
    expect(events, 'event').toEqual([{ type: 'download_blocked', leafId: 'a' }]);
  });

  it('lets a download of the user proceed', () => {
    electronViews.ensure('a', state());
    const session = sessions.get('persist:web')!;
    const download = { preventDefault: vi.fn() };
    session.emit('will-download', download, {}, views[0]!.webContents);
    expect(download.preventDefault, 'not cancelled').not.toHaveBeenCalled();
    expect(events, 'no event').toEqual([]);
  });
});

describe('ElectronViews: page session and misc', () => {
  it('attaches the debugger once per page session and detaches it on detach', async () => {
    electronViews.ensure('a', state());
    const contents = views[0]!.webContents;
    contents.debugger.sendCommand.mockImplementation(async () => ({}));
    const first = await electronViews.page('a');
    const second = await electronViews.page('a');
    expect(second, 'same page session').toBe(first);
    expect(contents.debugger.attached, 'attached').toBe(true);
    electronViews.detach('a');
    expect(contents.debugger.attached, 'detached').toBe(false);
  });

  it('serves concurrent callers one attached session and tries again after a failed attach', async () => {
    electronViews.ensure('a', state());
    const contents = views[0]!.webContents;
    let release: () => void = () => undefined;
    contents.debugger.sendCommand.mockImplementationOnce(() => new Promise((resolve) => (release = () => resolve({}))));
    const first = electronViews.page('a');
    const second = electronViews.page('a');
    release();
    expect(await second, 'concurrent callers share the session').toBe(await first);

    electronViews.detach('a');
    contents.debugger.sendCommand.mockRejectedValueOnce(new Error('Page.enable failed'));
    await expect(electronViews.page('a'), 'failed attach').rejects.toThrow('Page.enable failed');
    contents.debugger.sendCommand.mockImplementation(async () => ({}));
    const again = await electronViews.page('a');
    expect(again, 'a later call attaches again and gets a session').toBeDefined();
    expect(contents.debugger.attached, 'attached after the retry').toBe(true);
  });

  it('detaches the debugger when the view is destroyed', async () => {
    electronViews.ensure('a', state());
    const contents = views[0]!.webContents;
    await electronViews.page('a');
    electronViews.destroy('a');
    expect(contents.debugger.attached, 'detached on destroy').toBe(false);
  });

  it('keeps the debugger attached for a live tab and arms the idle detach for others', async () => {
    vi.useFakeTimers();
    try {
      electronViews.ensure('a', state());
      electronViews.setLive('a', true);
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(views[0]!.webContents.debugger.attached, 'live tab stays attached').toBe(true);
      electronViews.setLive('a', false);
      await vi.advanceTimersByTimeAsync(6 * 60_000);
      expect(views[0]!.webContents.debugger.attached, 'idle tab detached').toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('forwards zoom, focus, developer tools, site data and external opening', async () => {
    electronViews.ensure('a', state());
    electronViews.zoom('a', 1.25);
    electronViews.focus('a');
    electronViews.openDevTools('a');
    await electronViews.clearSiteData('web');
    await electronViews.openExternal('https://example.test/');
    expect(views[0]!.webContents.zoom, 'zoom').toBe(1.25);
    expect(views[0]!.webContents.focus, 'focus').toHaveBeenCalled();
    expect(views[0]!.webContents.openDevTools, 'devtools detached').toHaveBeenCalledWith({ mode: 'detach' });
    expect(sessions.get('persist:web')!.clearStorageData, 'site data').toHaveBeenCalled();
    expect(openExternal, 'external').toHaveBeenCalledWith('https://example.test/');
  });
});
