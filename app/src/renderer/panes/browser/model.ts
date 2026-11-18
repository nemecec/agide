import type { ServiceId } from '../../../core/browser/types';
import type { ObserveMode } from '../../../core/surfaces/types';

export interface BrowserApproval {
  readonly id: string;
  readonly origin: string;
  readonly tool: string;
  readonly summary: string;
  readonly object?: string | undefined;
  readonly kind: 'act' | 'navigate';
  readonly service: ServiceId;
  readonly tabNumber: number;
  /** Title of the session that asks; absent or null when the session is unknown. */
  readonly sessionTitle?: string | null | undefined;
}

/** What `browser_tab_state` returns for a tab the browser module recorded; `known: false` for any other leaf. */
export type BrowserTabView =
  | { readonly known: false }
  | {
      readonly known: true;
      readonly leafId: string;
      readonly tabNumber: number;
      readonly service: ServiceId;
      readonly url: string;
      readonly title: string;
      readonly loading: boolean;
      readonly canGoBack: boolean;
      readonly canGoForward: boolean;
      readonly crashed: boolean;
      readonly dialog: boolean;
      readonly mode: ObserveMode;
      readonly blocked: boolean;
      readonly acting: boolean;
      readonly approvals: readonly BrowserApproval[];
    };

export const MODE_LABEL: Readonly<Record<ObserveMode, string>> = { off: 'Off', 'on-demand': 'On demand', live: 'Live' };

/** The URL with the host emphasised: the one place the user reads which origin a page belongs to. */
export function splitUrl(url: string): { readonly before: string; readonly host: string; readonly after: string } {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { before: '', host: url, after: '' };
    const start = url.indexOf(parsed.host);
    return { before: url.slice(0, start), host: parsed.host, after: url.slice(start + parsed.host.length) };
  } catch {
    return { before: '', host: url, after: '' };
  }
}

/** Placement rectangle in CSS pixels, or undefined when the slot has no area (hidden pane). */
export function placementOf(rect: { readonly left: number; readonly top: number; readonly width: number; readonly height: number }): { x: number; y: number; width: number; height: number } | undefined {
  if (rect.width < 1 || rect.height < 1) return undefined;
  return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
}

const HIDDEN_BOUNDS = { x: 0, y: 0, width: 0, height: 0 } as const;

/**
 * The `browser_view_place` input for a slot rectangle, or undefined when it matches the last request (`last` is
 * the `key` of that request). A slot without area asks for a hidden view.
 */
export function placementRequest(
  rect: { readonly left: number; readonly top: number; readonly width: number; readonly height: number },
  last: string | undefined,
): { readonly key: string; readonly bounds: { x: number; y: number; width: number; height: number }; readonly visible: boolean } | undefined {
  const placement = placementOf(rect);
  const key = JSON.stringify(placement ?? null);
  if (key === last) return undefined;
  return { key, bounds: placement ?? { ...HIDDEN_BOUNDS }, visible: placement !== undefined };
}
