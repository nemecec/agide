import type { SessionId } from '../session/types';
import type { ToolSet } from '../commands/types';
import type { NodeId } from '../tree/types';

/**
 * The app MCP server (decisions 0004 and 0006, probe P3). Rules every implementation keeps:
 *
 * - Streamable HTTP, built on `@modelcontextprotocol/sdk`, bound to 127.0.0.1 only, on a port chosen at start.
 * - One URL per session: `http://127.0.0.1:<port>/mcp/<sessionId>`.
 * - One bearer token per session, random, at least 32 bytes, compared in constant time. The token must belong to
 *   the session in the URL path. A wrong or missing token gets 401 and no detail.
 * - A request that carries an `Origin` header gets 403 (the CLI sends none; browsers always do).
 * - A `Host` header other than `127.0.0.1:<port>`, `localhost:<port>` or a value the session's grant names gets 403
 *   (DNS rebinding).
 * - Tools are generated from the command registry: every command with `mcp: true` is one tool whose name is the
 *   command id, whose description is the command description and whose input schema is the zod schema as JSON
 *   Schema. A call runs `CommandRegistry.invoke` with `{ kind: 'mcp', sessionId, folderId }` from the grant.
 *   `ok: false` results come back as tool results with `isError: true`, never as protocol errors.
 * - The server name in the `--mcp-config` entry is `app`: names such as `claude-in-chrome` or `workspace` are
 *   reserved by the CLI and skipped.
 * - The folder scope protects against an agent's mistakes. It does not protect against an adversarial agent with
 *   shell access: the bearer token is in a 0600 file under the session directory, not in the process arguments, but a
 *   same-user process can still read that file, and a session can open the app database directly.
 * - Revoking a grant closes the session's open MCP transports; later requests with its token get 401.
 */

/** Access of one Claude session to the app MCP server. */
export interface McpGrant {
  readonly sessionId: SessionId;
  /** The folder the session is scoped to. Commands reject nodes outside it. */
  readonly folderId: NodeId;
  readonly url: string;
  readonly token: string;
}

export interface McpHttpServerEntry {
  readonly type: 'http';
  readonly url: string;
  readonly headers: { readonly Authorization: string };
  /** Milliseconds; above 60,000 keeps a call open while the app waits for the user (0026 section 3, P16). */
  readonly timeout?: number;
}

/** The JSON passed to `claude --mcp-config`. `type: 'http'` is required (P3: without it the CLI reports `url_missing_type`). */
export interface McpConfigJson {
  readonly mcpServers: {
    readonly app: McpHttpServerEntry;
    /** The hosted browser tools on `/mcp/<session>/browser` (0026), added by the browser module's launch contribution. */
    readonly 'agide-browser'?: McpHttpServerEntry;
  };
}

/** Which server of the session a command's tool is listed on (0026 section 3). */
export type McpServerName = 'app' | 'agide-browser';

export const BROWSER_MCP_SERVER_NAME = 'agide-browser';

export interface McpGrantOptions {
  /** `Host` header values the session's environment sends besides the loopback names (`McpEndpoint.hostHeader`). */
  readonly hostHeaders?: readonly string[];
  /** The tools the session's grant lists and runs (0040 section 10.2); the declared set, else `default`. */
  readonly toolSet?: ToolSet;
}

export interface AppMcpServer {
  /** Starts listening. Resolves with the port. Calling it twice returns the same port. */
  start(): Promise<{ port: number }>;
  stop(): Promise<void>;
  /** Issues or replaces the grant of a session. Call before launching `claude` for that session. */
  grant(sessionId: SessionId, folderId: NodeId, options?: McpGrantOptions): McpGrant;
  /**
   * Sets the tool set of the session's grant, and of every grant issued for it later, until it is revoked. The
   * runtime calls it before a launch whose spec names a tool set.
   */
  declareToolSet(sessionId: SessionId, toolSet: ToolSet): void;
  /** Changes the folder of an existing grant, for example after the session leaf moved. */
  rescope(sessionId: SessionId, folderId: NodeId): void;
  revoke(sessionId: SessionId): void;
  /** The `--mcp-config` JSON for a granted session. Throws when the session has no grant. */
  configFor(sessionId: SessionId): McpConfigJson;
}

export const APP_MCP_SERVER_NAME = 'app';
