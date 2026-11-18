import type { PageSession } from './PageSession';
import type { BrowserTabState } from './types';

/** What the Electron side knows about a tab's page right now. */
export interface TabInfo {
  readonly url: string;
  readonly title: string;
  readonly loading: boolean;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly crashed: boolean;
}

export type HistoryAction = 'back' | 'forward' | 'reload' | 'stop';

/**
 * The Electron side of a tab as the core sees it (0026 section 1): a view per recorded leaf, created on demand,
 * a debugger attached on the first tool call. Implemented by `main/browser`; tests use a fake.
 */
export interface TabRuntime {
  /** Creates the view when needed (restored tabs have none until shown or called) and loads the tab's URL. */
  ensure(leafId: string, state: BrowserTabState): void;
  info(leafId: string): TabInfo | undefined;
  /** The page of a tab with the debugger attached; attaches on the first call. */
  page(leafId: string): Promise<PageSession>;
  /** Detaches the debugger, such as when observation goes off. */
  detach(leafId: string): void;
  /** Loads a URL that already passed the address policy. */
  load(leafId: string, url: string): Promise<void>;
  history(leafId: string, action: HistoryAction): void;
  destroy(leafId: string): void;
}

/** A page event the module turns into state, digest and tree changes. */
export type TabEvent =
  | { readonly type: 'navigated'; readonly leafId: string; readonly url: string; readonly title: string; readonly history?: NonNullable<BrowserTabState['history']> }
  | { readonly type: 'title'; readonly leafId: string; readonly title: string }
  | { readonly type: 'crashed'; readonly leafId: string }
  | { readonly type: 'dialog'; readonly leafId: string; readonly open: boolean }
  | { readonly type: 'focus'; readonly leafId: string; readonly focused: boolean }
  /** A cross-service link or `window.open`: the module opens a tab of the target service next to the source. */
  | { readonly type: 'open_tab'; readonly leafId: string; readonly url: string }
  | { readonly type: 'download_blocked'; readonly leafId: string };
