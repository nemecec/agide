import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { CommandRegistry } from '../commands/CommandRegistry';
import type { Caller, ToolSet } from '../commands/types';
import type { SessionId } from '../session/types';
import type { NodeId } from '../tree/types';
import { GrantStore } from './grants';
import { mcpConfigFor, sessionUrl } from './mcpConfig';
import { guardRequest } from './requestGuard';
import { callTool, toolsFrom } from './tools';
import { APP_MCP_SERVER_NAME, type AppMcpServer, type McpConfigJson, type McpGrant, type McpGrantOptions, type McpServerName } from './types';

const MAX_BODY_BYTES = 1_000_000;

interface OpenTransport {
  close(): Promise<void>;
}

/**
 * Streamable HTTP MCP server for the app. Each request is handled statelessly: the SDK server and transport
 * live for one request, and the caller identity comes from the bearer token and the path, never from a
 * protocol session.
 */
export class HttpAppMcpServer implements AppMcpServer {
  private readonly grants = new GrantStore();
  private readonly open = new Map<SessionId, Set<OpenTransport>>();
  private http: HttpServer | undefined;
  private starting: Promise<{ port: number }> | undefined;
  private port = 0;

  constructor(private readonly registry: CommandRegistry) {}

  start(): Promise<{ port: number }> {
    this.starting ??= new Promise((resolve, reject) => {
      const http = createServer((req, res) => {
        this.handle(req, res).catch((error: unknown) => {
          console.error('app MCP request failed:', error);
          reply(res, 500, { error: 'internal error' });
          if (!res.writableEnded) res.end();
        });
      });
      http.once('error', reject);
      http.listen(0, '127.0.0.1', () => {
        this.port = (http.address() as AddressInfo).port;
        this.http = http;
        resolve({ port: this.port });
      });
    });
    return this.starting;
  }

  async stop(): Promise<void> {
    const http = this.http;
    this.http = undefined;
    this.starting = undefined;
    for (const sessionId of [...this.open.keys()]) await this.closeOpen(sessionId);
    if (!http) return;
    http.closeAllConnections();
    await new Promise<void>((resolve) => http.close(() => resolve()));
  }

  grant(sessionId: SessionId, folderId: NodeId, options: McpGrantOptions = {}): McpGrant {
    if (!this.http) throw new Error('the app MCP server is not listening; call start() before grant()');
    const token = this.grants.issue(sessionId, folderId, options.hostHeaders, options.toolSet);
    return { sessionId, folderId, url: sessionUrl(this.port, sessionId), token };
  }

  declareToolSet(sessionId: SessionId, toolSet: ToolSet): void {
    this.grants.declareToolSet(sessionId, toolSet);
  }

  rescope(sessionId: SessionId, folderId: NodeId): void {
    this.grants.rescope(sessionId, folderId);
  }

  revoke(sessionId: SessionId): void {
    this.grants.revoke(sessionId);
    void this.closeOpen(sessionId);
  }

  configFor(sessionId: SessionId): McpConfigJson {
    const grant = this.grants.get(sessionId);
    if (!grant || !this.http) throw new Error(`session ${sessionId} has no grant on the running app MCP server`);
    return mcpConfigFor({ sessionId, folderId: grant.folderId, url: sessionUrl(this.port, sessionId), token: grant.token });
  }

  private async closeOpen(sessionId: SessionId): Promise<void> {
    const transports = this.open.get(sessionId);
    this.open.delete(sessionId);
    await Promise.allSettled([...(transports ?? [])].map((transport) => transport.close()));
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const guard = guardRequest(req, this.port, (sessionId) => this.grants.hostHeaders(sessionId));
    if (!guard.ok) return reply(res, guard.status, { error: guard.reason });
    const auth = this.grants.authenticate(guard.sessionId, guard.token);
    if (!auth) return reply(res, 401, { error: 'unauthorized' });
    if (req.method !== 'POST') return reply(res, 405, { error: 'POST only' }, { allow: 'POST' });

    let body: unknown;
    let text: string;
    try {
      text = await readBody(req);
    } catch (error) {
      if (error instanceof BodyTooLarge) return reply(res, 413, { error: 'request body too large' }, { connection: 'close' });
      throw error;
    }
    try {
      body = JSON.parse(text);
    } catch {
      return reply(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'request body is not valid JSON' } });
    }
    const caller: Caller = { kind: 'mcp', sessionId: guard.sessionId, folderId: auth.folderId };
    await this.serve(req, res, body, caller, guard.server, auth.toolSet);
  }

  private async serve(req: IncomingMessage, res: ServerResponse, body: unknown, caller: Caller & { kind: 'mcp' }, which: McpServerName, toolSet: ToolSet): Promise<void> {
    const server = new Server({ name: which === 'app' ? APP_MCP_SERVER_NAME : which, version: '0.1.0' }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: toolsFrom(this.registry, which, toolSet) }));
    server.setRequestHandler(CallToolRequestSchema, (request) =>
      callTool(this.registry, request.params.name, request.params.arguments, caller, which, toolSet),
    );
    const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
    const transports = this.open.get(caller.sessionId) ?? new Set<OpenTransport>();
    this.open.set(caller.sessionId, transports);
    transports.add(transport);
    res.on('close', () => {
      transports.delete(transport);
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  }
}

function reply(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  if (res.headersSent) return;
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

class BodyTooLarge extends Error {}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new BodyTooLarge());
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
