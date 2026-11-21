import type { AgentNodeView } from '../../../core/agents/view';
import { api } from '../../api';
import { Chip } from '../../ui/Chip';
import { Icon } from '../../ui/Icon';
import { IconButton } from '../../ui/IconButton';
import { ACTION_ICONS, STATUS_ICONS, STATUS_TONES, SURFACE_ICONS, type StatusKind } from '../../ui/icons';
import { setAgentsView } from './agentsStore';
import { elapsedSeconds, formatDuration, outcomeText, rowDetail } from './format';

const STATE_STATUS: Record<AgentNodeView['state'], StatusKind> = { running: 'busy', waiting: 'waiting', done: 'done', failed: 'failed' };
const SLOT = 16;
const GAP = 6;

/** One agent row under a session leaf: agent icon, label, status chip, last tool or unusual outcome, elapsed time. */
export function AgentRowView({ agent, level, now, selected }: { agent: AgentNodeView; level: number; now: number; selected: boolean }) {
  const ended = agent.state === 'done' || agent.state === 'failed';
  const detail = rowDetail(agent);
  const tooltip = ended ? outcomeText(agent) : (detail || agent.state);
  const status = STATE_STATUS[agent.state];
  const select = (): void => {
    const next = selected ? undefined : { sessionId: agent.sessionId, agentKey: agent.agentKey };
    setAgentsView({ selected: next });
    void api().invoke('agents_hold', { sessionId: agent.sessionId, agentKey: agent.agentKey, held: next !== undefined });
  };
  return (
    <div
      className="agent-row"
      role="treeitem"
      aria-selected={selected}
      data-testid="agent-row"
      data-state={agent.state}
      data-agent={agent.agentKey}
      data-selected={selected}
      style={{ paddingLeft: 4 + (level + 1) * 14 + SLOT + GAP }}
      title={`${agent.label} - ${tooltip}`}
      onClick={select}
    >
      <Icon icon={SURFACE_ICONS.agent.icon} size="sm" className="agent-icon" />
      <span className="agent-label">{agent.label}</span>
      <Chip className="agent-status" tone={STATUS_TONES[status]} icon={STATUS_ICONS[status].icon} spin={status === 'busy'} label={agent.state} data-testid="agent-mark" />
      {agent.origin === 'app-started' ? (
        <span className="agent-origin" title="started by the app">
          app
        </span>
      ) : null}
      {detail ? <span className="agent-detail">{detail}</span> : null}
      <span className="agent-elapsed">{formatDuration(elapsedSeconds(agent, now))}</span>
      {agent.state === 'failed' ? (
        <IconButton
          className="agent-dismiss"
          variant="danger-quiet"
          size="sm"
          icon={ACTION_ICONS.close.icon}
          label={`Dismiss ${agent.label}`}
          onClick={(event) => {
            event.stopPropagation();
            void api().invoke('agents_dismiss', { sessionId: agent.sessionId, agentKey: agent.agentKey });
          }}
        />
      ) : null}
    </div>
  );
}
