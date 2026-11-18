// An MCP client that connects the way a launched session does, from the config the fake claude recorded.
import { existsSync, readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const flag = (args, name) => args[args.indexOf(name) + 1];

export function recordedLaunches(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

export async function connectAsSession(instance, sessionId, server = 'app') {
  const launch = recordedLaunches(instance.launches).find((entry) => flag(entry.args, '--session-id') === sessionId);
  const entry = launch?.mcpConfig?.mcpServers?.[server];
  if (!entry) throw new Error(`no ${server} MCP server recorded for session ${sessionId}`);
  const client = new Client({ name: 'visual-check', version: '0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(entry.url), { requestInit: { headers: entry.headers ?? {} } }));
  (instance.clients ??= []).push(client);
  return client;
}

export const closeClients = (instance) => Promise.allSettled((instance.clients ?? []).splice(0).map((client) => client.close()));
export const callTool = (client, name, args = {}) => client.callTool({ name, arguments: args });
