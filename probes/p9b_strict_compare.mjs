// README: node p9b_strict_compare.mjs  -- P9b: controlled comparison of --strict-mcp-config in -p. Same directory, same prompt, same other flags; flag off and on in the order off, on, on, off. Stores every init event's server list, tool prefixes and the mcp_status response. Haiku, no connector call.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { WORK, OUT, startStream, userMsg, sleep, save } from './lib.mjs';
const dir = join(WORK, 'p9b-compare'); mkdirSync(dir, { recursive: true });
const report = [];
for (const strict of [false, true, true, false]) {
  const h = startStream(['--permission-mode', 'manual', '--settings', '{"disableAllHooks":true}', ...(strict ? ['--strict-mcp-config'] : [])], { cwd: dir });
  h.send(userMsg('Reply with the single word: ok'));
  await h.waitResult(1, 90000);
  await sleep(5000);
  h.send({ type: 'control_request', request_id: 'm1', request: { subtype: 'mcp_status' } });
  const cr = await h.waitFor((e) => e.type === 'control_response' && e.response?.request_id === 'm1', 20000);
  await h.end();
  const inits = h.events.filter((e) => e.type === 'system' && e.subtype === 'init');
  report.push({
    strict, cwd: dir, init_count: inits.length,
    inits: inits.map((i) => ({ servers: i.mcp_servers.map((s) => `${s.name}:${s.status}`), mcp_tool_prefixes: [...new Set(i.tools.filter((t) => t.startsWith('mcp__')).map((t) => t.split('__').slice(0, 2).join('__')))] })),
    mcp_status: (cr?.response?.response?.mcpServers ?? []).map((s) => ({ name: s.name, status: s.status, scope: s.scope, tools: Array.isArray(s.tools) ? s.tools.length : undefined })),
  });
}
save('p9b_strict_compare.json', report);
for (const r of report) console.log(r.strict ? 'strict' : 'no flag', '| init servers per init:', r.inits.map((i) => i.servers.length), '| mcp_status servers:', r.mcp_status.length, '| connected claude.ai:', r.mcp_status.filter((s) => s.name.startsWith('claude.ai') && s.status === 'connected').length, '| mcp tool prefixes in last init:', r.inits.at(-1).mcp_tool_prefixes.length);
