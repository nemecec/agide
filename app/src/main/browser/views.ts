import type { TabEvent, TabRuntime } from '../../core/browser/runtime';
import type { BrowserTabState, ServiceId } from '../../core/browser/types';
import type { Bounds } from '../../core/surfaces/types';

/** One visible view captured for a drag or a window capture. */
export interface ViewStill {
  readonly leafId: string;
  /** CSS pixels of the app window, as the renderer reported them. */
  readonly bounds: Bounds;
  /** `data:image/png;base64,...`; absent when the capture failed. */
  readonly dataUrl?: string;
}

/**
 * The Electron side of the browser module (0026 section 1): `WebContentsView` per recorded leaf, parking,
 * partitions and guards. `main/index.ts` passes the implementation through `ModuleContext.browserViews`; tests
 * that run without Electron leave it out or pass a fake. Owner: w-browser.
 */
export interface BrowserViews extends TabRuntime {
  /** Shows the view of a leaf at `bounds` (CSS pixels of the app window), or parks it. */
  place(leafId: string, bounds: Bounds, visible: boolean): void;
  /** Destroys the view and its webContents. */
  destroy(leafId: string): void;
  /** Page events of every view. */
  onEvent(listener: (event: TabEvent) => void): () => void;
  /** Keeps the debugger attached from load (`live` mode) or lets it detach after idle time again. */
  setLive(leafId: string, live: boolean): void;
  /** Captures every visible view and hides them; the renderer draws the stills in their slots. */
  suspend(): Promise<ViewStill[]>;
  /** Shows the views `suspend` hid. */
  resume(): void;
  /** The views that are placed in the window now, with a capture of each when `capture` is true. */
  visibleViews(capture: boolean): Promise<ViewStill[]>;
  clearSiteData(service: ServiceId): Promise<void>;
  openDevTools(leafId: string): void;
  zoom(leafId: string, factor: number): void;
  /** The tab is the one the user last clicked or focused; tools reveal tabs without taking keyboard focus. */
  focus(leafId: string): void;
  /** True while an acting call runs or ended less than 2 s ago, so a download that starts is cancelled. */
  setActingProbe(probe: (leafId: string) => boolean): void;
  /** Decides whether a request of a tab may leave; a refused request is cancelled. */
  setRequestPolicy(policy: (leafId: string, url: string) => boolean): void;
  /** Opens a URL in the default browser (fallback of "Open in Chrome"). */
  openExternal(url: string): Promise<void>;
  /** The module gives the views its tab states, so a view can be created again for a restored tab. */
  setStateSource(source: (leafId: string) => BrowserTabState | undefined): void;
}
