import { useAgentsView } from './agents/agentsStore';
import { TranscriptView } from './agents/TranscriptView';
import type { PaneProps } from './paneTypes';
import './agents/agents.css';

/**
 * `agide/transcript-viewer` (0027 section 4): a read-only transcript as plain text. It shows the agent named in
 * its config (`sessionId` and `agentKey`) or else the agent selected in the tree or the history.
 */
export function TranscriptViewerPane({ instanceId, config }: PaneProps) {
  const { selected } = useAgentsView();
  const sessionId = typeof config['sessionId'] === 'string' ? config['sessionId'] : selected?.sessionId;
  const agentKey = typeof config['agentKey'] === 'string' ? config['agentKey'] : selected?.agentKey;
  return (
    <section className="agents-pane" data-testid="transcript-viewer-pane" data-instance={instanceId} aria-label="Transcript">
      {sessionId && agentKey ? <TranscriptView sessionId={sessionId} agentKey={agentKey} /> : <p className="transcript-status">Select an agent to read its transcript.</p>}
    </section>
  );
}
