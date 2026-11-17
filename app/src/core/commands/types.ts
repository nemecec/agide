import type { z } from 'zod';
import type { NodeId } from '../tree/types';

/**
 * Who invokes a command. A UI caller acts for the user and sees the whole tree. An MCP caller is one Claude
 * session: `sessionId` comes from the bearer token of its request, and `folderId` is the folder it is scoped to.
 * Commands that touch tree nodes or surfaces reject nodes outside `folderId` for MCP callers.
 */
export type Caller =
  | { readonly kind: 'ui' }
  | { readonly kind: 'mcp'; readonly sessionId: string; readonly folderId: NodeId };

export interface CommandContext {
  readonly caller: Caller;
}

/** Where a command shows in the UI. `false` means no UI binding: the command is for MCP or internal use. */
export type UiBinding =
  | false
  | {
      /** Context menu that lists the command. */
      readonly menu?: 'tree-node' | 'tree-background' | 'app';
      /** Electron accelerator, such as `CmdOrCtrl+Shift+N`. */
      readonly accelerator?: string;
    };

/**
 * One action of the app. The same definition drives menus, keyboard shortcuts, IPC from the renderer and the
 * MCP tools, so every UI action can have a tool.
 *
 * The id is `<area>_<verb>[_<object>]` in lower snake case, such as `ui_create_folder` or `session_send_text`,
 * and is also the MCP tool name. Input is parsed with `input` before `run` sees it, for every caller.
 */
export interface Command<I extends z.ZodType = z.ZodType, O = unknown> {
  readonly id: string;
  readonly title: string;
  /** Shown to the agent as the tool description. Say what the command does and what it returns. */
  readonly description: string;
  readonly input: I;
  readonly ui: UiBinding;
  /** True exposes the command as a tool on the app MCP server. */
  readonly mcp: boolean;
  /**
   * The reason a command with a UI binding is not an MCP tool. The parity check accepts a UI-bound command
   * without a tool only when it has this reason, and lists the reason in `docs/parity.md`.
   */
  readonly mcpExempt?: string;
  /** The result must be JSON-serializable: it crosses IPC and MCP. */
  run(input: z.output<I>, ctx: CommandContext): O | Promise<O>;
}

/** A command without its function and schema, safe to send to the renderer. */
export interface CommandDescriptor {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly ui: UiBinding;
  readonly mcp: boolean;
}

export type CommandErrorCode = 'not_found' | 'invalid_input' | 'out_of_scope' | 'failed';

export class CommandError extends Error {
  constructor(
    readonly code: CommandErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'CommandError';
  }
}

/** The result of an invocation. Errors are values so they cross IPC and MCP unchanged. */
export type CommandResult<O = unknown> =
  | { readonly ok: true; readonly value: O }
  | { readonly ok: false; readonly error: { readonly code: CommandErrorCode; readonly message: string; readonly details?: unknown } };
