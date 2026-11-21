/**
 * The step language of the fake agents: each line of a user message that starts with `/` is a step, other
 * lines are ignored, and a message without steps gets the reply `echo: <message>`. The stream-json fake CLI
 * (`fixtures/fake-claude-stream.mjs`) reads the same language, so the runtime contract suite drives both.
 *
 * | Step | Effect |
 * |---|---|
 * | `/text <words>` | an assistant message with usage; its words become the result text |
 * | `/tool <name> <json input>` | a `can_use_tool` request; the turn waits for the answer |
 * | `/cost <usd>` | sets the cumulative cost the next result reports |
 * | `/sleep <ms>` | waits; an interrupt ends the wait |
 * | `/fail <terminal reason>` | ends the turn with an error result |
 * | `/exit <code>` | the process exits without a result |
 * | `/write <file> <text>` | writes a file in the working directory (the CLI fake only) |
 */
export type FakeStep =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'tool'; readonly name: string; readonly input: Record<string, unknown> }
  | { readonly kind: 'cost'; readonly usd: number }
  | { readonly kind: 'sleep'; readonly ms: number }
  | { readonly kind: 'fail'; readonly reason: string }
  | { readonly kind: 'exit'; readonly code: number }
  | { readonly kind: 'write'; readonly file: string; readonly text: string };

export function parseFakeSteps(message: string): FakeStep[] {
  const steps: FakeStep[] = [];
  for (const line of message.split('\n')) {
    const match = /^\/(\w+)(?:\s+(.*))?$/.exec(line.trim());
    if (match === null) continue;
    const [, name, rest = ''] = match;
    switch (name) {
      case 'text':
        steps.push({ kind: 'text', text: rest });
        break;
      case 'tool': {
        const space = rest.indexOf(' ');
        const toolName = space < 0 ? rest : rest.slice(0, space);
        const input = space < 0 ? {} : (JSON.parse(rest.slice(space + 1)) as Record<string, unknown>);
        steps.push({ kind: 'tool', name: toolName, input });
        break;
      }
      case 'cost':
        steps.push({ kind: 'cost', usd: Number(rest) });
        break;
      case 'sleep':
        steps.push({ kind: 'sleep', ms: Number(rest) });
        break;
      case 'fail':
        steps.push({ kind: 'fail', reason: rest || 'api_error' });
        break;
      case 'exit':
        steps.push({ kind: 'exit', code: Number(rest || '0') });
        break;
      case 'write': {
        const space = rest.indexOf(' ');
        steps.push({ kind: 'write', file: space < 0 ? rest : rest.slice(0, space), text: space < 0 ? '' : rest.slice(space + 1) });
        break;
      }
    }
  }
  if (steps.length === 0) steps.push({ kind: 'text', text: `echo: ${message}` });
  return steps;
}

/** Cost each fake assistant message adds when no `/cost` step sets it. */
export const FAKE_COST_PER_MESSAGE_USD = 0.001;
