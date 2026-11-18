import type { IncomingMessage } from 'node:http';
import type { McpServerName } from './types';

export type GuardResult = { readonly ok: true; readonly sessionId: string; readonly token: string | undefined; readonly server: McpServerName } | { readonly ok: false; readonly status: number; readonly reason: string };

const PATH = /^\/mcp\/([^/?#]+)(\/browser)?$/;

/**
 * Checks that guard against browsers and DNS rebinding before any token is read: no `Origin` header (the CLI
 * sends none; browsers always do) and a `Host` of this server's own address, or one the session's grant allows
 * (a container reaches the host as `host.docker.internal:<port>`, probe I2). Then extracts the session id from
 * the path and the bearer token from the headers. The token is checked by the caller.
 */
export function guardRequest(req: IncomingMessage, port: number, grantHosts: (sessionId: string) => readonly string[] = () => []): GuardResult {
  if (req.headers.origin !== undefined) return { ok: false, status: 403, reason: 'origin not allowed' };
  const path = (req.url ?? '').split('?')[0] ?? '';
  const match = PATH.exec(path);
  let sessionId: string | undefined;
  try {
    sessionId = match?.[1] === undefined ? undefined : decodeURIComponent(match[1]);
  } catch {
    sessionId = undefined;
  }
  const host = req.headers.host ?? '';
  const loopback = host === `127.0.0.1:${port}` || host === `localhost:${port}`;
  if (!loopback && (sessionId === undefined || !grantHosts(sessionId).includes(host))) return { ok: false, status: 403, reason: 'host not allowed' };
  if (sessionId === undefined) return { ok: false, status: 404, reason: 'not found' };
  const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
  return { ok: true, sessionId, token: bearer?.[1], server: match?.[2] === undefined ? 'app' : 'agide-browser' };
}
