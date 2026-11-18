import { ALLOWED_PERMISSIONS, checkUrl, decideTopLevel, decideWindowOpen } from '../../core/browser/addressPolicy';
import type { ServiceId } from '../../core/browser/types';
import { isUnderDataDir } from '../../core/profile/partition';

/** The parts of an Electron `webContents` the guards use, so the unit tests need no Electron. */
export interface GuardedContents {
  on(event: string, listener: (...args: any[]) => void): unknown;
  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' | 'allow'; overrideBrowserWindowOptions?: object }): void;
}

export interface GuardHooks {
  /** The tab opens another tab next to itself (cross-service link, `window.open`). */
  openTab(url: string): void;
  /** A navigation was cancelled; `reason` is for logs and tests. */
  blocked?(url: string, reason: string): void;
}

interface NavigationDetails {
  readonly url: string;
  readonly isMainFrame?: boolean;
  preventDefault(): void;
}

/**
 * Navigation, window.open and webview policy of one browser webContents (0026 section 5). Attached before the
 * first `loadURL`, so no load escapes it.
 */
export function attachGuards(contents: GuardedContents, service: ServiceId, hooks: GuardHooks): void {
  const check = (redirect: boolean) => (details: NavigationDetails) => {
    if (details.isMainFrame === false) {
      const verdict = checkUrl(details.url, 'page');
      if (!verdict.allow) {
        details.preventDefault();
        hooks.blocked?.(details.url, verdict.reason);
      }
      return;
    }
    const decision = decideTopLevel({ current: service, url: details.url, source: 'page', redirect });
    if (decision.action === 'allow') return;
    details.preventDefault();
    if (decision.action === 'open_tab') hooks.openTab(decision.url);
    else hooks.blocked?.(details.url, decision.reason);
  };
  contents.on('will-navigate', check(false));
  contents.on('will-frame-navigate', check(false));
  contents.on('will-redirect', check(true));
  contents.on('will-attach-webview', (event: { preventDefault(): void }) => event.preventDefault());
  contents.setWindowOpenHandler(({ url }) => {
    const decision = decideWindowOpen({ current: service, url });
    if (decision.action === 'allow-signin-popup') {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: { width: 520, height: 700, ...(process.env['AGIDE_HIDDEN'] === '1' ? { show: false } : {}), webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } },
      };
    }
    if (decision.openTab) hooks.openTab(decision.openTab.url);
    else hooks.blocked?.(url, 'window.open target is not allowed');
    return { action: 'deny' };
  });
}

/** The parts of an Electron `Session` the partition setup uses. */
export interface GuardedSession {
  setPermissionRequestHandler(handler: ((contents: unknown, permission: string, callback: (granted: boolean) => void) => void) | null): void;
  setPermissionCheckHandler(handler: ((contents: unknown, permission: string) => boolean) | null): void;
  setDevicePermissionHandler(handler: (() => boolean) | null): void;
  setDisplayMediaRequestHandler(handler: ((request: unknown, callback: (streams: object) => void) => void) | null): void;
  getStoragePath(): string | null | undefined;
}

/**
 * Denies every permission except fullscreen and sanitized clipboard writes, devices and screen capture (0026 section 2).
 * With `dataDir` it also refuses a partition whose storage lies outside the profile's data directory, so site data
 * of one profile never lands in another's.
 */
export function setupPartition(session: GuardedSession, dataDir?: string): void {
  const storage = dataDir === undefined ? undefined : session.getStoragePath();
  if (dataDir !== undefined && typeof storage === 'string' && !isUnderDataDir(storage, dataDir)) {
    throw new Error(`the browser partition stores its data outside the profile data directory: ${storage}`);
  }
  session.setPermissionRequestHandler((_contents, permission, callback) => callback(ALLOWED_PERMISSIONS.includes(permission)));
  session.setPermissionCheckHandler((_contents, permission) => ALLOWED_PERMISSIONS.includes(permission));
  session.setDevicePermissionHandler(() => false);
  session.setDisplayMediaRequestHandler((_request, callback) => callback({}));
}
