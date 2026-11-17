// README: node proj_mcp_server.mjs <marker_dir>  -- minimal stdio MCP server for the P9 fixture checkout. Writes marker_dir/mcp_started.txt when launched and exposes one harmless tool, proj_ping.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
const dir = process.argv[2];
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/mcp_started.txt`, new Date().toISOString() + '\n');
const send = (o) => process.stdout.write(JSON.stringify(o) + '\n');
createInterface({ input: process.stdin }).on('line', (line) => {
  let m; try { m = JSON.parse(line); } catch { return; }
  if (m.id === undefined) return;
  if (m.method === 'initialize') send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'projfix', version: '0.0.1' } } });
  else if (m.method === 'tools/list') send({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'proj_ping', description: 'Returns pong.', inputSchema: { type: 'object', properties: {} } }] } });
  else if (m.method === 'tools/call') send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'pong' }] } });
  else send({ jsonrpc: '2.0', id: m.id, result: {} });
});
