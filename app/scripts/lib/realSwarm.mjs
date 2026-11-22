// Shared parts of the real-Claude swarm scripts: the definition shape, a layout with the tree and the inbox, waiting
// for a swarm to end, and the report of its agents, results, inbox items and app-started agent nodes.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { waitFor } from './realClaude.mjs';

/** Two Haiku agents in scratch directories: maxTier small selects haiku, each agent may spend 0.25 USD. */
export function haikuSwarm(goal, agents) {
  return {
    version: 1,
    goal,
    maxTier: 'small',
    budget: { usdTotal: 0.5, usdPerAgent: 0.25, maxTurnsPerMessage: 4, wallClockMinutes: 5 },
    agents: agents.map((agent) => ({ role: 'mechanical', workspace: 'scratch', ...agent })),
  };
}

/** A layout with the tree beside the surface host and the inbox, written into the data directory and switched to. */
export async function useTreeAndInboxLayout(run, dataDir = run.userData) {
  const pane = (type, config = {}) => ({ type, version: '^1', configVersion: 1, config });
  const document = {
    schemaVersion: 1,
    revision: 1,
    id: 'real-swarm',
    title: 'real-swarm',
    instances: { tree: pane('agide/tree'), main: { ...pane('agide/surface-host', { emptyText: 'Open a session' }), bindings: { node: { context: 'node.current' } } }, inbox: pane('agide/inbox') },
    arrangement: { split: 'row', children: [{ size: 1, tabs: { panes: ['tree'], active: 'tree' } }, { size: 3, tabs: { panes: ['main', 'inbox'], active: 'main' } }] },
  };
  mkdirSync(join(dataDir, 'layouts'), { recursive: true });
  writeFileSync(join(dataDir, 'layouts', 'real-swarm.json'), JSON.stringify(document));
  await new Promise((resolve) => setTimeout(resolve, 500));
  const switched = await run.invoke('layout_switch', { layoutId: 'real-swarm' });
  if (!switched.ok) throw new Error(`layout: ${JSON.stringify(switched)}`);
}

const ENDED = new Set(['done', 'failed', 'stopped']);

/** Polls swarm_status until the swarm ends; `onTick` runs on every poll, for example to answer approvals. */
export async function waitForSwarmEnd(run, log, swarmId, onTick = async () => undefined) {
  let last = '';
  return waitFor(log, `swarm ${swarmId} to end`, async () => {
    await onTick();
    const status = (await run.invoke('swarm_status', { swarmId })).value;
    const states = status?.agents.map((agent) => `${agent.name}:${agent.state}${agent.queuedFor ? `(${agent.queuedFor})` : ''}`).join(' ') ?? '';
    if (states !== last) {
      last = states;
      log.mark(`swarm ${status?.state}: ${states}`);
    }
    return status !== undefined && ENDED.has(status.state) ? status : undefined;
  });
}

/** What the report keeps of a swarm: agent states, models, spend, results, inbox items and the agents module's nodes. */
export async function swarmReport(run, swarmId) {
  const status = (await run.invoke('swarm_status', { swarmId })).value;
  const results = (await run.invoke('swarm_results', { swarmId })).value;
  const inbox = ((await run.invoke('inbox_list', { states: ['new', 'seen', 'snoozed', 'done'] })).value?.items ?? []).map((item) => ({
    kind: item.kind,
    origin: item.origin,
    message: item.message,
    state: item.state,
    resolution: item.resolution,
  }));
  const sessionIds = status.agents.map((agent) => agent.sessionId).filter(Boolean);
  const nodes = ((await run.invoke('agents_list', {})).value?.agents ?? []).filter((node) => sessionIds.includes(node.sessionId));
  const usage = (await run.invoke('usage_state', {})).value;
  return {
    state: status.state,
    budget: status.budget,
    warnings: status.warnings,
    agents: status.agents.map((agent) => ({
      name: agent.name,
      state: agent.state,
      reason: agent.reason,
      model: agent.model,
      effort: agent.effort,
      permissionMode: agent.permissionMode,
      turns: agent.turns,
      spend: agent.spend,
      queuedAt: agent.queuedAt,
      startedAt: agent.startedAt,
      endedAt: agent.endedAt,
      text: results.agents.find((result) => result.name === agent.name)?.text,
    })),
    agentNodes: nodes.map((node) => ({ origin: node.origin, state: node.state, label: node.label, costUsd: node.costUsd })),
    usageRanking: usage.ranking.filter((entry) => entry.subject.kind === 'session' && sessionIds.includes(entry.subject.sessionId)).map((entry) => ({ label: entry.label, share: entry.share })),
    inbox,
  };
}
