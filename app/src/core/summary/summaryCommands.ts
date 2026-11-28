import { z } from 'zod';
import type { CommandRegistry } from '../commands/CommandRegistry';
import { notBuilt } from '../commands/notBuilt';
import type { CommandContext } from '../commands/types';
import type { SessionSummaryView } from './types';

/** The commands of session summaries (0043 sections 4.7 and 4.8): the schemas, and the registration with the handlers a builder fills. */

export const sessionSummaryInput = z.object({ sessionId: z.string().min(1).max(64) }).strict();

export interface SummaryCommandHandlers {
  summarize(input: z.output<typeof sessionSummaryInput>, ctx: CommandContext): Promise<SessionSummaryView>;
  get(input: z.output<typeof sessionSummaryInput>, ctx: CommandContext): SessionSummaryView | null;
}

/** Until w-summary fills them, each handler answers `not_built`. */
export const NOT_BUILT_SUMMARY_HANDLERS: SummaryCommandHandlers = {
  summarize: () => notBuilt('session_summarize'),
  get: () => notBuilt('session_summary_get'),
};

/** Registers `session_summarize` and `session_summary_get`. A run costs a model call on the user's subscription, so no agent starts one. */
export function registerSummaryCommands(registry: CommandRegistry, handlers: SummaryCommandHandlers = NOT_BUILT_SUMMARY_HANDLERS): () => void {
  const off = [
    registry.register({
      id: 'session_summarize',
      title: 'Summarize session',
      description: 'Asks the small model for a short summary of the session\'s transcript. It shows on the session\'s row in the tree.',
      input: sessionSummaryInput,
      ui: { menu: 'tree-node' },
      mcp: false,
      mcpExempt: 'It starts a model run on the user\'s subscription; only a click of the user does.',
      run: (input, ctx) => handlers.summarize(input, ctx),
    }),
    registry.register({
      id: 'session_summary_get',
      title: 'Get the summary of a session',
      description: 'The stored summary of a session with its age and whether it is out of date, or null.',
      input: sessionSummaryInput,
      ui: {},
      mcp: false,
      mcpExempt: 'The tree row shows it to the user.',
      run: (input, ctx) => handlers.get(input, ctx),
    }),
  ];
  return () => off.forEach((unregister) => unregister());
}
