import type { z } from 'zod';
import { describeFields } from './jsonSchema';
import type { Command } from './types';

/** One line an agent can act on: what was wrong at which field, and which fields the command takes. */
export function validationMessage(command: Command, issues: readonly z.core.$ZodIssue[]): string {
  const problems = issues.map((issue) => (issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message));
  return `Invalid input for ${command.id}. ${problems.join('; ')}. Fields: ${describeFields(command)}.`;
}
