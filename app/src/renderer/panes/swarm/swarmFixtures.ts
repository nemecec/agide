import { swarmDefinitionSchema } from '../../../core/swarm/definition';
import type { AgentRunState, SwarmAgentStatus, SwarmStatus } from '../../../core/swarm/types';

/** Builders of swarm views for the tests of the swarm UI. */
export const agentStatus = (name: string, state: AgentRunState = 'running', extra: Partial<SwarmAgentStatus> = {}): SwarmAgentStatus => ({
  name,
  position: 0,
  role: 'worker',
  stage: 0,
  state,
  tier: 'mid',
  model: 'sonnet',
  effort: 'medium',
  permissionMode: 'auto',
  workspace: 'worktree',
  turns: 2,
  spend: { reportedUsd: 0.4, estimatedUsd: 0, reservedUsd: 0.6, priced: true },
  openApprovals: [],
  queuedAt: '2026-11-21T08:00:00.000Z',
  ...extra,
});

export const swarmStatus = (id: string, agents: readonly SwarmAgentStatus[], extra: Partial<SwarmStatus> = {}): SwarmStatus => ({
  id,
  folderId: `folder-${id}`,
  goal: 'Add input validation to the signup form',
  depth: 0,
  state: 'running',
  definition: swarmDefinitionSchema.parse({ version: 1, goal: 'Add input validation to the signup form', budget: { usdTotal: 3 }, agents: agents.map((agent) => ({ name: agent.name, prompt: 'work', workspace: 'scratch' })) }),
  budget: { usdTotal: 3, reviewUsd: 0, reportedUsd: 1.2, estimatedUsd: 0.3, reservedUsd: 0.5, remainingUsd: 1, wallClockMs: 5 * 60_000, wallClockLimitMs: 60 * 60_000 },
  agents: agents.map((agent, position) => ({ ...agent, position, sessionId: agent.sessionId ?? `session-${agent.name}` })),
  warnings: [],
  createdAt: '2026-11-21T08:00:00.000Z',
  ...extra,
});

/** The answers `useSwarms` reads: the list, one status per swarm and the tree for the folder parents. */
export const swarmAnswers = (swarms: readonly SwarmStatus[], parentId: string | null = 'project') => ({
  swarm_list: { swarms: swarms.map((swarm) => ({ id: swarm.id, folderId: swarm.folderId, goal: swarm.goal, state: swarm.state, counts: {}, createdAt: swarm.createdAt })) },
  swarm_status: (input: unknown) => swarms.find((swarm) => swarm.id === (input as { swarmId: string }).swarmId),
  ui_list_tree: { nodes: swarms.map((swarm) => ({ id: swarm.folderId, kind: 'folder', parentId, title: swarm.goal, order: 0 })) },
});
