import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { attachGuards, setupPartition, type GuardedContents, type GuardedSession } from './guards';
import { debuggerTransport, type DebuggerLike } from './cdpTransport';
import { overlayScript, removeOverlayScript, STILL_Z_INDEX } from './capture';
import { openInChrome } from './openInChrome';
import { isUnderDataDir } from '../../core/profile/partition';

class FakeContents extends EventEmitter implements GuardedContents {
  handler: ((details: { url: string }) => { action: string; overrideBrowserWindowOptions?: object }) | undefined;
  setWindowOpenHandler(handler: NonNullable<FakeContents['handler']>): void {
    this.handler = handler;
  }
  navigate(event: string, url: string, isMainFrame = true): boolean {
    let prevented = false;
    this.emit(event, { url, isMainFrame, preventDefault: () => (prevented = true) });
    return prevented;
  }
}

function guarded(service: 'web' | 'jira' | 'github' = 'jira') {
  const contents = new FakeContents();
  const opened: string[] = [];
  const blocked: string[] = [];
  attachGuards(contents, service, { openTab: (url) => opened.push(url), blocked: (url) => blocked.push(url) });
  return { contents, opened, blocked };
}

describe('navigation guards', () => {
  it('cancel navigation to a scheme outside http, https and about:blank on will-navigate, will-frame-navigate and will-redirect', () => {
    const { contents, blocked } = guarded();
    for (const event of ['will-navigate', 'will-frame-navigate', 'will-redirect']) {
      for (const url of ['file:///etc/passwd', 'data:text/html,x', 'javascript:alert(1)', 'chrome://gpu']) expect(contents.navigate(event, url), `${event} ${url}`).toBe(true);
    }
    expect(blocked.length, 'reported').toBe(12);
  });

  it('cancels a cross-service navigation and opens a tab of the target, but lets redirects stay in the tab', () => {
    const { contents, opened } = guarded('jira');
    expect(contents.navigate('will-navigate', 'https://github.com/acme/app/pull/1'), 'cross-service link').toBe(true);
    expect(opened, 'opened as a tab').toEqual(['https://github.com/acme/app/pull/1']);
    expect(contents.navigate('will-redirect', 'https://github.com/login'), 'redirect stays').toBe(false);
    expect(contents.navigate('will-navigate', 'https://acme.atlassian.net/browse/A-1'), 'same service').toBe(false);
    expect(contents.navigate('will-navigate', 'https://id.atlassian.com/login'), 'sign-in host').toBe(false);
  });

  it('checks the scheme of sub-frame navigation but not the service', () => {
    const { contents } = guarded('jira');
    expect(contents.navigate('will-frame-navigate', 'https://github.com/embed', false), 'cross-origin frame').toBe(false);
    expect(contents.navigate('will-frame-navigate', 'file:///etc/passwd', false), 'file frame').toBe(true);
  });

  it('denies window.open and turns it into a tab, except sign-in pop-ups', () => {
    const { contents, opened } = guarded('web');
    expect(contents.handler?.({ url: 'https://example.com/a' }), 'target blank').toEqual({ action: 'deny' });
    expect(opened, 'became a tab').toEqual(['https://example.com/a']);
    expect(contents.handler?.({ url: 'javascript:alert(1)' }), 'javascript target').toEqual({ action: 'deny' });
    expect(opened.length, 'no tab for javascript').toBe(1);
    const popup = contents.handler?.({ url: 'https://accounts.google.com/o/oauth2/v2/auth' });
    expect(popup?.action, 'sign-in pop-up allowed').toBe('allow');
    expect(JSON.stringify(popup?.overrideBrowserWindowOptions), 'sandboxed child window').toContain('"sandbox":true');
  });

  it('prevents webview attachment', () => {
    const { contents } = guarded();
    let prevented = false;
    contents.emit('will-attach-webview', { preventDefault: () => (prevented = true) });
    expect(prevented, 'webview').toBe(true);
  });
});

describe('partition setup', () => {
  it('denies every permission except fullscreen and sanitized clipboard writes, devices and screen capture', () => {
    const handlers: Record<string, (...args: never[]) => unknown> = {};
    const session: GuardedSession = {
      setPermissionRequestHandler: (handler) => void (handlers['request'] = handler as never),
      setPermissionCheckHandler: (handler) => void (handlers['check'] = handler as never),
      setDevicePermissionHandler: (handler) => void (handlers['device'] = handler as never),
      setDisplayMediaRequestHandler: (handler) => void (handlers['display'] = handler as never),
      getStoragePath: () => '/data/Partitions/jira',
    };
    setupPartition(session);
    const request = handlers['request'] as unknown as (c: unknown, p: string, cb: (granted: boolean) => void) => void;
    const check = handlers['check'] as unknown as (c: unknown, p: string) => boolean;
    const granted = (permission: string): boolean => {
      let answer: boolean | undefined;
      request(undefined, permission, (value) => (answer = value));
      return answer === true;
    };
    for (const permission of ['notifications', 'geolocation', 'media', 'midi', 'clipboard-read', 'hid', 'serial', 'usb']) {
      expect(granted(permission), `request ${permission}`).toBe(false);
      expect(check(undefined, permission), `check ${permission}`).toBe(false);
    }
    expect(granted('fullscreen'), 'fullscreen').toBe(true);
    expect(check(undefined, 'clipboard-sanitized-write'), 'clipboard write').toBe(true);
    expect((handlers['device'] as unknown as () => boolean)(), 'devices').toBe(false);
    let streams: object | undefined;
    (handlers['display'] as unknown as (r: unknown, cb: (s: object) => void) => void)(undefined, (value) => (streams = value));
    expect(streams, 'screen capture gets no stream').toEqual({});
  });

  it('refuses a partition whose storage lies outside the profile data directory and accepts one inside', () => {
    const session = (path: string | null): GuardedSession => ({
      setPermissionRequestHandler: () => undefined,
      setPermissionCheckHandler: () => undefined,
      setDevicePermissionHandler: () => undefined,
      setDisplayMediaRequestHandler: () => undefined,
      getStoragePath: () => path,
    });
    expect(() => setupPartition(session('/data/profile/Partitions/jira'), '/data/profile'), 'inside').not.toThrow();
    expect(() => setupPartition(session('/data/other/Partitions/jira'), '/data/profile'), 'outside').toThrow('outside the profile data directory');
    expect(() => setupPartition(session(null), '/data/profile'), 'in-memory partition has no path').not.toThrow();
  });

  it('knows whether a storage path lies under the data directory', () => {
    expect(isUnderDataDir('/data/profile/Partitions/jira', '/data/profile'), 'inside').toBe(true);
    expect(isUnderDataDir('/data/other/Partitions/jira', '/data/profile'), 'outside').toBe(false);
    expect(isUnderDataDir('/data/profile/../other', '/data/profile'), 'dot dot').toBe(false);
  });
});

describe('debugger transport', () => {
  it('attaches once, because a second attach throws, and forwards commands and events', async () => {
    let attached = false;
    let attaches = 0;
    const listeners = new Set<(event: unknown, method: string, params: Record<string, unknown>) => void>();
    const api: DebuggerLike = {
      isAttached: () => attached,
      attach: () => {
        if (attached) throw new Error('Debugger is already attached to the target');
        attached = true;
        attaches += 1;
      },
      detach: () => void (attached = false),
      sendCommand: async (method, params) => ({ method, params }),
      on: (_event, listener) => void listeners.add(listener),
      removeListener: (_event, listener) => void listeners.delete(listener),
    };
    const transport = debuggerTransport(api);
    transport.attach();
    transport.attach();
    expect(attaches, 'attached once').toBe(1);
    expect(await transport.send('Page.enable'), 'command forwarded').toEqual({ method: 'Page.enable', params: {} });
    const seen: string[] = [];
    const stop = transport.onEvent((method) => seen.push(method));
    for (const listener of listeners) listener(undefined, 'Page.loadEventFired', {});
    stop();
    expect(listeners.size, 'unsubscribed').toBe(0);
    expect(seen, 'event forwarded').toEqual(['Page.loadEventFired']);
    transport.detach();
    transport.detach();
    expect(attached, 'detached').toBe(false);
  });
});

describe('window capture composition', () => {
  it('draws shared views as images and every other view as a "not shared" mask', () => {
    const script = overlayScript([
      { leafId: 'a', bounds: { x: 1, y: 2, width: 30, height: 40 }, dataUrl: 'data:image/png;base64,AAAA', shared: true },
      { leafId: 'b', bounds: { x: 5, y: 6, width: 7, height: 8 }, dataUrl: 'data:image/png;base64,BBBB', shared: false },
    ]);
    expect(script, 'shared image present').toContain('AAAA');
    expect(script, 'the image of a view that is not shared never enters the script').not.toContain('BBBB');
    expect(script, 'mask text').toContain('not shared');
    expect(script, 'masked pane in the DOM wins').toContain('data-capture-mask');
    expect(script, 'stills sit below dialogs, menus and popovers').toContain(`z-index:${STILL_Z_INDEX};`);
    expect(script, 'a still is not drawn over everything').not.toContain('2147483647');
    expect(removeOverlayScript, 'removal').toContain('data-capture-view');
  });

  it('labels a shared view without a capture "page not captured" and waits for the images to decode', () => {
    const script = overlayScript([
      { leafId: 'a', bounds: { x: 1, y: 2, width: 30, height: 40 }, shared: true },
      { leafId: 'b', bounds: { x: 5, y: 6, width: 7, height: 8 }, shared: false },
    ]);
    expect(script, 'a shared view with no still carries the unavailable label').toContain('"label":"page not captured"');
    expect(script, 'a view that is not shared keeps its label').toContain('"label":"not shared"');
    expect(script, 'the script waits for decode before it counts frames').toMatch(/\.decode\(\)[\s\S]*requestAnimationFrame/);
  });
});

describe('window capture composition of masked panes', () => {
  it('draws the "not shared" mask, without the still, over a slot that sits in a masked pane when the script runs', () => {
    const script = overlayScript([{ leafId: 'a', bounds: { x: 1, y: 2, width: 30, height: 40 }, dataUrl: 'data:image/png;base64,AAAA', shared: true }]);
    expect(script, 'the slot is looked up in the live document and the still is dropped').toMatch(/closest\('\[data-capture-mask\]'\)\) \{\s*item\.dataUrl = null;\s*item\.label = "not shared";/);
  });
});

describe('open in Chrome', () => {
  it('opens the exact URL with Chrome through open -b, and falls back to the default browser', async () => {
    const calls: string[][] = [];
    const opened: string[] = [];
    const url = 'https://github.com/acme/app/pull/1?x=1#frag';
    expect(await openInChrome(url, { execFile: async (file, args) => void calls.push([file, ...args]), openExternal: async (target) => void opened.push(target) }), 'chrome').toEqual({ opened: 'chrome' });
    expect(calls, 'command').toEqual([['open', '-b', 'com.google.Chrome', url]]);
    expect(await openInChrome(url, { execFile: async () => Promise.reject(new Error('no chrome')), openExternal: async (target) => void opened.push(target) }), 'fallback').toEqual({ opened: 'default' });
    expect(opened, 'default browser got the same URL').toEqual([url]);
  });

  it('refuses a URL the address policy does not allow and an empty tab', async () => {
    const deps = { execFile: async () => undefined, openExternal: async () => undefined };
    await expect(openInChrome('file:///etc/passwd', deps), 'file URL').rejects.toThrow('scheme is not allowed');
    await expect(openInChrome('about:blank', deps), 'empty tab').rejects.toThrow('nothing to open');
  });
});
