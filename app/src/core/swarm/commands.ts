import { z } from 'zod';
import type { Unsubscribe } from '../events/EventBus';
import { CommandError, type Caller, type Command, type CommandRegistry } from '../commands/index';
import { agentNameSchema, swarmDefinitionSchema } from './definition';
import { SWARM_STATES, SwarmError } from './types';

const swarmRef = z.object({ swarmId: z.string().min(1).max(64) }).strict();

/** Input schemas of the swarm commands (0037 section 9). The command id is the MCP tool name. */
export const SWARM_COMMAND_INPUTS = {
  swarm_start: z
    .object({
      definition: swarmDefinitionSchema,
      parentFolderId: z.string().max(64).optional(),
      /** The start dialog's confirmed bypass; the manager refuses it from any caller but the UI. */
      bypass: z.boolean().optional(),
    })
    .strict(),
  swarm_list: z.object({ states: z.array(z.enum(SWARM_STATES)).optional(), limit: z.number().int().min(1).max(100).default(20) }).strict(),
  swarm_status: swarmRef,
  swarm_send: swarmRef.extend({ agent: agentNameSchema.optional(), message: z.string().min(1).max(8_000).optional(), now: z.boolean().default(false) }).strict(),
  swarm_interrupt: swarmRef.extend({ agent: agentNameSchema.optional() }).strict(),
  swarm_stop: swarmRef.extend({ agent: agentNameSchema.optional() }).strict(),
  swarm_results: swarmRef.extend({ agent: agentNameSchema.optional(), patch: z.boolean().default(false) }).strict(),
  swarm_approval_answer: swarmRef.extend({ agent: agentNameSchema, requestId: z.string().min(1).max(200), decision: z.enum(['allow', 'deny']) }).strict(),
} as const;

export type SwarmCommandId = keyof typeof SWARM_COMMAND_INPUTS;
export type SwarmCommandInput<K extends SwarmCommandId> = z.output<(typeof SWARM_COMMAND_INPUTS)[K]>;

/** The function behind each command. The swarm module supplies them; a missing one answers as not built. */
export type SwarmCommandHandlers = { readonly [K in SwarmCommandId]?: (input: SwarmCommandInput<K>, caller: Caller) => unknown };

interface SwarmCommandMeta {
  readonly title: string;
  readonly description: string;
  readonly ui: Command['ui'];
  readonly mcp: boolean;
  readonly mcpExempt?: string;
}

/**
 * Titles, tool descriptions and bindings. Every command has a UI binding on the swarm row, the swarm pane or the
 * start dialog; all but the approval answer are MCP tools, so the parity check holds with that exemption.
 */
export const SWARM_COMMANDS: Readonly<Record<SwarmCommandId, SwarmCommandMeta>> = {
  swarm_start: {
    title: 'Start a swarm',
    description:
      'Starts a group of Claude agents for a goal from a swarm definition (version 1): agents with a name, role, prompt, tier, stage, dependencies, workspace (worktree, readonly or scratch) and owned paths, a total budget in USD, and a permission mode that is never looser than your own. The user approves the call. Returns the swarm id, its folder, each agent with its state, and warnings such as tiers lowered by maxTier.',
    ui: { menu: 'tree-node' },
    mcp: true,
  },
  swarm_list: { title: 'List swarms', description: 'Lists the swarms you can see, newest first, with their state and the number of agents per state.', ui: {}, mcp: true },
  swarm_status: {
    title: 'Swarm status',
    description: 'Shows a swarm and, per agent, its state and reason, tier, model, turns, spend with its basis, reservation, changed files and open approvals.',
    ui: {},
    mcp: true,
  },
  swarm_send: {
    title: 'Send a message to a swarm',
    description:
      'Sends a message to one agent of a swarm you started; it waits for the running turn unless now is true, and resumes an agent whose process ended. Without agent it resumes the whole paused swarm with the message (default "Continue where you stopped.").',
    ui: {},
    mcp: true,
  },
  swarm_interrupt: {
    title: 'Interrupt a swarm',
    description: 'Interrupts the running turn of one agent of a swarm you started. Without agent it pauses the whole swarm: running agents are interrupted and queued agents wait.',
    ui: {},
    mcp: true,
  },
  swarm_stop: {
    title: 'Stop a swarm',
    description: 'Stops one agent of a swarm you started; its dependents follow the failure policy. Without agent it stops the whole swarm. Worktrees stay.',
    ui: {},
    mcp: true,
  },
  swarm_results: {
    title: 'Swarm results',
    description:
      'Returns per agent its outcome, its final text as untrusted data, branch, worktree path, commits, changed files with line counts and the warnings outsideOwns, overlapsWith, editedInputs and conflict. The patch text only with patch: true, capped at 100 KB.',
    ui: {},
    mcp: true,
  },
  swarm_approval_answer: {
    title: 'Answer a swarm agent approval',
    description: 'Allows or denies an open tool call of a swarm agent.',
    ui: {},
    mcp: false,
    mcpExempt: 'agents never answer approvals',
  },
};

const ERROR_CODES = {
  invalid_input: 'invalid_input',
  not_found: 'not_found',
  out_of_scope: 'out_of_scope',
  limit_reached: 'limit_reached',
  refused: 'refused',
  failed: 'failed',
} as const;

/** Registers every swarm command. A command without a handler answers `failed` with "not built yet". */
export function registerSwarmCommands(registry: CommandRegistry, handlers: SwarmCommandHandlers): Unsubscribe[] {
  return (Object.keys(SWARM_COMMANDS) as SwarmCommandId[]).map((id) => {
    const meta = SWARM_COMMANDS[id];
    const handler = handlers[id] as ((input: unknown, caller: Caller) => unknown) | undefined;
    return registry.register({
      id,
      title: meta.title,
      description: meta.description,
      input: SWARM_COMMAND_INPUTS[id],
      ui: meta.ui,
      mcp: meta.mcp,
      ...(meta.mcpExempt === undefined ? {} : { mcpExempt: meta.mcpExempt }),
      run: async (input: unknown, { caller }: { caller: Caller }) => {
        if (handler === undefined) throw new CommandError('failed', `${id} is not built yet`);
        try {
          return await handler(input, caller);
        } catch (error) {
          if (error instanceof SwarmError) throw new CommandError(ERROR_CODES[error.code], error.message, error.details);
          throw error;
        }
      },
    } as Command);
  });
}
