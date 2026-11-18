// README: node pb1_server_names.mjs  -- PB1: which MCP server names the CLI accepts for the app's hosted browser tools.
// One `claude -p` run on Haiku with --strict-mcp-config and one HTTP server registered under several candidate names.
// Reports, per name, the status in system/init and whether its tools are listed. Makes no tool call.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startMcpHost } from './mcp_host.mjs';
import { startStream, userMsg, initOf, resultsOf, save, NOHOOKS } from './lib.mjs';

const NAMES = ['browser', 'agide-browser', 'agide_browser', 'claude-in-chrome', 'app'];

const host = await startMcpHost();
const base = host.config().mcpServers.app;
const cfg = { mcpServers: Object.fromEntries(NAMES.map((n) => [n, base])) };
const cwd = mkdtempSync(join(tmpdir(), 'agide-pb1-'));
try {
  const h = startStream(['--permission-mode', 'default', '--mcp-config', JSON.stringify(cfg), '--strict-mcp-config', ...NOHOOKS], { cwd });
  h.send(userMsg('Reply with just: ok'));
  await h.waitResult(1, 120000);
  await h.end();
  const init = initOf(h.events);
  const r = resultsOf(h.events)[0];
  const report = {
    cli_mcp_servers: init?.mcp_servers,
    tools_per_name: Object.fromEntries(NAMES.map((n) => [n, (init?.tools ?? []).filter((t) => t.startsWith(`mcp__${n}__`))])),
    other_mcp_tools: (init?.tools ?? []).filter((t) => t.startsWith('mcp__') && !NAMES.some((n) => t.startsWith(`mcp__${n}__`))),
    stderr_head: h.stderr.slice(0, 2000),
    cost: r?.total_cost_usd,
  };
  save('pb1_server_names.json', report);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await host.close();
  rmSync(cwd, { recursive: true, force: true });
}
