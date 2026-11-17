import { existsSync, readFileSync, statSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { McpConfigJson } from '../src/core/mcp/types';

/** One `claude` launch as a fake executable recorded it in `FAKE_CLAUDE_RECORD`. */
export interface RecordedLaunch {
  readonly args: string[];
  /** Mode and content of the `--mcp-config` file at launch (recorded by `fake-claude.mjs` only). */
  readonly mcpConfigFile?: { readonly mode: number; readonly content: string };
}

export function recordedLaunches(file: string): RecordedLaunch[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as RecordedLaunch);
}

export const flag = (args: readonly string[], name: string): string | undefined => {
  const at = args.indexOf(name);
  return at < 0 ? undefined : args[at + 1];
};

/** The session's MCP config as the CLI read it at launch. The app removes the file after the first SessionStart. */
export function sessionMcpConfig(launch: RecordedLaunch): { path: string; mode: number; config: McpConfigJson } {
  const path = flag(launch.args, '--mcp-config');
  if (path === undefined) throw new Error('the launch has no --mcp-config');
  if (launch.mcpConfigFile !== undefined) return { path, mode: launch.mcpConfigFile.mode, config: JSON.parse(launch.mcpConfigFile.content) as McpConfigJson };
  return { path, mode: statSync(path).mode & 0o777, config: JSON.parse(readFileSync(path, 'utf8')) as McpConfigJson };
}

/** Connects to the app MCP server the way the launched session would. */
export async function connectAsSession(launch: RecordedLaunch): Promise<Client> {
  const server = sessionMcpConfig(launch).config.mcpServers.app;
  const client = new Client({ name: 'e2e', version: '0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers: server.headers } }));
  return client;
}

export function toolJson<T>(result: unknown): T {
  const content = (result as { content: { type: string; text: string }[] }).content;
  return JSON.parse(content.find((part) => part.type === 'text')?.text ?? 'null') as T;
}
