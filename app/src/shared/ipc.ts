import type { CommandDescriptor, CommandResult } from '../core/commands/types';
import type { AppEvent } from '../core/events/index';

/**
 * The whole IPC surface between renderer and main. The renderer reaches app behaviour only through commands,
 * with the same registry the MCP server uses, so the UI and the agent share one path.
 */
export const IPC = {
  /** invoke(id, input) -> CommandResult. Caller is always `{ kind: 'ui' }`. */
  invoke: 'commands:invoke',
  /** list() -> CommandDescriptor[]. */
  list: 'commands:list',
  /** main -> renderer, one message per bus event. */
  event: 'events:event',
} as const;

/** What the preload script exposes as `window.api`. */
export interface RendererApi {
  invoke<O = unknown>(commandId: string, input?: unknown): Promise<CommandResult<O>>;
  listCommands(): Promise<CommandDescriptor[]>;
  /** Receives every app event. Returns a function that unsubscribes. */
  subscribe(listener: (event: AppEvent) => void): () => void;
}
