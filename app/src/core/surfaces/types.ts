import type { z } from 'zod';
import type { NodeId } from '../tree/types';

/**
 * Surface types from decision 0006, section 1. Types only: no surface type is implemented in milestone 1
 * apart from the Claude session, whose runtime lives in the session module.
 * Views (`WebContentsView`, terminal) are created by the main process; the core sees them only through
 * `SurfaceHost` and `SurfaceInstance`, so this file stays free of Electron types.
 */

/** Where a new surface comes from: a URL, a ticket key, a prompt. */
export interface SurfaceCreateInput {
  readonly folderId: NodeId;
  readonly url?: string;
  readonly ticket?: string;
  readonly prompt?: string;
  readonly title?: string;
}

export interface Bounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** What the app gives a mounted surface. */
export interface SurfaceHost<State extends object> {
  readonly surfaceId: string;
  readonly nodeId: NodeId;
  readonly state: State;
  /** Persists new state with the tree node. */
  setState(state: State): void;
  setTitle(title: string): void;
}

/** A mounted surface. The app calls these as the user moves through the tree. */
export interface SurfaceInstance {
  focus(): void;
  reveal(): void;
  setBounds(bounds: Bounds): void;
  dispose(): void | Promise<void>;
}

/** Observation setting stored per surface (0006, section 5). */
export type ObserveMode = 'off' | 'on-demand' | 'live';

export interface ObserveSnapshot {
  readonly kind: 'summary' | 'text' | 'screenshot';
  /** Text content or a base64 image. Third-party page content is untrusted data. */
  readonly content: string;
  readonly untrusted: boolean;
}

export interface ObserveSpec<State extends object> {
  readonly modes: readonly ObserveMode[];
  readonly defaultMode: ObserveMode;
  /** Pull: called by `surfaces_observe`. */
  snapshot(state: State, kind: ObserveSnapshot['kind']): Promise<ObserveSnapshot>;
  /** Push: a short digest of what changed, for the hook digest. Returns an unsubscribe function. */
  onChange?(state: State, listener: (digest: string) => void): () => void;
  /** Removes content that never leaves the surface, such as password fields. */
  redact?(snapshot: ObserveSnapshot): ObserveSnapshot;
}

/** A tool a surface type adds to the app MCP server. The name follows `<area>_<verb>`. */
export interface SurfaceTool<State extends object, I extends z.ZodType = z.ZodType> {
  readonly name: string;
  readonly description: string;
  readonly input: I;
  run(state: State, input: z.output<I>): Promise<unknown>;
}

/** An action on a surface. The same registry feeds menus, commands and MCP tools. */
export interface SurfaceAction<State extends object> {
  readonly id: string;
  readonly title: string;
  run(state: State): Promise<void> | void;
}

export interface SurfaceType<State extends object = object> {
  /** Such as `claude-session`, `browser-tab`, `slack-thread`. Stored in `LeafNode.surfaceType`. */
  readonly id: string;
  readonly label: string;
  readonly icon: string;
  create(input: SurfaceCreateInput): Promise<State>;
  title(state: State): string;
  /** Stored with the tree node. Must be JSON-serializable. */
  serialize(state: State): unknown;
  restore(saved: unknown): State;
  mount(host: SurfaceHost<State>): SurfaceInstance;
  readonly observe?: ObserveSpec<State>;
  readonly tools?: readonly SurfaceTool<State>[];
  readonly actions?: readonly SurfaceAction<State>[];
}

/** Surface type ids known in milestone 1. */
export const SURFACE_CLAUDE_SESSION = 'claude-session';
export const SURFACE_BROWSER_TAB = 'browser-tab';
export const SURFACE_SLACK_THREAD = 'slack-thread';
