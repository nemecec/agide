import type { AgentNodeView } from '../../../core/agents/view';
import { api } from '../../api';
import { setAgentsView } from './agentsStore';
import { elapsedSeconds, formatDuration, outcomeText } from './format';

const STATE_MARK: Record<AgentNodeView['state'], string> = { running: '●', waiting: '◐', done: '✓', failed: '✗' };

/** One agent row under a session leaf: state mark, label, last tool or outcome, elapsed time. Plain text only. */
export function AgentRowView({ agent, level, now, selected }: { agent: AgentNodeView; level: number; now: number; selected: boolean }) {
  const ended = agent.state === 'done' || agent.state === 'failed';
  const detail = ended ? outcomeText(agent) : agent.queued === true ? 'queued' : (agent.lastTool ?? agent.state);
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
      style={{ paddingLeft: 8 + (level + 1) * 16 + 12 }}
      title={`${agent.label} - ${detail}`}
      onClick={select}
    >
      <span className="agent-mark" aria-hidden="true">
        {STATE_MARK[agent.state]}
      </span>
      <span className="agent-label">{agent.label}</span>
      {agent.origin === 'app-started' ? (
        <span className="agent-origin" title="started by the app">
          app
        </span>
      ) : null}
      <span className="agent-detail">{detail}</span>
      <span className="agent-elapsed">{formatDuration(elapsedSeconds(agent, now))}</span>
      {agent.state === 'failed' ? (
        <button
          type="button"
          className="agent-dismiss"
          aria-label={`Dismiss ${agent.label}`}
          onClick={(event) => {
            event.stopPropagation();
            void api().invoke('agents_dismiss', { sessionId: agent.sessionId, agentKey: agent.agentKey });
          }}
        >
          dismiss
        </button>
      ) : null}
    </div>
  );
}
