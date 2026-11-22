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

/** Tool sets of the app MCP server: every session today, swarm agents with a worktree, and reviewers. */
export type ToolSet = 'default' | 'worker' | 'reviewer';

/** Whether a command's tool is listed for a session with the given tool set. */
export const inToolSet = (command: { readonly toolSets?: readonly ToolSet[] }, set: ToolSet): boolean =>
  (command.toolSets ?? ['default', 'worker']).includes(set);

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
   * The session MCP server that lists the tool. Absent means `app`. Tools on `agide-browser` (0026) drop the
   * `browser_` prefix of the command id, so `browser_navigate` is the tool `navigate`.
   */
  readonly mcpServer?: 'app' | 'agide-browser';
  /**
   * The reason a command with a UI binding is not an MCP tool. The parity check accepts a UI-bound command
   * without a tool only when it has this reason, and lists the reason in `docs/parity.md`.
   */
  readonly mcpExempt?: string;
  /**
   * The grant tool sets that list the tool (0040 section 10.2). Absent means `default` and `worker`. A session
   * whose grant names no set has `default`.
   */
  readonly toolSets?: readonly ToolSet[];
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

/** `limit_reached` and `refused` come with the swarm commands (0037 section 9): a depth or count limit, and a refused mode. */
export type CommandErrorCode = 'not_found' | 'invalid_input' | 'out_of_scope' | 'limit_reached' | 'refused' | 'failed';

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
