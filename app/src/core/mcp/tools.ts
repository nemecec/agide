import type { CommandRegistry } from '../commands/CommandRegistry';
import { inputJsonSchema, type JsonSchemaObject } from '../commands/jsonSchema';
import { isImageResult } from '../commands/imageResult';
import type { Caller } from '../commands/types';

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

/** One tool per command with `mcp: true`, read from the registry on every call so late registrations show up. */
export function toolsFrom(registry: CommandRegistry): McpTool[] {
  return registry.list({ mcp: true }).map((command) => ({
    name: command.id,
    title: command.title,
    description: command.description,
    inputSchema: inputJsonSchema(command),
  }));
}

/** Runs a tool as the MCP caller. A failed command is a tool result with `isError`, not a protocol error. */
export async function callTool(registry: CommandRegistry, name: string, args: unknown, caller: Caller): Promise<McpToolResult> {
  const result = await registry.invoke(name, args, caller);
  if (result.ok && isImageResult(result.value)) {
    const { data, mimeType, ...details } = result.value;
    return { content: [{ type: 'image', data, mimeType }, { type: 'text', text: JSON.stringify(details) }] };
  }
  if (result.ok) return { content: [{ type: 'text', text: JSON.stringify(result.value ?? null) }] };
  return { isError: true, content: [{ type: 'text', text: `${result.error.code}: ${result.error.message}` }] };
}
