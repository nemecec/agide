import type { McpConfigJson, McpGrant } from './types';

export function mcpConfigFor(grant: McpGrant): McpConfigJson {
  return {
    mcpServers: { app: { type: 'http', url: grant.url, headers: { Authorization: `Bearer ${grant.token}` } } },
  };
}

export function sessionUrl(port: number, sessionId: string): string {
  return `http://127.0.0.1:${port}/mcp/${encodeURIComponent(sessionId)}`;
}
