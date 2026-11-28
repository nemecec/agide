import { z } from 'zod';
import type { CommandRegistry } from '../commands/CommandRegistry';
import { notBuilt } from '../commands/notBuilt';
import type { CommandContext } from '../commands/types';
import { ASK_ANSWER_TEXT_MAX, ASK_MAX_SECONDS, ASK_MIN_SECONDS, type InboxAskInput, type InboxAskResult, type InboxAskResultValue } from './askTypes';
import { postLink } from './inboxCommands';

export { APP_MCP_TIMEOUT_MS, ASK_MAX_SECONDS, ASK_MIN_SECONDS, ASK_OPEN_PER_SESSION, ASK_RETURN_MARGIN_MS } from './askTypes';

/** The commands of `inbox_ask` (0043 sections 4.4 and 4.8): the schemas, and the registration with the handlers a builder fills. */

const askOption = z
  .object({
    id: z.string().regex(/^[a-z0-9_-]{1,32}$/).describe('Lower case letters, digits, hyphen and underscore'),
    label: z.string().min(1).max(60),
  })
  .strict();

export const inboxAskInput = z
  .object({
    question: z.string().min(1).max(140).describe('One line the user reads in the list and the notification'),
    details: z.string().max(8000).optional().describe('The longer description; plain text'),
    options: z.array(askOption).max(6).default([]).describe('Answers the user picks from; the result carries the id'),
    allowFreeText: z.boolean().optional().describe('Default: true when there are no options'),
    timeoutSeconds: z.number().int().min(ASK_MIN_SECONDS).max(ASK_MAX_SECONDS).default(600).describe('How long the call waits for the answer'),
    wait: z.boolean().default(true).describe('false returns at once; read the answer later with inbox_ask_result'),
    link: postLink.optional(),
  })
  .strict()
  .refine((value) => new Set(value.options.map((option) => option.id)).size === value.options.length, 'option ids must differ')
  .refine((value) => value.options.length > 0 || value.allowFreeText !== false, 'a question needs options or free text');

export type { InboxAskInput } from './askTypes';

export const inboxAskResultInput = z.object({ askId: z.string().min(1).max(64) }).strict();

export const inboxAnswerInput = z
  .object({ itemId: z.string().min(1).max(64), choice: z.string().regex(/^[a-z0-9_-]{1,32}$/).optional(), text: z.string().min(1).max(ASK_ANSWER_TEXT_MAX).optional() })
  .strict()
  .refine((value) => value.choice !== undefined || value.text !== undefined, 'an answer needs a choice or text');

export interface AskCommandHandlers {
  ask(input: InboxAskInput, ctx: CommandContext): Promise<InboxAskResult> | InboxAskResult;
  result(input: z.output<typeof inboxAskResultInput>, ctx: CommandContext): InboxAskResultValue;
  answer(input: z.output<typeof inboxAnswerInput>, ctx: CommandContext): unknown;
}

/** Until w-ask fills them, each handler answers `not_built`. */
export const NOT_BUILT_ASK_HANDLERS: AskCommandHandlers = {
  ask: () => notBuilt('inbox_ask'),
  result: () => notBuilt('inbox_ask_result'),
  answer: () => notBuilt('inbox_answer'),
};

/** Registers `inbox_ask` and `inbox_ask_result` (agent tools) and `inbox_answer` (the user's answer from the card). */
export function registerAskCommands(registry: CommandRegistry, handlers: AskCommandHandlers = NOT_BUILT_ASK_HANDLERS): () => void {
  const off = [
    registry.register({
      id: 'inbox_ask',
      title: 'Ask the user a question',
      description:
        'Asks the user a question through the inbox and, by default, waits for the answer. Give one line as the question and up to six options with a short id and a label, or allow free text. Returns the answer as { status: "answered", choice?, text? }; { status: "timeout" } when the wait ended first (the answer is announced later; read it with inbox_ask_result); { status: "queued" } with wait false; { status: "dismissed" } when the user withdrew the question. At most three questions of a session stay open. Use it when you cannot go on without the user; use inbox_post for updates.',
      input: inboxAskInput,
      ui: false,
      mcp: true,
      run: (input, ctx) => handlers.ask(input, ctx),
    }),
    registry.register({
      id: 'inbox_ask_result',
      title: 'Read the answer to a question',
      description:
        'Reads the answer to a question you asked with inbox_ask: { status: "answered" | "pending" | "dismissed" | "cancelled" }, with the choice or the text of the user. Call it when you are told that an inbox question was answered. A question of another session answers not_found.',
      input: inboxAskResultInput,
      ui: false,
      mcp: true,
      run: (input, ctx) => handlers.result(input, ctx),
    }),
    registry.register({
      id: 'inbox_answer',
      title: 'Answer an inbox question',
      description: 'Answers a question an agent asked with inbox_ask: an option id or free text. The user answers from the card of the item.',
      input: inboxAnswerInput,
      ui: {},
      mcp: false,
      mcpExempt: 'Only the user answers questions; an agent must not answer for the user.',
      run: (input, ctx) => handlers.answer(input, ctx),
    }),
  ];
  return () => off.forEach((unregister) => unregister());
}
