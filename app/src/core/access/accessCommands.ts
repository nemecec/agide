import { z } from 'zod';
import type { CommandRegistry } from '../commands/CommandRegistry';
import { notBuilt } from '../commands/notBuilt';
import type { CommandContext } from '../commands/types';
import { ACCESS_ACTIONS, ACCESS_MESSAGE_MAX_CHARS, type AccessDetail, type AccessGrant, type AccessRequestRecord, type AccessResultValue } from './types';

/** The commands of access requests (0043 sections 4.8 and 4.10): the schemas, and the registration with the handlers a builder fills. */

const requestId = z.string().min(1).max(64);
const action = z.enum(ACCESS_ACTIONS);

export const accessRequestResultInput = z
  .object({ requestId, waitSeconds: z.number().int().min(0).max(600).default(0).describe('Waits up to this long for the decision; at most the access wait of the profile') })
  .strict();

export const accessRequestGetInput = z.object({ requestId }).strict();

export const accessDecideInput = z
  .object({
    requestId,
    decision: z.enum(['once', 'session', 'always', 'deny']),
    message: z.string().min(1).max(ACCESS_MESSAGE_MAX_CHARS).optional().describe('The text the agent gets with a deny'),
    expectedRevision: z.number().int().nonnegative().optional(),
    expectedSha256: z.string().regex(/^[0-9a-f]{64}$/).nullable().optional(),
    expectedDigest: z.string().min(1).max(128).optional().describe('The digest of the removal list the card showed'),
  })
  .strict()
  .refine((value) => value.decision === 'deny' || value.message === undefined, 'only a deny carries a message');

export const accessGrantsListInput = z.object({ sessionId: z.string().min(1).max(64).optional() }).strict();

export const accessGrantRevokeInput = z.object({ sessionId: z.string().min(1).max(64), action, targetId: z.string().min(1).max(64) }).strict();

export interface AccessCommandHandlers {
  requestResult(input: z.output<typeof accessRequestResultInput>, ctx: CommandContext): Promise<AccessResultValue>;
  requestGet(input: z.output<typeof accessRequestGetInput>, ctx: CommandContext): Promise<{ record: AccessRequestRecord; detail: AccessDetail }>;
  decide(input: z.output<typeof accessDecideInput>, ctx: CommandContext): Promise<AccessRequestRecord>;
  grantsList(input: z.output<typeof accessGrantsListInput>, ctx: CommandContext): readonly AccessGrant[];
  grantRevoke(input: z.output<typeof accessGrantRevokeInput>, ctx: CommandContext): unknown;
}

/** Until w-access fills them, each handler answers `not_built`. */
export const NOT_BUILT_ACCESS_HANDLERS: AccessCommandHandlers = {
  requestResult: () => notBuilt('access_request_result'),
  requestGet: () => notBuilt('access_request_get'),
  decide: () => notBuilt('access_decide'),
  grantsList: () => notBuilt('access_grants_list'),
  grantRevoke: () => notBuilt('access_grant_revoke'),
};

const USER_ONLY = 'Only the user decides on and revokes access; an agent must not answer, widen or reuse its own request.';

/** Registers `access_request_result` (an agent tool) and the user's commands that decide and show access. */
export function registerAccessCommands(registry: CommandRegistry, handlers: AccessCommandHandlers = NOT_BUILT_ACCESS_HANDLERS): () => void {
  const off = [
    registry.register({
      id: 'access_request_result',
      title: 'Read the result of an access request',
      description:
        'Reads the decision on an access request that a tool of yours raised: { state: "pending" | "allowed" | "denied" | "expired" | "withdrawn" }. When the user allowed a read, it runs here, once, and the content comes back. waitSeconds waits for the decision. Call it when you are told that an access request was decided. A request of another session answers not_found.',
      input: accessRequestResultInput,
      ui: false,
      mcp: true,
      run: (input, ctx) => handlers.requestResult(input, ctx),
    }),
    registry.register({
      id: 'access_request_get',
      title: 'Show an access request',
      description: 'The record and the card detail of an access request, computed now by the owner of the target.',
      input: accessRequestGetInput,
      ui: {},
      mcp: false,
      mcpExempt: 'The card of the user shows it; an agent reads its own request with access_request_result.',
      run: (input, ctx) => handlers.requestGet(input, ctx),
    }),
    registry.register({
      id: 'access_decide',
      title: 'Decide on an access request',
      description: 'Allows once, for the session or always, or denies an access request, with the revision or hash the card showed.',
      input: accessDecideInput,
      ui: {},
      mcp: false,
      mcpExempt: USER_ONLY,
      run: (input, ctx) => handlers.decide(input, ctx),
    }),
    registry.register({
      id: 'access_grants_list',
      title: 'List access grants',
      description: 'The session grants that sessions hold: action, target and since when.',
      input: accessGrantsListInput,
      ui: {},
      mcp: false,
      mcpExempt: USER_ONLY,
      run: (input, ctx) => handlers.grantsList(input, ctx),
    }),
    registry.register({
      id: 'access_grant_revoke',
      title: 'Revoke an access grant',
      description: 'Ends a session grant of access to a target.',
      input: accessGrantRevokeInput,
      ui: {},
      mcp: false,
      mcpExempt: USER_ONLY,
      run: (input, ctx) => handlers.grantRevoke(input, ctx),
    }),
  ];
  return () => off.forEach((unregister) => unregister());
}
