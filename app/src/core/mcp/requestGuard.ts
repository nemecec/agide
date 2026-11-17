import type { IncomingMessage } from 'node:http';

export type GuardResult = { readonly ok: true; readonly sessionId: string; readonly token: string | undefined } | { readonly ok: false; readonly status: number; readonly reason: string };

const PATH = /^\/mcp\/([^/?#]+)$/;

/**
 * Checks that guard against browsers and DNS rebinding before any token is read: no `Origin` header (the CLI
 * sends none; browsers always do) and a `Host` of this server's own address. Then extracts the session id from
 * the path and the bearer token from the headers. The token is checked by the caller.
 */
export function guardRequest(req: IncomingMessage, port: number): GuardResult {
  if (req.headers.origin !== undefined) return { ok: false, status: 403, reason: 'origin not allowed' };
  const host = req.headers.host;
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return { ok: false, status: 403, reason: 'host not allowed' };
  const path = (req.url ?? '').split('?')[0] ?? '';
  const match = PATH.exec(path);
  if (!match?.[1]) return { ok: false, status: 404, reason: 'not found' };
  let sessionId: string;
  try {
    sessionId = decodeURIComponent(match[1]);
  } catch {
    return { ok: false, status: 404, reason: 'not found' };
  }
  const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
  return { ok: true, sessionId, token: bearer?.[1] };
}
