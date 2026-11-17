// Checks that every command with a UI binding is an MCP tool (or states why not) over the command registry
// the app builds from its modules, and writes docs/parity.md.
// Usage: pnpm parity
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { loadTs } from './lib/loadTs.mjs';

const DOC = fileURLToPath(new URL('../../docs/parity.md', import.meta.url));

const { modules, close } = await loadTs(['/src/main/appForTests.ts', '/src/core/commands/index.ts']);
const [{ startAppModules }, { checkParity, renderParityMarkdown }] = modules;
const app = await startAppModules();
let client;
try {
  const folder = (await app.commands.invoke('ui_create_folder', { title: 'parity' }, { kind: 'ui' })).value;
  const grant = app.services.mcp.grant('parity', folder.id);
  client = new Client({ name: 'parity', version: '0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(grant.url), { requestInit: { headers: { Authorization: `Bearer ${grant.token}` } } }));
  const toolNames = (await client.listTools()).tools.map((tool) => tool.name);
  const report = checkParity(app.commands.list(), toolNames);
  mkdirSync(dirname(DOC), { recursive: true });
  writeFileSync(DOC, renderParityMarkdown(report));
  if (report.missing.length > 0) {
    console.error(`UI-bound commands without an MCP tool: ${report.missing.join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log(`parity ok, wrote ${DOC}`);
  }
} finally {
  await client?.close();
  await app.close();
  await close();
}
