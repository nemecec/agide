export interface FrameOrigins {
  /** `file:` URL of the directory that holds the built renderer. */
  readonly rendererDirUrl: string;
  /** The dev server of `pnpm dev`; absent in a packaged app, so the privileged preload loads only the app's own page. */
  readonly devServerUrl?: string | undefined;
}

/** True for a frame URL that belongs to the app: its own built page, or the dev server. A URL that does not parse is foreign. */
export function isAppFrameUrl(url: string, origins: FrameOrigins): boolean {
  if (url.startsWith(`${origins.rendererDirUrl}/`)) return true;
  if (origins.devServerUrl === undefined) return false;
  try {
    return new URL(url).origin === new URL(origins.devServerUrl).origin;
  } catch {
    return false;
  }
}

export interface WindowOpenDecision {
  readonly action: 'deny';
  /** Set for a web link, which the default browser opens. */
  readonly openExternal?: string;
}

/** A page of the app never opens a window of its own; a web link goes to the default browser. */
export function decideWindowOpen(url: string): WindowOpenDecision {
  return /^https?:/.test(url) ? { action: 'deny', openExternal: url } : { action: 'deny' };
}

/** The renderer is sandboxed and isolated and has no Node. */
export function mainWindowWebPreferences(preloadPath: string) {
  return { preload: preloadPath, contextIsolation: true, sandbox: true, nodeIntegration: false } as const;
}
