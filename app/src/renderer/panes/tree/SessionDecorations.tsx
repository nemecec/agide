import { summarise } from '../../../core/agents/view';
import { HeatMarker } from '../agents/HeatMarker';
import { useAgents, useUsageState } from '../agents/useAgents';
import { useSwarmAgent } from '../swarm/useSwarms';
import { Chip } from '../../ui/Chip';
import { STATUS_ICONS, STATUS_TONES, type StatusKind } from '../../ui/icons';

/** An icon and a count; the words are the accessible name and the tooltip, so the chip stays short in a narrow tree. */
function Tally({ status, count, label, testId }: { readonly status: StatusKind; readonly count: number; readonly label: string; readonly testId: string }) {
  return <Chip className="tree-tally" tone={STATUS_TONES[status]} icon={STATUS_ICONS[status].icon} spin={status === 'busy'} label={count > 0 ? String(count) : ''} aria-label={label} title={label} data-testid={testId} data-status={status} />;
}

/** Running, waiting, failed and finished tallies and the usage meter on a session leaf (0027 sections 3 and 9). */
export function SessionDecorations({ sessionId }: { readonly sessionId: string }) {
  const { agents, waitingSessions, now } = useAgents();
  const usage = useUsageState();
  const isSwarmAgent = useSwarmAgent(sessionId) !== undefined;
  // The swarm chip next to the session tells the state of a swarm agent; its own tally would repeat and can disagree.
  const mine = agents.filter((agent) => agent.sessionId === sessionId && agent.agentKey !== 'main' && !(isSwarmAgent && agent.origin === 'app-started'));
  const summary = summarise(mine, now);
  const heat = usage?.heat[`session:${sessionId}`];
  const sessionWaits = waitingSessions.includes(sessionId);
  if (mine.length === 0 && !sessionWaits && !heat) return null;
  return (
    <span className="session-decorations" data-testid="session-decorations">
      {summary.waiting > 0 || sessionWaits ? <Tally status="waiting" count={summary.waiting} label={summary.waiting > 0 ? `${summary.waiting} waiting for an approval` : 'Waiting for an approval'} testId="agent-waiting" /> : null}
      {summary.failed > 0 ? <Tally status="failed" count={summary.failed} label={`${summary.failed} failed`} testId="agent-failed" /> : null}
      {summary.running > 0 ? <Tally status="busy" count={summary.running} label={`${summary.running} running`} testId="agent-count" /> : null}
      {summary.finishedRecently > 0 ? <Tally status="done" count={summary.finishedRecently} label={`${summary.finishedRecently} finished in the last minute`} testId="agent-finished" /> : null}
      {heat && usage ? <HeatMarker level={heat.level} costUsdPerMinute={heat.costUsdPerMinute} share={heat.share} windowMinutes={usage.windowMinutes} testId="session-heat" /> : null}
    </span>
  );
}
