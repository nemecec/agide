import type { PermissionMode } from '../../session/types';
import { defaultAgentBudget } from '../budget';
import { defaultReviewShare, swarmDefinitionSchema, type AgentSpec, type SwarmDefinition } from '../definition';
import { resolveTier, type TierTable } from '../tiers';
import type { AgentRunState, EndReason, InterruptedBy, SwarmState } from '../types';
import { BudgetLedger } from './BudgetLedger';
import { emptyMeta, type AgentEntry, type ResultMeta, type SwarmEntry } from './entries';
import type { AgentRow, SwarmRow } from './SwarmStore';

export const RESULT_TEXT_MAX = 8_000;

/** The ledger of a swarm: one account per agent with the budget the definition gives it. */
export function ledgerFor(definition: SwarmDefinition): BudgetLedger {
  return new BudgetLedger({
    usdTotal: definition.budget.usdTotal,
    reviewShare: definition.budget.reviewShare ?? defaultReviewShare(definition),
    agents: definition.agents.map((agent) => ({
      name: agent.name,
      budgetUsd: agent.budget.usd ?? defaultAgentBudget(definition.budget.usdTotal, definition.budget.usdPerAgent),
      reviewer: agent.role === 'reviewer',
    })),
  });
}

export function swarmRow(swarm: SwarmEntry): SwarmRow {
  return {
    id: swarm.id,
    folder_id: swarm.folderId,
    caller_session_id: swarm.callerSessionId ?? null,
    depth: swarm.depth,
    definition: JSON.stringify(swarm.definition),
    repo_path: swarm.repoRoot ?? null,
    base_commit: swarm.baseCommit ?? null,
    state: swarm.state,
    stop_reason: swarm.stopReason ?? null,
    usd_total: swarm.definition.budget.usdTotal,
    wall_clock_ms: Math.round(swarm.wallClockMs),
    created_at: swarm.createdAt,
    updated_at: swarm.updatedAt,
    ended_at: swarm.endedAt ?? null,
    warnings: JSON.stringify(swarm.warnings),
  };
}

export function agentRow(swarm: SwarmEntry, agent: AgentEntry): AgentRow {
  const spend = swarm.ledger.spendOf(agent.spec.name);
  return {
    swarm_id: swarm.id,
    name: agent.spec.name,
    position: agent.position,
    session_id: agent.sessionId ?? null,
    state: agent.state,
    reason: agent.reason ?? null,
    interrupted_by: agent.interruptedBy ?? null,
    model: agent.tier.model,
    effort: agent.tier.effort,
    permission_mode: agent.permissionMode,
    workspace: agent.spec.workspace,
    cwd: agent.cwd ?? null,
    branch: agent.branch ?? null,
    pid: agent.pid ?? null,
    reserved_usd: spend.reservedUsd,
    reported_usd: spend.reportedUsd,
    estimated_usd: spend.estimatedUsd,
    turns: agent.turns,
    retries: agent.retries,
    result_text: agent.text === undefined ? null : agent.text.slice(0, RESULT_TEXT_MAX),
    result_meta: JSON.stringify(agent.meta),
    patch_path: agent.meta.patchStored === true ? `swarms/${swarm.id}/${agent.spec.name}.patch` : null,
    queued_at: agent.queuedAt,
    started_at: agent.startedAt ?? null,
    ended_at: agent.endedAt ?? null,
    resume_message: agent.resumeWith ?? null,
  };
}

function parseMeta(text: string | null): ResultMeta {
  if (text === null) return emptyMeta();
  try {
    return { ...emptyMeta(), ...(JSON.parse(text) as Partial<ResultMeta>) };
  } catch {
    return emptyMeta();
  }
}

/** A swarm and its agents from the rows; the tier is resolved again from the definition and the current table. */
export function entryFromRows(row: SwarmRow, agentRows: readonly AgentRow[], tiers: TierTable, seq: number): SwarmEntry | undefined {
  const parsed = swarmDefinitionSchema.safeParse(JSON.parse(row.definition));
  if (!parsed.success) return undefined;
  const definition = parsed.data;
  const ledger = ledgerFor(definition);
  const agents = agentRows.flatMap((agentRow): AgentEntry[] => {
    const spec: AgentSpec | undefined = definition.agents[agentRow.position];
    if (spec === undefined || spec.name !== agentRow.name) return [];
    ledger.restore(spec.name, agentRow.reported_usd + agentRow.estimated_usd);
    return [
      {
        spec,
        position: agentRow.position,
        tier: { ...resolveTier(tiers, definition.maxTier, spec), model: agentRow.model, effort: agentRow.effort as AgentEntry['tier']['effort'] },
        permissionMode: agentRow.permission_mode as PermissionMode,
        state: agentRow.state as AgentRunState,
        reason: (agentRow.reason ?? undefined) as EndReason | undefined,
        interruptedBy: (agentRow.interrupted_by ?? undefined) as InterruptedBy | undefined,
        sessionId: agentRow.session_id ?? undefined,
        resumeWith: agentRow.resume_message ?? undefined,
        started: agentRow.session_id !== null,
        retries: agentRow.retries,
        pid: agentRow.pid ?? undefined,
        turns: agentRow.turns,
        text: agentRow.result_text ?? undefined,
        errors: [],
        denials: 0,
        deniedTools: [],
        cwd: agentRow.cwd ?? undefined,
        branch: agentRow.branch ?? undefined,
        meta: parseMeta(agentRow.result_meta),
        approvals: new Map(),
        queuedAt: agentRow.queued_at,
        startedAt: agentRow.started_at ?? undefined,
        endedAt: agentRow.ended_at ?? undefined,
      },
    ];
  });
  return {
    id: row.id,
    seq,
    folderId: row.folder_id,
    callerSessionId: row.caller_session_id ?? undefined,
    depth: row.depth,
    definition,
    repoRoot: row.repo_path ?? undefined,
    baseCommit: row.base_commit ?? undefined,
    agents,
    warnings: JSON.parse(row.warnings) as string[],
    createdAt: row.created_at,
    ledger,
    state: row.state as SwarmState,
    stopReason: (row.stop_reason ?? undefined) as EndReason | undefined,
    endedAt: row.ended_at ?? undefined,
    updatedAt: row.updated_at,
    wallClockMs: row.wall_clock_ms,
    lastTickMs: 0,
    alertedShare: false,
    finalized: ['done', 'failed', 'stopped'].includes(row.state),
  };
}
