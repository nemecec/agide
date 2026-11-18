import type { Bounds } from '../../core/surfaces/types';

/** The size a view has while it sits in the hidden window: large enough that the page lays out as in a normal tab. */
export const PARKED_BOUNDS: Bounds = { x: 0, y: 0, width: 1024, height: 768 };

/** A download within this time of an agent call on the tab counts as the agent's. */
export const DOWNLOAD_QUIET_MS = 2000;

/** CSS pixel bounds of a surface slot as native view bounds: scaled by the window zoom, rounded, at least one pixel in size. */
export function nativeBounds(bounds: Bounds, zoomFactor: number): Bounds {
  return {
    x: Math.round(bounds.x * zoomFactor),
    y: Math.round(bounds.y * zoomFactor),
    width: Math.max(1, Math.round(bounds.width * zoomFactor)),
    height: Math.max(1, Math.round(bounds.height * zoomFactor)),
  };
}

export interface EvictionCandidate {
  readonly leafId: string;
  readonly placed: boolean;
  readonly lastUsed: number;
}

/** The view to destroy when the live limit is reached: the longest unused one that no surface shows. Shown views stay. */
export function pickEvictionVictim(entries: readonly EvictionCandidate[], limit: number): string | undefined {
  if (entries.length < limit) return undefined;
  const parked = entries.filter((entry) => !entry.placed).sort((a, b) => a.lastUsed - b.lastUsed);
  return parked[0]?.leafId;
}

/** Whether a download starts as the result of an agent call: one is running, or one ended a moment ago. */
export function isAgentDownload(input: { readonly acting: boolean; readonly lastActed: number; readonly now: number }): boolean {
  return input.acting || input.now - input.lastActed < DOWNLOAD_QUIET_MS;
}

/** `loadURL` rejects with ERR_ABORTED when a redirect or a newer navigation replaces the load; that is not a failure. */
export function isAbortedLoad(error: unknown): boolean {
  return /ERR_ABORTED/.test(String(error));
}
