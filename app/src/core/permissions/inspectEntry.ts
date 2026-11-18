import { readFileSync } from 'node:fs';
import { inspectCommand } from './inspectCommand';

/**
 * Entry of the `PreToolUse` hook command: `inspect.js <gate file>`, payload on stdin. Any failure ends in exit 0
 * with no decision, so the mode and the static ask rules decide.
 */
try {
  const output = inspectCommand(process.argv[2], () => readFileSync(0, 'utf8'));
  if (output !== '') process.stdout.write(output);
} catch {
  process.exitCode = 0;
}
