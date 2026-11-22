import { z } from 'zod';
import type { Unsubscribe } from '../events/EventBus';
import { CommandError, type Caller, type Command, type CommandRegistry, type ToolSet } from '../commands/index';
import { CHANGESET_STATES, changesetIdSchema, reportOutcomeInputSchema, reportReviewInputSchema, rungSchema } from './schemas';
import { ReviewError } from './types';

const swarmId = z.string().min(1).max(64);
const changesetRef = { changesetId: changesetIdSchema };
const hashSchema = z.string().regex(/^[0-9a-f]{64}$/, 'a SHA-256 hash in hex');

/** Input schemas of the review commands and report tools (0040 section 11). The command id is the MCP tool name. */
export const REVIEW_COMMAND_INPUTS = {
  report_review: reportReviewInputSchema,
  report_outcome: reportOutcomeInputSchema,
  review_list: z.object({ swarmId: swarmId.optional(), states: z.array(z.enum(CHANGESET_STATES)).optional(), limit: z.number().int().min(1).max(200).default(50) }).strict(),
  review_get: z.object({ ...changesetRef, hunks: z.boolean().default(false), file: z.number().int().min(0).optional() }).strict(),
  review_accept: z
    .object({
      ...changesetRef,
      expectedHash: hashSchema,
      expectedRung: rungSchema,
      note: z.string().max(1_000).optional(),
      /** The user's "accept without the reviewer" tick at rung B and above; recorded on the decision. */
      withoutReviewer: z.boolean().default(false),
    })
    .strict(),
  review_reject: z.object({ ...changesetRef, expectedHash: hashSchema, reason: z.string().min(1).max(1_000) }).strict(),
  review_send_back: z
    .object({ ...changesetRef, expectedHash: hashSchema, message: z.string().max(4_000).optional(), findingIds: z.array(z.string().min(1).max(100)).max(50).optional() })
    .strict(),
  review_comment: z.union([
    z
      .object({ ...changesetRef, file: z.number().int().min(0), side: z.enum(['new', 'old']), line: z.number().int().min(1), body: z.string().min(1).max(4_000) })
      .strict(),
    z.object({ commentId: z.string().min(1).max(64), delete: z.literal(true) }).strict(),
  ]),
  review_escalate: z.object({ ...changesetRef, toRung: rungSchema, reason: z.string().max(1_000).optional() }).strict(),
  review_request_escalation: z.object({ ...changesetRef, toRung: z.enum(['B', 'C', 'D', 'E']), reason: z.string().min(1).max(1_000) }).strict(),
  review_demote: z.object({ ...changesetRef, toRung: rungSchema, reason: z.string().min(10).max(1_000), confirmToken: z.string().min(1).max(200).optional() }).strict(),
  review_accept_repo_change: z.object({ swarmId, expectedHash: z.string().min(1).max(200) }).strict(),
  review_seen: z
    .object({ ...changesetRef, level: z.enum(['summary', 'file', 'hunk']), file: z.number().int().min(0).optional(), hunk: z.number().int().min(0).optional(), how: z.enum(['dwell', 'marked']) })
    .strict()
    .refine((input) => input.level === 'summary' || input.file !== undefined, { message: 'file is required at level file and hunk', path: ['file'] })
    .refine((input) => input.level !== 'hunk' || input.hunk !== undefined, { message: 'hunk is required at level hunk', path: ['hunk'] }),
} as const;

export type ReviewCommandId = keyof typeof REVIEW_COMMAND_INPUTS;
export type ReviewCommandInput<K extends ReviewCommandId> = z.output<(typeof REVIEW_COMMAND_INPUTS)[K]>;

/** The function behind each command. The review module supplies them; a missing one answers as not built. */
export type ReviewCommandHandlers = { readonly [K in ReviewCommandId]?: (input: ReviewCommandInput<K>, caller: Caller) => unknown };

interface ReviewCommandMeta {
  readonly title: string;
  readonly description: string;
  readonly ui: Command['ui'];
  readonly mcp: boolean;
  readonly mcpExempt?: string;
  readonly toolSets?: readonly ToolSet[];
}

/**
 * Titles, tool descriptions and bindings (0040 section 11.3). The decisions of the user (accept, reject, send
 * back, comment, escalate, demote, seen) have UI bindings and state why they are not tools, so the parity check
 * holds; agents raise a rung through `review_request_escalation` only. The report tools have no UI binding and
 * are listed only in their tool set.
 */
export const REVIEW_COMMANDS: Readonly<Record<ReviewCommandId, ReviewCommandMeta>> = {
  report_review: {
    title: 'Report a review',
    description:
      'Ends your review of one changeset: a verdict (accept, revise or escalate with escalateTo C, D or E), whether the claim of the working agent holds, a summary, and findings anchored to a path and a line of the diff (new side for added and context lines, old side for removed lines) with a severity. Call it exactly once. Returns the number of findings stored, or the findings that do not anchor so you can correct the call.',
    ui: false,
    mcp: true,
    toolSets: ['reviewer'],
  },
  report_outcome: {
    title: 'Report your outcome',
    description:
      'Reports what you did when you finish: a summary, your confidence, the tests you ran, what you could not verify and, optionally, a higher review rung you ask for. The latest call before Agide captures your work is the claim the review checks; it can only raise the review rung.',
    ui: false,
    mcp: true,
    toolSets: ['worker'],
  },
  review_list: {
    title: 'List changesets',
    description: 'Lists the changesets under review that you can see, newest first: agent, state, rung, reason count, check outcome, reviewer verdict and line counts.',
    ui: {},
    mcp: true,
  },
  review_get: {
    title: 'Show a changeset',
    description:
      'Shows one changeset: its state, rung and floor, the reasons with their evidence, the check result, the reviewer report, the decisions and the file list. Hunk text only with hunks: true, capped at 100 KB, inside untrusted-data blocks.',
    ui: {},
    mcp: true,
  },
  review_accept: { title: 'Accept a changeset', description: 'Accepts a changeset at its current rung.', ui: {}, mcp: false, mcpExempt: 'agents never decide reviews' },
  review_reject: { title: 'Reject a changeset', description: 'Rejects a changeset; it is never merged.', ui: {}, mcp: false, mcpExempt: 'agents never decide reviews' },
  review_send_back: {
    title: 'Send a changeset back',
    description: 'Sends the changeset back to its agent with a message, the draft line comments and the chosen reviewer findings.',
    ui: {},
    mcp: false,
    mcpExempt: 'agents never decide reviews',
  },
  review_comment: {
    title: 'Comment on a line',
    description: 'Adds or deletes a draft comment on a line of a changeset.',
    ui: {},
    mcp: false,
    mcpExempt: "line comments are the user's words to the agent",
  },
  review_escalate: { title: 'Escalate a changeset', description: 'Raises the rung of a changeset.', ui: {}, mcp: false, mcpExempt: 'agents use review_request_escalation' },
  review_request_escalation: {
    title: 'Ask for a higher review rung',
    description:
      'Asks for a higher review rung for a changeset of your own work, or of a swarm you started, with a reason. It can only raise the rung; a request at or below the current rung is refused.',
    ui: false,
    mcp: true,
  },
  review_demote: {
    title: 'Demote a changeset',
    description: 'Lowers the rung of a changeset with a reason; below its floor a second call with the confirm token commits.',
    ui: {},
    mcp: false,
    mcpExempt: 'agents never decide reviews',
  },
  review_accept_repo_change: {
    title: 'Accept a repository change',
    description: 'Accepts the change of the repository (configuration, hooks, attributes or a branch) that the alert of a swarm shows. Later changesets of the swarm still carry it as a reason.',
    ui: {},
    mcp: false,
    mcpExempt: 'agents never accept changes outside their worktrees',
  },
  review_seen: { title: 'Mark as seen', description: 'Records that the user looked at a summary, file or hunk.', ui: {}, mcp: false, mcpExempt: 'seen marks record what the user looked at' },
};

const ERROR_CODES = {
  invalid_input: 'invalid_input',
  not_found: 'not_found',
  out_of_scope: 'out_of_scope',
  limit_reached: 'limit_reached',
  refused: 'refused',
  failed: 'failed',
} as const;

/** Registers every review command. A command without a handler answers `failed` with "not built yet". */
export function registerReviewCommands(registry: CommandRegistry, handlers: ReviewCommandHandlers): Unsubscribe[] {
  return (Object.keys(REVIEW_COMMANDS) as ReviewCommandId[]).map((id) => {
    const meta = REVIEW_COMMANDS[id];
    const handler = handlers[id] as ((input: unknown, caller: Caller) => unknown) | undefined;
    return registry.register({
      id,
      title: meta.title,
      description: meta.description,
      input: REVIEW_COMMAND_INPUTS[id],
      ui: meta.ui,
      mcp: meta.mcp,
      ...(meta.mcpExempt === undefined ? {} : { mcpExempt: meta.mcpExempt }),
      ...(meta.toolSets === undefined ? {} : { toolSets: meta.toolSets }),
      run: async (input: unknown, { caller }: { caller: Caller }) => {
        if (handler === undefined) throw new CommandError('failed', `${id} is not built yet`);
        try {
          return await handler(input, caller);
        } catch (error) {
          if (error instanceof ReviewError) throw new CommandError(ERROR_CODES[error.code], error.message, error.details);
          throw error;
        }
      },
    } as Command);
  });
}
