// README: node p3_mcp.mjs  -- P3: app-hosted localhost HTTP MCP server driven by `claude -p` stream-json; also checks missing "type", wrong token, and tool errors.
import { startMcpHost } from './mcp_host.mjs';
import { startStream, userMsg, initOf, resultsOf, save, NOHOOKS } from './lib.mjs';

const report = {};
const dump = (n, h) => save(n + '.jsonl', h.events.map((e) => JSON.stringify(e)).join('\n'));
const toolEvents = (h) => {
  const uses = [], results = [];
  for (const e of h.events) {
    for (const b of e.message?.content || []) {
      if (b.type === 'tool_use') uses.push({ name: b.name, input: b.input });
      if (b.type === 'tool_result') results.push({ is_error: !!b.is_error, content: JSON.stringify(b.content).slice(0, 200) });
    }
  }
  return { uses, results };
};
const mcpInit = (h) => { const i = initOf(h.events); return { mcp_servers: i.mcp_servers, mcp_server_errors: i.mcp_server_errors ?? '(absent)', app_tools: i.tools.filter((t) => t.startsWith('mcp__app__')), permissionMode: i.permissionMode }; };

async function run(name, cfg, prompt, extra = []) {
  const h = startStream(['--permission-mode', 'manual', '--mcp-config', JSON.stringify(cfg), '--strict-mcp-config', '--allowedTools', 'mcp__app__*', ...NOHOOKS, ...extra]);
  h.send(userMsg(prompt));
  await h.waitResult(1, 120000); await h.end(); dump(name, h);
  const r = resultsOf(h.events)[0];
  return { h, r, tools: toolEvents(h) };
}

const host = await startMcpHost({ logFile: new URL('./out/p3_host_calls.jsonl', import.meta.url).pathname });
// 1. working config
{
  const { h, r, tools } = await run('p3_ok', host.config(),
    'Use the app tools in this order: (1) ui_create_folder with name "Alpha"; (2) ui_move_session moving session_id "s1" into the id of the new folder returned by step 1; (3) ui_open_file with path "/tmp/notes.md". Then reply with just: done');
  report.ok = { init: mcpInit(h), result: String(r?.result).slice(0, 100), cost: r?.total_cost_usd, tool_uses: tools.uses, tool_results: tools.results, host_state_after: host.state, host_rpc_methods: host.calls.filter((c) => c.kind === 'rpc').map((c) => c.method) };
}
// 2. error path
{
  const { h, r, tools } = await run('p3_err', host.config(), 'Call ui_move_session with session_id "nope" and folder_id "root". Then quote the exact error text the tool returned, and nothing else.');
  report.error_path = { result: String(r?.result).slice(0, 200), tool_results: tools.results, agent_saw_error_text: /unknown session: nope/.test(String(r?.result)) };
}
// 3. missing type
{
  const cfg = host.config(); delete cfg.mcpServers.app.type;
  const { h, r, tools } = await run('p3_notype', cfg, 'Call ui_state and say what it returned. If the tool does not exist, say: no such tool.');
  report.missing_type = { init: mcpInit(h), result: String(r?.result).slice(0, 200), tool_uses: tools.uses, stderr: h.stderr.slice(0, 400) };
}
// 4. wrong token
{
  const cfg = host.config(); cfg.mcpServers.app.headers.Authorization = 'Bearer wrong';
  const before = host.rejected.length;
  const { h, r } = await run('p3_badtoken', cfg, 'Call ui_state and say what it returned. If the tool does not exist, say: no such tool.');
  report.wrong_token = { init: mcpInit(h), result: String(r?.result).slice(0, 200), host_rejections: host.rejected.slice(before) };
}
// 5. streamable-http alias
{
  const cfg = host.config({ type: 'streamable-http' });
  const { h } = await run('p3_alias', cfg, 'say ok');
  report.alias_streamable_http = { init: mcpInit(h) };
}
await host.close();
save('p3_report.json', report);
console.log(JSON.stringify(report, null, 1));
