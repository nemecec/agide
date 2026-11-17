// README: node mcp_host.mjs --serve [--token T] [--log file.jsonl] [--state file.json]   -- localhost Streamable-HTTP MCP server (127.0.0.1, bearer token, Origin check) with ui_* tools. Also importable: startMcpHost().
import http from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { appendFileSync, writeFileSync } from 'node:fs';

export function startMcpHost({ token = randomBytes(24).toString('hex'), logFile, stateFile, permissionPolicy = () => ({ behavior: 'allow' }) } = {}) {
  // State owned by the host process: the "UI model" the tools mutate.
  const state = { folders: { root: { id: 'root', name: 'Tasks', parent: null } }, sessions: { s1: { id: 's1', title: 'demo session', folder: 'root' } }, openFiles: [], permissionRequests: [] };
  const calls = [];
  const sessions = new Set();
  const rejected = [];
  const log = (o) => { const e = { t: Date.now(), ...o }; calls.push(e); if (logFile) appendFileSync(logFile, JSON.stringify(e) + '\n'); };
  const persist = () => { if (stateFile) writeFileSync(stateFile, JSON.stringify(state, null, 1)); };
  persist();

  const tools = [
    { name: 'ui_create_folder', description: 'Create a folder in the task tree of the desktop app.', inputSchema: { type: 'object', properties: { name: { type: 'string' }, parent_id: { type: 'string', description: 'Parent folder id; defaults to root' } }, required: ['name'] } },
    { name: 'ui_move_session', description: 'Move a session into a folder of the task tree.', inputSchema: { type: 'object', properties: { session_id: { type: 'string' }, folder_id: { type: 'string' } }, required: ['session_id', 'folder_id'] } },
    { name: 'ui_open_file', description: 'Open a file in the editor pane of the desktop app.', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
    { name: 'ui_state', description: 'Return the current task tree and open files.', inputSchema: { type: 'object', properties: {} } },
    { name: 'permission_prompt', description: 'Permission prompt tool: decides whether a tool call may run.', inputSchema: { type: 'object', properties: { tool_name: { type: 'string' }, input: { type: 'object' }, tool_use_id: { type: 'string' } }, required: ['tool_name', 'input'] } },
  ];
  const ok = (obj) => ({ content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj) }] });
  const err = (msg) => ({ isError: true, content: [{ type: 'text', text: msg }] });

  function callTool(name, a = {}) {
    switch (name) {
      case 'ui_create_folder': {
        const parent = a.parent_id ?? 'root';
        if (!state.folders[parent]) return err(`unknown parent folder: ${parent}`);
        if (typeof a.name !== 'string' || !a.name.trim()) return err('name must be a non-empty string');
        const id = 'f' + (Object.keys(state.folders).length);
        state.folders[id] = { id, name: a.name, parent }; persist();
        return ok({ id, name: a.name, parent });
      }
      case 'ui_move_session': {
        if (!state.sessions[a.session_id]) return err(`unknown session: ${a.session_id}`);
        if (!state.folders[a.folder_id]) return err(`unknown folder: ${a.folder_id}`);
        state.sessions[a.session_id].folder = a.folder_id; persist();
        return ok({ moved: a.session_id, to: a.folder_id });
      }
      case 'ui_open_file': {
        if (typeof a.path !== 'string' || !a.path) return err('path required');
        state.openFiles.push(a.path); persist();
        return ok({ opened: a.path, tabs: state.openFiles.length });
      }
      case 'ui_state': return ok(state);
      case 'permission_prompt': {
        state.permissionRequests.push(a); persist();
        const d = permissionPolicy(a);
        // Output shape documented for --permission-prompt-tool: JSON text with behavior allow|deny.
        return ok(d.behavior === 'allow' ? { behavior: 'allow', updatedInput: a.input ?? {} } : { behavior: 'deny', message: d.message || 'denied by host' });
      }
      default: return null;
    }
  }

  const server = http.createServer((req, res) => {
    const send = (code, body, headers = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...headers }); res.end(body === undefined ? '' : JSON.stringify(body)); };
    const bad = (code, why) => { rejected.push({ code, why }); log({ kind: 'http-reject', code, why, method: req.method, origin: req.headers.origin }); send(code, { error: why }); };
    // DNS-rebinding and browser-origin protection.
    const origin = req.headers.origin;
    if (origin !== undefined) return bad(403, 'origin not allowed');
    const host = (req.headers.host || '').split(':')[0];
    if (host !== '127.0.0.1' && host !== 'localhost') return bad(403, 'host not allowed');
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    const a = Buffer.from(m?.[1] ?? ''), b = Buffer.from(token);
    if (!m || a.length !== b.length || !timingSafeEqual(a, b)) return bad(401, 'bad token');
    if (!req.url.startsWith('/mcp')) return bad(404, 'not found');
    if (req.method === 'GET') return bad(405, 'no server-initiated stream');
    if (req.method === 'DELETE') { sessions.delete(req.headers['mcp-session-id']); return send(200, undefined); }
    if (req.method !== 'POST') return bad(405, 'method');
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      let msg; try { msg = JSON.parse(body); } catch { return send(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }); }
      const batch = Array.isArray(msg) ? msg : [msg];
      const out = [];
      let sid = req.headers['mcp-session-id'];
      for (const m of batch) {
        if (m.id === undefined) { log({ kind: 'notification', method: m.method }); continue; }
        log({ kind: 'rpc', method: m.method, params: m.method === 'tools/call' ? m.params : undefined, session: sid });
        if (m.method === 'initialize') {
          sid = randomUUID(); sessions.add(sid);
          out.push({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params?.protocolVersion || '2025-06-18', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'probe-app', version: '0.0.1' } } });
        } else if (m.method === 'ping') out.push({ jsonrpc: '2.0', id: m.id, result: {} });
        else if (m.method === 'tools/list') out.push({ jsonrpc: '2.0', id: m.id, result: { tools } });
        else if (m.method === 'tools/call') {
          const r = callTool(m.params?.name, m.params?.arguments);
          if (r === null) out.push({ jsonrpc: '2.0', id: m.id, error: { code: -32602, message: `unknown tool: ${m.params?.name}` } });
          else { log({ kind: 'tool-result', name: m.params.name, isError: !!r.isError }); out.push({ jsonrpc: '2.0', id: m.id, result: r }); }
        } else out.push({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'method not found' } });
      }
      if (!out.length) return send(202, undefined);
      send(200, Array.isArray(msg) ? out : out[0], sid ? { 'mcp-session-id': sid } : {});
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ port, token, url: `http://127.0.0.1:${port}/mcp`, state, calls, rejected, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }),
        config: (extra = {}) => ({ mcpServers: { app: { type: 'http', url: `http://127.0.0.1:${port}/mcp`, headers: { Authorization: `Bearer ${token}` }, ...extra } } }) });
    });
  });
}

if (process.argv[1] && process.argv[1].endsWith('mcp_host.mjs') && process.argv.includes('--serve')) {
  const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
  const h = await startMcpHost({ token: arg('--token'), logFile: arg('--log'), stateFile: arg('--state') });
  console.log(JSON.stringify({ url: h.url, token: h.token, config: h.config() }));
  process.on('SIGTERM', () => process.exit(0));
}
