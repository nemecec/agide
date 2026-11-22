// README: shared helpers for the milestone 5 review probes P40 to P43 (Node ESM). Not run directly. Fresh directories under /tmp/agide-p-review/, a one-shot stream-json reviewer run, and a Streamable HTTP MCP server with a report_review tool built on the official SDK from app/node_modules.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import { createRequire } from 'node:module';
import { cleanEnv, parseLines, save, CLAUDE, HERE } from './lib.mjs';

export { save, parseLines };
export const ROOT = '/tmp/agide-p-review';
mkdirSync(ROOT, { recursive: true });
export const fresh = (prefix) => mkdtempSync(join(ROOT, `${prefix}-`));
export const cleanup = (d) => { try { rmSync(d, { recursive: true, force: true }); } catch {} };
export const git = (cwd, args, opts = {}) => spawnSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', '-c', 'user.name=probe', '-c', 'user.email=probe@example.invalid', ...args], { cwd, encoding: 'utf8', ...opts });
export const write = (p, s, mode) => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, s, mode ? { mode } : undefined); };

// Flags every P40 to P43 run passes unless the probe varies them.
export const SAFE = ['--model', 'haiku', '--max-budget-usd', '0.25', '--permission-mode', 'default'];

// One claude -p run, prompt on stdin as plain text, stream-json output. Returns events and exit data.
export function run(args, { cwd, prompt, env = {}, timeoutMs = 150000 }) {
  return new Promise((res) => {
    const full = ['-p', '--output-format', 'stream-json', '--verbose', ...SAFE, ...args];
    const child = spawn(CLAUDE, full, { cwd, env: cleanEnv(env), stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const t = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code, sig) => { clearTimeout(t); res({ events: parseLines(stdout), stderr, code, sig, args: full }); });
    child.stdin.end(prompt);
  });
}

export const initOf = (ev) => ev.find((e) => e.type === 'system' && e.subtype === 'init');
export const resultOf = (ev) => ev.filter((e) => e.type === 'result').pop();
export const blocks = (ev, type) => ev.flatMap((e) => (e.type === 'assistant' || e.type === 'user' ? e.message?.content || [] : []).filter((b) => b.type === type));
export const toolUses = (ev) => blocks(ev, 'tool_use').map((b) => ({ id: b.id, name: b.name, input: b.input }));
export const toolResults = (ev) => blocks(ev, 'tool_result').map((b) => ({ id: b.tool_use_id, is_error: !!b.is_error, content: (typeof b.content === 'string' ? b.content : JSON.stringify(b.content)).slice(0, 600) }));
export const assistantText = (ev) => blocks(ev, 'text').map((b) => b.text).join('\n');
export const cost = (ev) => resultOf(ev)?.total_cost_usd;

// MCP server with report_review. mode: 'validate' (SDK validates input against the zod schema, default), 'down' is done by closing the server.
const require = createRequire(join(HERE, '..', 'app', 'package.json'));
export async function startReportServer({ token = 'probe-token', validate, maxSummary = 600 } = {}) {
  const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
  const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
  const { z } = require('zod');
  const reports = [];
  const calls = [];
  const rejections = [];
  const build = () => {
    const s = new McpServer({ name: 'probe-review', version: '0.0.1' });
    s.registerTool('report_review', {
      description: 'Report the result of the review. Call exactly once when the review is done. Findings must reference lines that appear in the diff.',
      inputSchema: {
        verdict: z.enum(['accept', 'revise', 'reject']).describe('accept: no blocking problem; revise: fixable problems; reject: the change should not land'),
        findings: z.array(z.object({
          file: z.string().describe('Path as shown in the diff'),
          line: z.number().int().positive().describe('Line number in the new file'),
          severity: z.enum(['blocker', 'major', 'minor', 'nit']),
          message: z.string().min(1),
        })),
        summary: z.string().min(1).max(maxSummary),
      },
    }, async (args) => {
      const problem = validate?.(args);
      if (problem) { rejections.push({ args, problem }); return { isError: true, content: [{ type: 'text', text: problem }] }; }
      reports.push(args);
      return { content: [{ type: 'text', text: 'review recorded' }] };
    });
    return s;
  };
  const server = http.createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401).end(); return; }
    let body = '';
    for await (const d of req) body += d;
    let parsed; try { parsed = JSON.parse(body); } catch { parsed = undefined; }
    if (parsed?.method === 'tools/call') calls.push(parsed.params);
    const mcp = build();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => { transport.close(); mcp.close(); });
    await mcp.connect(transport);
    await transport.handleRequest(req, res, parsed);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/mcp`;
  return {
    port, url, reports, calls, rejections,
    config: (dir, name = 'app', over = {}) => { const f = join(dir, 'mcp.json'); writeFileSync(f, JSON.stringify({ mcpServers: { [name]: { type: 'http', url, headers: { Authorization: `Bearer ${token}` }, ...over } } })); return f; },
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }),
  };
}
