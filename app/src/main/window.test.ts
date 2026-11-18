import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  options: undefined as Record<string, unknown> | undefined,
  openHandler: undefined as ((details: { url: string }) => { action: string }) | undefined,
  contentsListeners: new Map<string, (event: { preventDefault: () => void }) => void>(),
  windowListeners: new Map<string, (event: { preventDefault: () => void }) => void>(),
  permissionRequest: undefined as ((a: unknown, b: unknown, cb: (granted: boolean) => void) => void) | undefined,
  permissionCheck: undefined as (() => boolean) | undefined,
  loaded: [] as string[],
  openExternal: vi.fn(),
  packaged: true,
}));

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return state.packaged;
    },
  },
  shell: { openExternal: state.openExternal },
  BrowserWindow: class {
    constructor(options: Record<string, unknown>) {
      state.options = options;
    }
    on(name: string, listener: (event: { preventDefault: () => void }) => void) {
      state.windowListeners.set(name, listener);
    }
    once() {}
    show() {}
    loadFile(path: string) {
      state.loaded.push(`file:${path}`);
    }
    loadURL(url: string) {
      state.loaded.push(`url:${url}`);
    }
    webContents = {
      session: {
        setPermissionRequestHandler: (handler: typeof state.permissionRequest) => (state.permissionRequest = handler),
        setPermissionCheckHandler: (handler: typeof state.permissionCheck) => (state.permissionCheck = handler),
      },
      setWindowOpenHandler: (handler: typeof state.openHandler) => (state.openHandler = handler),
      on: (name: string, listener: (event: { preventDefault: () => void }) => void) => state.contentsListeners.set(name, listener),
    };
  },
}));

const { createMainWindow, isAppFrameUrl } = await import('./window');

beforeEach(() => {
  state.options = undefined;
  state.openHandler = undefined;
  state.contentsListeners.clear();
  state.windowListeners.clear();
  state.loaded.length = 0;
  state.openExternal.mockClear();
  state.packaged = true;
  delete process.env['ELECTRON_RENDERER_URL'];
});

describe('createMainWindow: DevTools', () => {
  it('turns the DevTools of the app window off in a packaged build and on in development', () => {
    createMainWindow({ show: false });
    expect((state.options?.['webPreferences'] as { devTools: boolean }).devTools, 'packaged').toBe(false);
    state.packaged = false;
    createMainWindow({ show: false });
    expect((state.options?.['webPreferences'] as { devTools: boolean }).devTools, 'development').toBe(true);
  });
});

describe('createMainWindow', () => {
  it('creates a sandboxed, isolated window with the preload and no Node', () => {
    createMainWindow({ show: false });
    expect(state.options?.['webPreferences'], 'web preferences').toMatchObject({ contextIsolation: true, sandbox: true, nodeIntegration: false });
    expect(String((state.options?.['webPreferences'] as { preload: string }).preload), 'preload path').toMatch(/preload[\\/]index\.cjs$/);
  });

  it('denies window.open and opens web links in the browser only', () => {
    createMainWindow({ show: false });
    expect(state.openHandler?.({ url: 'https://example.com/x' }), 'web link').toEqual({ action: 'deny' });
    expect(state.openExternal, 'web link goes to the browser').toHaveBeenCalledWith('https://example.com/x');
    state.openExternal.mockClear();
    expect(state.openHandler?.({ url: 'file:///etc/passwd' }), 'file url').toEqual({ action: 'deny' });
    expect(state.openExternal, 'file url is not opened').not.toHaveBeenCalled();
  });

  it('cancels every navigation of the window', () => {
    createMainWindow({ show: false });
    const event = { preventDefault: vi.fn() };
    state.contentsListeners.get('will-navigate')?.(event);
    expect(event.preventDefault, 'navigation cancelled').toHaveBeenCalled();
  });

  it('denies every web permission', () => {
    createMainWindow({ show: false });
    const callback = vi.fn();
    state.permissionRequest?.({}, 'notifications', callback);
    expect(callback, 'request answer').toHaveBeenCalledWith(false);
    expect(state.permissionCheck?.(), 'check answer').toBe(false);
  });

  it('keeps the profile name as the window title', () => {
    createMainWindow({ show: false, title: 'Work · Agide' });
    const event = { preventDefault: vi.fn() };
    state.windowListeners.get('page-title-updated')?.(event);
    expect(state.options?.['title'], 'title').toBe('Work · Agide');
    expect(event.preventDefault, 'page title does not replace it').toHaveBeenCalled();
  });

  it('loads the built page, or the dev server when unpackaged', () => {
    createMainWindow({ show: false });
    expect(state.loaded[0], 'built page').toMatch(/^file:.*renderer[\\/]index\.html$/);
    state.packaged = false;
    process.env['ELECTRON_RENDERER_URL'] = 'http://localhost:5173';
    createMainWindow({ show: false });
    expect(state.loaded[1], 'dev server').toBe('url:http://localhost:5173');
  });
});

describe('isAppFrameUrl', () => {
  it('trusts the dev server only in an unpackaged app', () => {
    process.env['ELECTRON_RENDERER_URL'] = 'http://localhost:5173';
    state.packaged = true;
    expect(isAppFrameUrl('http://localhost:5173/'), 'packaged app ignores the dev server').toBe(false);
    state.packaged = false;
    expect(isAppFrameUrl('http://localhost:5173/'), 'unpackaged app trusts it').toBe(true);
    expect(isAppFrameUrl('http://localhost:9999/'), 'other origin').toBe(false);
  });
});
