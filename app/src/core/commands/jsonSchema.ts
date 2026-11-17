import { z } from 'zod';
import type { Command } from './types';

export type JsonSchemaObject = { type: 'object'; properties?: Record<string, unknown>; required?: string[]; [key: string]: unknown };

/** The input schema of a command as the JSON Schema an MCP client shows the model. */
export function inputJsonSchema(command: Pick<Command, 'input'>): JsonSchemaObject {
  const { $schema: _dropped, ...schema } = z.toJSONSchema(command.input, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
  if (schema.type !== 'object') throw new Error('a command input schema must be a zod object');
  return schema as JsonSchemaObject;
}

/** `title (required), index (optional)`: the fields a command accepts, for error messages. */
export function describeFields(command: Pick<Command, 'input'>): string {
  const { properties = {}, required = [] } = inputJsonSchema(command);
  const names = Object.keys(properties);
  if (names.length === 0) return 'no fields';
  return names.map((name) => `${name} (${required.includes(name) ? 'required' : 'optional'})`).join(', ');
}
