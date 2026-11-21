import { BaseWindow, BrowserWindow, session as electronSession, shell, WebContentsView, type Session } from 'electron';
import { PageSession } from '../../core/browser/PageSession';
import type { HistoryAction, TabEvent, TabInfo } from '../../core/browser/runtime';
import type { BrowserTabState, ServiceId } from '../../core/browser/types';
import { partitionName } from '../../core/profile/partition';
import type { Bounds } from '../../core/surfaces/types';
import { debuggerTransport } from './cdpTransport';
import { attachGuards, setupPartition } from './guards';
import type { BrowserViews, ViewStill } from './views';
import { isAbortedLoad, isAgentDownload, nativeBounds, PARKED_BOUNDS, pickEvictionVictim } from './viewPlacement';

const MAX_LIVE = 8;
const IDLE_DETACH_MS = 5 * 60_000;
const LOAD_TIMEOUT_MS = 30_000;
const CAPTURE_RETRY_MS = 100;
const CAPTURE_CALL_CAP_MS = 2000;
const CAPTURE_CALL_FLOOR_MS = 500;

/** The image of the contents, or undefined when no frame arrives within `ms`. A late result is dropped. */
async function capturePageWithin(contents: WebContentsView['webContents'], ms: number): Promise<Awaited<ReturnType<WebContentsView['webContents']['capturePage']>> | undefined> {
  const capture = contents.capturePage();
  capture.catch(() => undefined);
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), Math.max(ms, 0));
  });
  try {
    return await Promise.race([capture, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

interface Entry {
  readonly leafId: string;
  readonly service: ServiceId;
  readonly view: WebContentsView;
  readonly transport: ReturnType<typeof debuggerTransport>;
  page?: PageSession | undefined;
  /** The attach in progress; callers that arrive meanwhile wait for it. */
  attaching?: Promise<void> | undefined;
  stopEvents?: (() => void) | undefined;
  bounds?: Bounds;
  placed: boolean;
  suspended: boolean;
  crashed: boolean;
  live: boolean;
  lastUsed: number;
  idleTimer?: ReturnType<typeof setTimeout>;
  lastActed: number;
}

export interface ElectronViewsOptions {
  /** Show the window's views; hidden test runs still place views, they just never show the window. */
  readonly mainWindow: () => BrowserWindow | undefined;
  /** The profile's data directory; a partition that stores its data elsewhere is refused. */
  readonly dataDir?: string;
}

/**
 * `WebContentsView` per recorded leaf (0026 section 1). A view that no surface host shows sits in a hidden
 * `BaseWindow`, because `setVisible(false)` stops frames and `Page.captureScreenshot` then never answers
 * (probe, 2026-11-17). Partitions are `persist:<service>` under the profile's data directory.
 */
export class ElectronViews implements BrowserViews {
  private readonly entries = new Map<string, Entry>();
  private readonly listeners = new Set<(event: TabEvent) => void>();
  private readonly sessions = new Map<ServiceId, Session>();
  private parking: BaseWindow | undefined;
  private actingProbe: (leafId: string) => boolean = () => false;
  private stateOf: (leafId: string) => BrowserTabState | undefined = () => undefined;
  private readonly owned = new WeakSet<object>();
  private requestPolicy: (leafId: string, url: string) => boolean = () => true;
  /** True between `suspend` and `resume`: a view placed meanwhile stays hidden until `resume`. */
  private allSuspended = false;

  constructor(private readonly options: ElectronViewsOptions) {}

  setStateSource(source: (leafId: string) => BrowserTabState | undefined): void {
    this.stateOf = source;
  }

  /** True for the webContents this module built, including allowed sign-in pop-ups. The deny-all backstop skips them. */
  owns(contents: object): boolean {
    return this.owned.has(contents);
  }

  onEvent(listener: (event: TabEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: TabEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  setActingProbe(probe: (leafId: string) => boolean): void {
    this.actingProbe = probe;
  }

  setRequestPolicy(policy: (leafId: string, url: string) => boolean): void {
    this.requestPolicy = policy;
  }

  private parkingWindow(): BaseWindow {
    this.parking ??= new BaseWindow({ show: false, width: 1280, height: 800, skipTaskbar: true });
    return this.parking;
  }

  private sessionFor(service: ServiceId): Session {
    let existing = this.sessions.get(service);
    if (existing) return existing;
    existing = electronSession.fromPartition(partitionName(service));
    setupPartition(existing, this.options.dataDir);
    existing.on('will-download', (event, _item, contents) => {
      const entry = [...this.entries.values()].find((candidate) => candidate.view.webContents === contents);
      if (entry && isAgentDownload({ acting: this.actingProbe(entry.leafId), lastActed: entry.lastActed, now: Date.now() })) {
        event.preventDefault();
        this.emit({ type: 'download_blocked', leafId: entry.leafId });
      }
    });
    existing.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (details, callback) => {
      const entry = [...this.entries.values()].find((candidate) => candidate.view.webContents.id === details.webContentsId);
      callback({ cancel: entry !== undefined && !this.requestPolicy(entry.leafId, details.url) });
    });
    this.sessions.set(service, existing);
    return existing;
  }

  ensure(leafId: string, state: BrowserTabState): void {
    if (this.entries.has(leafId)) return;
    this.evictIfNeeded();
    const service = state.service;
    const view = new WebContentsView({
      webPreferences: {
        session: this.sessionFor(service),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        backgroundThrottling: false,
      },
    });
    const entry: Entry = { leafId, service, view, transport: debuggerTransport(view.webContents.debugger), placed: false, suspended: false, crashed: false, live: false, lastUsed: Date.now(), lastActed: 0 };
    this.entries.set(leafId, entry);
    const contents = view.webContents;
    this.owned.add(contents);
    attachGuards(contents, service, { openTab: (url) => this.emit({ type: 'open_tab', leafId, url }) });
    contents.on('did-create-window', (popup) => {
      this.owned.add(popup.webContents);
      attachGuards(popup.webContents, service, { openTab: (url) => this.emit({ type: 'open_tab', leafId, url }) });
      popup.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      contents.once('destroyed', () => popup.destroy());
    });
    contents.on('did-navigate', () => this.navigated(entry));
    contents.on('did-navigate-in-page', () => this.navigated(entry));
    contents.on('page-title-updated', (_event, title) => this.emit({ type: 'title', leafId, title }));
    contents.on('render-process-gone', () => {
      entry.crashed = true;
      this.emit({ type: 'crashed', leafId });
    });
    contents.on('focus', () => this.emit({ type: 'focus', leafId, focused: true }));
    contents.on('blur', () => this.emit({ type: 'focus', leafId, focused: false }));
    contents.on('context-menu', () => undefined);
    this.parkingWindow().contentView.addChildView(view);
    view.setBounds(PARKED_BOUNDS);
    const history = state.history;
    if (history && history.entries.length > 0) {
      void contents.navigationHistory.restore({ index: history.index, entries: history.entries.map((e) => ({ url: e.url, title: e.title })) }).catch(() => void contents.loadURL(state.url).catch(() => undefined));
    } else if (state.url !== 'about:blank') {
      void contents.loadURL(state.url).catch(() => undefined);
    }
    contents.setZoomFactor(state.zoom);
  }

  private navigated(entry: Entry): void {
    const contents = entry.view.webContents;
    const entries = contents.navigationHistory.getAllEntries().map((e) => ({ url: e.url, title: e.title }));
    this.emit({ type: 'navigated', leafId: entry.leafId, url: contents.getURL(), title: contents.getTitle(), history: { entries, index: contents.navigationHistory.getActiveIndex() } });
  }

  private evictIfNeeded(): void {
    const victim = pickEvictionVictim([...this.entries.values()], MAX_LIVE);
    if (victim !== undefined) this.destroy(victim);
  }

  info(leafId: string): TabInfo | undefined {
    const entry = this.entries.get(leafId);
    if (!entry || entry.view.webContents.isDestroyed()) return undefined;
    const contents = entry.view.webContents;
    return {
      url: contents.getURL() || 'about:blank',
      title: contents.getTitle(),
      loading: contents.isLoading(),
      canGoBack: contents.navigationHistory.canGoBack(),
      canGoForward: contents.navigationHistory.canGoForward(),
      crashed: entry.crashed,
    };
  }

  private require(leafId: string): Entry {
    const entry = this.entries.get(leafId);
    if (entry) {
      entry.lastUsed = Date.now();
      return entry;
    }
    const state = this.stateOf(leafId);
    if (!state) throw new Error(`no browser tab ${leafId}`);
    this.ensure(leafId, state);
    const created = this.entries.get(leafId);
    if (!created) throw new Error(`could not create the view of ${leafId}`);
    return created;
  }

  async page(leafId: string): Promise<PageSession> {
    const entry = this.require(leafId);
    entry.lastActed = Date.now();
    if (!entry.page) {
      entry.transport.attach();
      const page = new PageSession({
        transport: entry.transport,
        cookies: async () => (await this.sessionFor(entry.service).cookies.get({})).map((cookie) => ({ value: cookie.value })),
      });
      entry.page = page;
      entry.stopEvents = entry.transport.onEvent((method) => {
        if (method === 'Page.javascriptDialogOpening') this.emit({ type: 'dialog', leafId, open: true });
        if (method === 'Page.javascriptDialogClosed') this.emit({ type: 'dialog', leafId, open: false });
      });
      entry.attaching = page.attach().catch((error: unknown) => {
        this.detach(leafId);
        throw error;
      });
    }
    try {
      await entry.attaching;
    } finally {
      if (entry.page !== undefined) entry.attaching = undefined;
    }
    const page = entry.page;
    if (page === undefined) throw new Error(`the debugger could not attach to ${leafId}`);
    this.armIdle(entry);
    return page;
  }

  private armIdle(entry: Entry): void {
    clearTimeout(entry.idleTimer);
    if (entry.live) return;
    entry.idleTimer = setTimeout(() => this.detach(entry.leafId), IDLE_DETACH_MS);
    entry.idleTimer.unref?.();
  }

  detach(leafId: string): void {
    const entry = this.entries.get(leafId);
    if (!entry) return;
    clearTimeout(entry.idleTimer);
    entry.page?.detach();
    entry.page = undefined;
    entry.attaching = undefined;
    entry.stopEvents?.();
    entry.stopEvents = undefined;
    try {
      entry.transport.detach();
    } catch {
      // The debugger detaches itself when the contents are gone.
    }
  }

  setLive(leafId: string, live: boolean): void {
    const entry = this.entries.get(leafId);
    if (!entry) return;
    entry.live = live;
    if (live) void this.page(leafId).catch(() => undefined);
    else this.armIdle(entry);
  }

  async load(leafId: string, url: string): Promise<void> {
    const entry = this.require(leafId);
    entry.crashed = false;
    const contents = entry.view.webContents;
    const loaded = new Promise<void>((resolve) => {
      const timer = setTimeout(() => done(), LOAD_TIMEOUT_MS);
      timer.unref?.();
      const done = (): void => {
        clearTimeout(timer);
        contents.removeListener('did-stop-loading', done);
        resolve();
      };
      contents.on('did-stop-loading', done);
    });
    try {
      await contents.loadURL(url);
    } catch (error) {
      // A load that fails (certificate, DNS) leaves the error page; the caller reads the state afterwards.
      if (!isAbortedLoad(error)) throw new Error(`could not load ${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
    await loaded;
  }

  history(leafId: string, action: HistoryAction): void {
    const contents = this.require(leafId).view.webContents;
    if (action === 'back') contents.navigationHistory.goBack();
    else if (action === 'forward') contents.navigationHistory.goForward();
    else if (action === 'reload') contents.reload();
    else contents.stop();
  }

  place(leafId: string, bounds: Bounds, visible: boolean): void {
    const window = this.options.mainWindow();
    if (!visible || !window) {
      const existing = this.entries.get(leafId);
      if (existing) this.park(existing);
      return;
    }
    const entry = this.require(leafId);
    const factor = window.webContents.getZoomFactor();
    if (!entry.placed) {
      window.contentView.addChildView(entry.view);
      entry.placed = true;
    }
    entry.bounds = bounds;
    entry.view.setBounds(nativeBounds(bounds, factor));
    if (this.allSuspended) {
      entry.suspended = true;
      entry.view.setVisible(false);
    } else if (!entry.suspended) entry.view.setVisible(true);
  }

  private park(entry: Entry): void {
    if (!entry.placed) return;
    entry.placed = false;
    entry.view.setVisible(true);
    this.parkingWindow().contentView.addChildView(entry.view);
    entry.view.setBounds(PARKED_BOUNDS);
  }

  /**
   * PNG data URL of the view once it has a painted frame, or undefined when none arrives within `patienceMs`.
   * Without patience one call is made, cut at the call cap. With patience a call is cut at the time left, but at
   * least the floor, so a slow first frame of a painted view is not dropped. No call starts at or after the
   * deadline, so a capture returns after `patienceMs` plus the floor at most.
   */
  private async captureStill(entry: Entry, patienceMs: number): Promise<string | undefined> {
    const contents = entry.view.webContents;
    const deadline = Date.now() + patienceMs;
    for (;;) {
      try {
        const callMs = patienceMs === 0 ? CAPTURE_CALL_CAP_MS : Math.max(deadline - Date.now(), Math.min(CAPTURE_CALL_CAP_MS, CAPTURE_CALL_FLOOR_MS));
        const image = await capturePageWithin(contents, callMs);
        if (image !== undefined && !image.isEmpty() && image.toBitmap().some((byte) => byte !== 0)) return `data:image/png;base64,${image.toPNG().toString('base64')}`;
      } catch {
        // No display surface yet, or the contents are going away.
      }
      if (contents.isDestroyed() || Date.now() >= deadline) return undefined;
      await new Promise((resolve) => setTimeout(resolve, CAPTURE_RETRY_MS));
      if (Date.now() >= deadline) return undefined;
    }
  }

  async visibleViews(capture: boolean | ((leafId: string) => boolean), patienceMs = 0): Promise<ViewStill[]> {
    const wanted = typeof capture === 'function' ? capture : () => capture;
    const shown = [...this.entries.values()].filter((entry) => entry.placed && entry.bounds !== undefined);
    return Promise.all(
      shown.map(async (entry) => {
        const bounds = entry.bounds as Bounds;
        if (!wanted(entry.leafId)) return { leafId: entry.leafId, bounds };
        const dataUrl = await this.captureStill(entry, patienceMs);
        return dataUrl === undefined ? { leafId: entry.leafId, bounds } : { leafId: entry.leafId, bounds, dataUrl };
      }),
    );
  }

  async suspend(): Promise<ViewStill[]> {
    this.allSuspended = true;
    const stills = await this.visibleViews(true);
    for (const still of stills) {
      const entry = this.entries.get(still.leafId);
      if (!entry) continue;
      entry.suspended = true;
      entry.view.setVisible(false);
    }
    return stills;
  }

  resume(): void {
    this.allSuspended = false;
    for (const entry of this.entries.values()) {
      if (!entry.suspended) continue;
      entry.suspended = false;
      if (entry.placed) entry.view.setVisible(true);
    }
  }

  async clearSiteData(service: ServiceId): Promise<void> {
    await this.sessionFor(service).clearStorageData();
  }

  openDevTools(leafId: string): void {
    this.require(leafId).view.webContents.openDevTools({ mode: 'detach' });
  }

  zoom(leafId: string, factor: number): void {
    this.require(leafId).view.webContents.setZoomFactor(factor);
  }

  focus(leafId: string): void {
    this.require(leafId).view.webContents.focus();
  }

  destroy(leafId: string): void {
    const entry = this.entries.get(leafId);
    if (!entry) return;
    this.detach(leafId);
    this.entries.delete(leafId);
    const owner = entry.placed ? this.options.mainWindow() : this.parking;
    try {
      owner?.contentView.removeChildView(entry.view);
    } catch {
      // The window is closing.
    }
    if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close();
  }

  dispose(): void {
    for (const leafId of [...this.entries.keys()]) this.destroy(leafId);
    this.parking?.destroy();
    this.parking = undefined;
  }

  openExternal(url: string): Promise<void> {
    return shell.openExternal(url);
  }
}
