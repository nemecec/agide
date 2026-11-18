import type { CommandRegistry } from '../commands/CommandRegistry';
import { inputJsonSchema, type JsonSchemaObject } from '../commands/jsonSchema';
import { isImageResult } from '../commands/imageResult';
import type { Caller, Command } from '../commands/types';
import type { McpServerName } from './types';

export interface McpTool {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: JsonSchemaObject;
}

export interface McpToolResult {
  [key: string]: unknown;
  content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[];
  isError?: boolean;
}

const BROWSER_PREFIX = 'browser_';

const serverOf = (command: Command): McpServerName => command.mcpServer ?? 'app';

/** The tool name of a command on its server. */
export function toolName(command: Command): string {
  return serverOf(command) === 'agide-browser' && command.id.startsWith(BROWSER_PREFIX) ? command.id.slice(BROWSER_PREFIX.length) : command.id;
}

/** The command a tool name of `server` runs, or undefined when no MCP command of that server has the name. */
export function commandForTool(registry: CommandRegistry, server: McpServerName, name: string): Command | undefined {
  return registry.list({ mcp: true }).find((command) => serverOf(command) === server && toolName(command) === name);
}

/** One tool per command with `mcp: true` on `server`, read from the registry on every call so late registrations show up. */
export function toolsFrom(registry: CommandRegistry, server: McpServerName = 'app'): McpTool[] {
  return registry.list({ mcp: true }).filter((command) => serverOf(command) === server).map((command) => ({
    name: toolName(command),
    title: command.title,
    description: command.description,
    inputSchema: inputJsonSchema(command),
  }));
}

/** Runs a tool of `server` as the MCP caller. A failed command is a tool result with `isError`, not a protocol error. */
export async function callTool(registry: CommandRegistry, name: string, args: unknown, caller: Caller, server: McpServerName = 'app'): Promise<McpToolResult> {
  const command = commandForTool(registry, server, name);
  if (!command) return { isError: true, content: [{ type: 'text', text: `not_found: no command ${name}` }] };
  const result = await registry.invoke(command.id, args, caller);
  if (result.ok && isImageResult(result.value)) {
    const { data, mimeType, ...details } = result.value;
    const { untrusted, ...rest } = details as { untrusted?: unknown };
    const label = typeof untrusted === 'string' ? `${untrusted}\n` : '';
    return { content: [{ type: 'image', data, mimeType }, { type: 'text', text: `${label}${JSON.stringify(rest)}` }] };
  }
  if (result.ok && typeof result.value === 'string') return { content: [{ type: 'text', text: result.value }] };
  if (result.ok) return { content: [{ type: 'text', text: JSON.stringify(result.value ?? null) }] };
  return { isError: true, content: [{ type: 'text', text: `${result.error.code}: ${result.error.message}` }] };
}
