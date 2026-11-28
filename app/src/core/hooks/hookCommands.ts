import { z } from 'zod';
import type { CommandRegistry } from '../commands/CommandRegistry';
import { notBuilt } from '../commands/notBuilt';
import type { CommandContext } from '../commands/types';
import { HOOK_DENY_MESSAGE_MAX, type HookApproval } from './types';

/** The commands of hook approvals and of the mode (0043 section 4.8): the schemas, and the registration with the handlers a builder fills. */

export const hookApprovalAnswerInput = z
  .object({ itemId: z.string().min(1).max(64), behavior: z.enum(['allow', 'deny']), message: z.string().min(1).max(HOOK_DENY_MESSAGE_MAX).optional() })
  .strict()
  .refine((value) => value.behavior === 'deny' || value.message === undefined, 'only a deny carries a message');

export const sessionSetModeInput = z
  .object({
    sessionId: z.string().min(1).max(64),
    mode: z.enum(['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions']),
    confirmBypassPermissions: z.boolean().optional().describe('Required for bypassPermissions (0028)'),
  })
  .strict();

export interface HookCommandHandlers {
  approvalAnswer(input: z.output<typeof hookApprovalAnswerInput>, ctx: CommandContext): HookApproval | Promise<HookApproval>;
  setMode(input: z.output<typeof sessionSetModeInput>, ctx: CommandContext): unknown;
}

/** Until w-approvals fills them, each handler answers `not_built`. */
export const NOT_BUILT_HOOK_HANDLERS: HookCommandHandlers = {
  approvalAnswer: () => notBuilt('hook_approval_answer'),
  setMode: () => notBuilt('session_set_mode'),
};

/** Registers `hook_approval_answer` and `session_set_mode`, both the user's commands: no agent answers its own permission request or picks its own mode. */
export function registerHookCommands(registry: CommandRegistry, handlers: HookCommandHandlers = NOT_BUILT_HOOK_HANDLERS): () => void {
  const off = [
    registry.register({
      id: 'hook_approval_answer',
      title: 'Answer a permission request',
      description: 'Allows once or denies a permission request that a session holds open, with an optional message for the model on a deny.',
      input: hookApprovalAnswerInput,
      ui: {},
      mcp: false,
      mcpExempt: 'Agents never answer permission requests; the user does.',
      run: (input, ctx) => handlers.approvalAnswer(input, ctx),
    }),
    registry.register({
      id: 'session_set_mode',
      title: 'Set the permission mode of the next launch',
      description: 'Stores the permission mode the next launch of the session passes, for example the mode the session reported. bypassPermissions needs the confirmation of 0028.',
      input: sessionSetModeInput,
      ui: {},
      mcp: false,
      mcpExempt: 'Agents never choose their own permission mode.',
      run: (input, ctx) => handlers.setMode(input, ctx),
    }),
  ];
  return () => off.forEach((unregister) => unregister());
}
