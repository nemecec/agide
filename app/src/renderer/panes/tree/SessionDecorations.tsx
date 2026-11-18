import { summarise } from '../../../core/agents/view';
import { HeatMarker } from '../agents/HeatMarker';
import { useAgents, useUsageState } from '../agents/useAgents';

/** Running count, waiting marker, finished tally and heat marker on a session leaf (0027 sections 3 and 9). */
export function SessionDecorations({ sessionId }: { readonly sessionId: string }) {
  const { agents, waitingSessions, now } = useAgents();
  const usage = useUsageState();
  const mine = agents.filter((agent) => agent.sessionId === sessionId && agent.agentKey !== 'main');
  const summary = summarise(mine, now);
  const heat = usage?.heat[`session:${sessionId}`];
  const sessionWaits = waitingSessions.includes(sessionId);
  if (mine.length === 0 && !sessionWaits && !heat) return null;
  return (
    <span className="session-decorations" data-testid="session-decorations">
      {summary.running > 0 ? (
        <span className="agent-count" data-testid="agent-count" title={`${summary.running} agents running or waiting`}>
          {summary.running} running
        </span>
      ) : null}
      {summary.waiting > 0 || sessionWaits ? (
        <span className="agent-waiting" data-testid="agent-waiting" title="waiting for an approval">
          waiting
        </span>
      ) : null}
      {summary.finishedRecently > 0 ? (
        <span className="agent-finished" data-testid="agent-finished" title="agents that ended in the last minute">
          {summary.finishedRecently} finished
        </span>
      ) : null}
      {heat && usage ? <HeatMarker level={heat.level} costUsdPerMinute={heat.costUsdPerMinute} share={heat.share} windowMinutes={usage.windowMinutes} testId="session-heat" /> : null}
    </span>
  );
}
