// README: node p45_hook_server.mjs --serve --log file.jsonl [--route /path=spec ...]  -- localhost receiver for the P45 http hook probes. Also importable: startHookServer({ logFile, routes }). Each request is logged with its headers, remote address and parsed body, then answered per the route spec: a comma list of delay:S, status:N, allow, deny, deny-interrupt, ask, ctx (additionalContext with the word of ctxWord), text, badjson, empty. allow, deny and ask answer in the shape of the event named in the payload (PermissionRequest: hookSpecificOutput.decision; PreToolUse: permissionDecision). A route not listed answers 200 with an empty body. The log also records when the client closed the connection before the answer was sent.
import http from 'node:http';
import { appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// The word the ctx answer puts into the model's context, derived from a label so that no fixed literal sits in the file.
export const ctxWord = () => `p45ctx${createHash('sha256').update('p45-context-word').digest('hex').slice(0, 10)}`;

export function decisionBody(event, kind) {
  if (event === 'PermissionRequest') {
    if (kind === 'allow') return { hookSpecificOutput: { hookEventName: event, decision: { behavior: 'allow' } } };
    if (kind === 'deny') return { hookSpecificOutput: { hookEventName: event, decision: { behavior: 'deny', message: 'denied by the p45 http hook' } } };
    if (kind === 'deny-interrupt') return { hookSpecificOutput: { hookEventName: event, decision: { behavior: 'deny', message: 'denied by the p45 http hook', interrupt: true } } };
    return {};
  }
  if (event === 'PreToolUse') {
    const d = { allow: 'allow', deny: 'deny', ask: 'ask' }[kind];
    return d ? { hookSpecificOutput: { hookEventName: event, permissionDecision: d, permissionDecisionReason: `p45 http hook ${d}` } } : {};
  }
  return {};
}

export function startHookServer({ logFile, routes = {} } = {}) {
  const t0 = Date.now();
  const events = [];
  const log = (o) => {
    const e = { t: Date.now(), at_s: Math.round((Date.now() - t0) / 100) / 10, ...o };
    events.push(e);
    if (logFile) appendFileSync(logFile, JSON.stringify(e) + '\n');
  };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      let parsed = null; try { parsed = JSON.parse(body); } catch {}
      const spec = (routes[req.url] || routes[req.url.split('?')[0]] || 'empty').split(',');
      const id = events.length;
      log({ kind: 'request', id, method: req.method, url: req.url, headers: req.headers, remote: `${req.socket.remoteAddress}`, content_length: body.length, body: parsed ?? body.slice(0, 500) });
      const num = (p) => { const s = spec.find((x) => x.startsWith(p)); return s ? Number(s.slice(p.length)) : null; };
      const delayMs = (num('delay:') ?? 0) * 1000;
      let answered = false;
      res.on('close', () => { if (!answered || !res.writableFinished) log({ kind: 'client-closed-before-answer', id, url: req.url }); });
      setTimeout(() => {
        const event = parsed?.hook_event_name;
        const kind = ['allow', 'deny', 'deny-interrupt', 'ask'].find((k) => spec.includes(k));
        const status = num('status:') ?? 200;
        let out = '', type = 'application/json';
        if (spec.includes('ctx')) out = JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: `The p45 context word is ${ctxWord()}.` } });
        else if (kind) out = JSON.stringify(decisionBody(event, kind));
        else if (spec.includes('text')) { out = 'plain text answer'; type = 'text/plain'; }
        else if (spec.includes('badjson')) out = JSON.stringify({ hookSpecificOutput: { hookEventName: event, permissionDecision: 'sometimes' } });
        answered = true;
        res.writeHead(status, { 'content-type': type }); res.end(out);
        log({ kind: 'answered', id, url: req.url, status, body: out.slice(0, 300) });
      }, delayMs);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ port, base: `http://127.0.0.1:${port}`, events, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) });
    });
  });
}

if (process.argv[1]?.endsWith('p45_hook_server.mjs') && process.argv.includes('--serve')) {
  const a = process.argv.slice(2);
  const routes = {};
  a.forEach((v, i) => { if (v === '--route') { const [p, ...s] = a[i + 1].split('='); routes[p] = s.join('='); } });
  const li = a.indexOf('--log');
  const h = await startHookServer({ logFile: li >= 0 ? a[li + 1] : undefined, routes });
  console.log(JSON.stringify({ base: h.base, port: h.port }));
  process.on('SIGTERM', () => process.exit(0));
}
