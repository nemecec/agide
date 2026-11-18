import { AgentRowView } from '../agents/AgentRowView';
import { HeatMarker } from '../agents/HeatMarker';
import { useAgentsView } from '../agents/agentsStore';
import { useAgents, useUsageState } from '../agents/useAgents';

/**
 * Agent nodes under a session leaf (0027 section 3), drawn from the `agents` data source, not stored as tree
 * rows. `level` is the session leaf's depth, so rows indent one step further. A finished node is hidden once its
 * removal delay passed, unless "Show finished agents" is on or the node is selected.
 */
export function AgentRows({ sessionId, level }: { readonly sessionId: string; readonly level: number }) {
  const { agents, now } = useAgents();
  const usage = useUsageState();
  const { showFinished, selected } = useAgentsView();
  const rows = agents.filter((agent) => agent.sessionId === sessionId && agent.origin === 'session-started' && agent.agentKey !== 'main');
  const visible = rows.filter((agent) => showFinished || !agent.hidden || (selected?.sessionId === agent.sessionId && selected.agentKey === agent.agentKey));
  if (visible.length === 0) return null;
  return (
    <div className="agent-rows" role="group" aria-label="Agents">
      {visible.map((agent) => {
        const heat = usage?.heat[`agent:${agent.sessionId}:${agent.agentKey}`];
        return (
          <div key={agent.agentKey} className="agent-row-wrap" data-hidden={agent.hidden}>
            <AgentRowView agent={agent} level={level} now={now} selected={selected?.sessionId === agent.sessionId && selected.agentKey === agent.agentKey} />
            {heat && usage ? <HeatMarker level={heat.level} costUsdPerMinute={heat.costUsdPerMinute} share={heat.share} windowMinutes={usage.windowMinutes} testId="agent-heat" /> : null}
          </div>
        );
      })}
    </div>
  );
}
