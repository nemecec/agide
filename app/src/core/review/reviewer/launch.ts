import { DEFAULT_TIERS, type TierTable } from '../../swarm/tiers';
import type { AgentLaunchSpec } from '../../swarm/runtime/types';
import type { Tier } from '../../swarm/definition';
import type { Effort } from '../../swarm/definition';
import type { ReviewPolicy } from '../policy/schema';
import { reviewerTier } from '../rungs';
import type { Rung } from '../schemas';
import type { ReviewRunRequest } from '../types';

/** The MCP tool name of `report_review` as the CLI names it. */
export const REPORT_REVIEW_TOOL = 'mcp__app__report_review';
/** `--tools`: the built-in tools a reviewer has. No Bash, no write tool, no web tool. */
export const REVIEWER_BUILTIN_TOOLS: readonly string[] = ['Read', 'Grep', 'Glob'];
/** `permissions.deny` of the reviewer's settings, on top of the removed tools. */
export const REVIEWER_DENY_RULES: readonly string[] = ['Edit(**)', 'Write(**)', 'NotebookEdit(**)', 'WebFetch', 'WebSearch'];

export interface ReviewerModel {
  readonly tier: Tier;
  readonly effort: Effort;
}

/**
 * The tier and effort of a reviewer (0040 section 10.1): the policy's tier, never below the working agent's, at
 * `effortB` for rung B and `effortHuman` for C to E. The swarm's `maxTier` does not lower a reviewer.
 */
export function resolveReviewerModel(reviewer: ReviewPolicy['reviewer'], workerTier: Tier, rung: Rung): ReviewerModel {
  return { tier: reviewerTier(reviewer.tier, workerTier), effort: rung === 'B' ? reviewer.effortB : reviewer.effortHuman };
}

export interface ReviewerLaunchContext {
  /** The read-only checkout of the checkpoint. */
  readonly cwd: string;
  /** The directory of per-file inputs, passed as `--add-dir`. */
  readonly inputsDir: string;
  readonly firstMessage: string;
  readonly tiers?: TierTable;
}

/**
 * The launch spec of a reviewer run. The runtime turns it into the arguments of 0040 section 10.1: stream-json,
 * manual permission mode with every request denied by the app, `--setting-sources user`, `--strict-mcp-config`
 * with the app server, `--tools`, `--allowedTools` and the inputs directory. The settings file the session
 * service writes per launch carries the deny rules.
 */
export function reviewerLaunchSpec(request: ReviewRunRequest, context: ReviewerLaunchContext): AgentLaunchSpec {
  const tier = (context.tiers ?? DEFAULT_TIERS)[request.tier];
  return {
    sessionId: request.sessionId,
    folderId: request.folderId ?? 'review',
    title: `Review of ${request.agent} (${request.changesetId})`,
    cwd: context.cwd,
    model: tier.model,
    effort: request.effort,
    permissionMode: 'default',
    maxBudgetUsd: request.reservationUsd,
    maxTurnsPerMessage: request.maxTurns,
    connectors: false,
    tools: [...REVIEWER_BUILTIN_TOOLS],
    denyRules: [...REVIEWER_DENY_RULES],
    addDirs: [context.inputsDir],
    firstMessage: context.firstMessage,
    allowedTools: [REPORT_REVIEW_TOOL],
    toolSet: 'reviewer',
    autoDeny: true,
  };
}
