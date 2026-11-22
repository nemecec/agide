import type { RendererApi } from '../shared/ipc';

declare global {
  interface Window {
    readonly api: RendererApi;
    /** Test seam: the preload's `api` cannot be redefined, so a test sets its own wrapper here. */
    __agideApi?: RendererApi;
  }
}

export const api = (): RendererApi => window.__agideApi ?? window.api;
