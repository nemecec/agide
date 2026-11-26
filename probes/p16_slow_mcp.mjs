// README: node p16_slow_mcp.mjs --serve [--log file.jsonl]  -- localhost Streamable-HTTP MCP server for P16 with one tool, slow_wait, that answers after N seconds. Also importable: startSlowMcp(). The log records when each tools/call arrived, every progress notification sent, how the call ended (answered, or the client closed the connection first) and every notification the client posts (for example notifications/cancelled).
import http from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';

const TOOL = {
  name: 'slow_wait',
  description: 'Waits the given number of seconds on the server, then returns the word done. Use it when asked to wait.',
  inputSchema: {
    type: 'object',
    properties: {
      seconds: { type: 'number', description: 'How long the server waits before it answers' },
      mode: { type: 'string', enum: ['json', 'sse'], description: 'json: nothing is sent before the answer. sse: the stream opens at once.' },
      progress_every_s: { type: 'number', description: 'sse only: seconds between progress notifications; 0 sends none' },
    },
    required: ['seconds'],
  },
};

export function startSlowMcp({ logFile, token = randomBytes(24).toString('hex') } = {}) {
  const events = [];
  const t0 = Date.now();
  const log = (o) => {
    const e = { at_s: Math.round((Date.now() - t0) / 100) / 10, ...o };
    events.push(e);
    if (logFile) appendFileSync(logFile, JSON.stringify(e) + '\n');
  };
  let sockets = 0;

  const server = http.createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401).end(); return; }
    if (req.method === 'GET') { res.writeHead(405).end(); return; }
    if (req.method === 'DELETE') { res.writeHead(200).end(); return; }
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      let msg; try { msg = JSON.parse(body); } catch { res.writeHead(400).end(); return; }
      const json = (obj, extra = {}) => { res.writeHead(200, { 'content-type': 'application/json', ...extra }); res.end(JSON.stringify(obj)); };
      if (msg.id === undefined) {
        log({ kind: 'notification', method: msg.method, params: msg.params });
        res.writeHead(202).end();
        return;
      }
      if (msg.method === 'initialize') {
        json({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: msg.params?.protocolVersion || '2025-06-18', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'p16-slow', version: '0.0.1' } } }, { 'mcp-session-id': randomUUID() });
      } else if (msg.method === 'ping') json({ jsonrpc: '2.0', id: msg.id, result: {} });
      else if (msg.method === 'tools/list') json({ jsonrpc: '2.0', id: msg.id, result: { tools: [TOOL] } });
      else if (msg.method === 'tools/call') slowCall(msg, req, res);
      else json({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'method not found' } });
    });
  });

  function slowCall(msg, req, res) {
    const a = msg.params?.arguments || {};
    const seconds = Number(a.seconds) || 0;
    const mode = a.mode === 'sse' ? 'sse' : 'json';
    const every = Number(a.progress_every_s) || 0;
    const progressToken = msg.params?._meta?.progressToken;
    const started = Date.now();
    const call = `c${msg.id}`;
    log({ kind: 'call-start', call, seconds, mode, every, progressToken: progressToken ?? null, meta: msg.params?._meta ?? null, headers: { 'mcp-protocol-version': req.headers['mcp-protocol-version'], 'user-agent': req.headers['user-agent'] } });
    let ended = false;
    const timers = [];
    const finish = (how) => { if (ended) return; ended = true; timers.forEach(clearTimeout); timers.forEach(clearInterval); log({ kind: 'call-end', call, how, after_s: Math.round((Date.now() - started) / 100) / 10 }); };
    res.on('close', () => finish(res.writableFinished ? 'answered' : 'client-closed'));
    req.socket.on('close', () => { if (!ended) finish('socket-closed'); });
    const answer = { jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: `done after ${seconds} seconds` }] } };
    if (mode === 'sse') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      res.write(': open\n\n');
      if (every > 0 && progressToken !== undefined) {
        let n = 0;
        timers.push(setInterval(() => {
          n += 1;
          log({ kind: 'progress-sent', call, n });
          res.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken, progress: n, total: Math.ceil(seconds / every), message: `step ${n}` } })}\n\n`);
        }, every * 1000));
      }
      timers.push(setTimeout(() => { res.write(`event: message\ndata: ${JSON.stringify(answer)}\n\n`); res.end(); }, seconds * 1000));
    } else {
      timers.push(setTimeout(() => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(answer)); }, seconds * 1000));
    }
  }

  server.on('connection', (s) => { sockets += 1; log({ kind: 'connection', n: sockets }); });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ port, token, events, log, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }),
        config: (extra = {}) => ({ mcpServers: { slow: { type: 'http', url: `http://127.0.0.1:${port}/mcp`, headers: { Authorization: `Bearer ${token}` }, ...extra } } }) });
    });
  });
}

if (process.argv[1]?.endsWith('p16_slow_mcp.mjs') && process.argv.includes('--serve')) {
  const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
  const h = await startSlowMcp({ logFile: arg('--log') });
  console.log(JSON.stringify({ url: `http://127.0.0.1:${h.port}/mcp`, token: h.token, config: h.config(JSON.parse(arg('--extra') || '{}')) }));
  process.on('SIGTERM', () => process.exit(0));
}
