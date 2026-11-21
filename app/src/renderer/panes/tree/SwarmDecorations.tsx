import { useAgents } from '../agents/useAgents';
import { BudgetMeter } from '../swarm/BudgetMeter';
import { RUN_STATUS, RUN_WORDS, SWARM_STATUS, SWARM_WORDS, agentDetail, capLabel, tally, tallyText } from '../swarm/swarmModel';
import { useSwarms } from '../swarm/useSwarms';
import { Chip, StatusChip } from '../../ui/Chip';
import { STATUS_ICONS, STATUS_TONES } from '../../ui/icons';
import '../swarm/swarm.css';

/**
 * Tree hook points of the swarm UI (0037 section 10).
 * `SwarmFolderDecorations` follows every folder's title: a swarm folder shows the swarm chip, the budget meter and
 * the waiting marker; a folder that holds swarms shows how many app-started agents run against the cap.
 * `SwarmAgentDecorations` follows every Claude session leaf: the run-state chip of a swarm agent.
 * Both render nothing for nodes that belong to no swarm.
 */
export function SwarmFolderDecorations({ folderId }: { readonly folderId: string }) {
  const { swarms, parents } = useSwarms();
  const { settings } = useAgents();
  const swarm = swarms.find((candidate) => candidate.folderId === folderId);
  if (swarm !== undefined) {
    const counts = tally(swarm.agents);
    return (
      <span className="swarm-decorations" data-testid="swarm-folder-decorations" data-swarm={swarm.id} title={tallyText(counts)}>
        <StatusChip status={SWARM_STATUS[swarm.state]} label={SWARM_WORDS[swarm.state]} data-testid="swarm-chip" />
        <BudgetMeter budget={swarm.budget} compact data-testid="swarm-row-meter" />
        {counts.waiting > 0 ? (
          <Chip
            tone={STATUS_TONES.waiting}
            icon={STATUS_ICONS.waiting.icon}
            label={String(counts.waiting)}
            aria-label={`${counts.waiting} waiting for an answer`}
            title={`${counts.waiting} waiting for an answer`}
            data-testid="swarm-waiting"
          />
        ) : null}
      </span>
    );
  }
  const holdsSwarms = Object.values(parents).includes(folderId);
  if (!holdsSwarms) return null;
  const running = swarms.reduce((sum, candidate) => sum + tally(candidate.agents).running, 0);
  return (
    <span className="swarm-decorations" data-testid="swarm-cap-decorations">
      <span className="swarm-cap" data-testid="swarm-cap" title="Agents started by Agide that run now, against the cap">
        {capLabel(running, settings.maxConcurrentAppStarted)}
      </span>
    </span>
  );
}

export function SwarmAgentDecorations({ sessionId }: { readonly sessionId: string }) {
  const { swarms } = useSwarms();
  const agent = swarms.flatMap((swarm) => swarm.agents).find((candidate) => candidate.sessionId === sessionId);
  if (agent === undefined) return null;
  const detail = agentDetail(agent);
  return (
    <span className="swarm-decorations" data-testid="swarm-agent-decorations">
      <StatusChip
        status={RUN_STATUS[agent.state]}
        label={RUN_WORDS[agent.state]}
        title={detail === '' ? RUN_WORDS[agent.state] : `${RUN_WORDS[agent.state]}: ${detail}`}
        data-testid="swarm-agent-chip"
        data-agent-state={agent.state}
      />
      <span className="swarm-origin" title="started by the app">
        app
      </span>
    </span>
  );
}
