import { useEffect, useState } from 'react';
import type { ItemRow } from '../../../core/inbox/viewTypes';
import { SWARM_APPROVAL_ORIGIN, type SwarmApprovalPayload } from '../../../core/swarm/types';
import { Button } from '../../ui/Button';
import { Disclosure } from '../../ui/Disclosure';
import { Notice } from '../../ui/Notice';
import { answerApproval } from '../swarm/swarmActions';
import { approvalButtons, expiryText, readApprovalPayload } from '../swarm/swarmModel';
import { useSwarmById } from '../swarm/useSwarms';
import '../swarm/swarm.css';

/**
 * The manager answers "Always" only when the answer command takes it; until then the button stays hidden
 * (0037 section 7.2: it waits for the real-Claude check of `updatedPermissions`).
 */
export const ALWAYS_ANSWER_SUPPORTED = false;

const CLOCK_MS = 30_000;

/**
 * The answer buttons of a `swarm:can_use_tool` approval card (0037 section 7.2): Deny and Allow through
 * `swarm_approval_answer`, Always when the manager supports it, the swarm, agent and mode, and the time of the
 * automatic denial. The tool input shows in full above the buttons (the card's own Details read the tool input of
 * hook items); the whole request is in a disclosure. Renders nothing for other items.
 */
export function SwarmApprovalActions({ item, alwaysSupported = ALWAYS_ANSWER_SUPPORTED }: { readonly item: ItemRow; readonly alwaysSupported?: boolean }) {
  if (item.origin !== SWARM_APPROVAL_ORIGIN) return null;
  const payload = readApprovalPayload(item.payload);
  if (payload === undefined) {
    return (
      <Notice tone="warning" data-testid="swarm-approval-unreadable">
        This request cannot be answered here: its record is incomplete.
      </Notice>
    );
  }
  return <ApprovalBody payload={payload} alwaysSupported={alwaysSupported} />;
}

function ApprovalBody({ payload, alwaysSupported }: { readonly payload: SwarmApprovalPayload; readonly alwaysSupported: boolean }) {
  const { swarm } = useSwarmById(payload.swarmId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => clearInterval(timer);
  }, []);
  const buttons = approvalButtons(payload, alwaysSupported);
  const answer = async (decision: 'allow' | 'deny' | 'always'): Promise<void> => {
    setBusy(true);
    setError(undefined);
    const failure = await answerApproval(payload.swarmId, payload.agent, payload.requestId, decision);
    setBusy(false);
    if (failure !== undefined) setError(failure);
  };
  const expiry = expiryText(payload.expiresAt, now);
  return (
    <div className="swarm-approval" data-testid="swarm-approval">
      <p className="swarm-approval-meta" data-testid="swarm-approval-meta">
        {swarm === undefined ? '' : `Swarm ${swarm.goal}, `}Agent {payload.agent}, mode {payload.permissionMode}
        {expiry === '' ? '' : `, ${expiry}`}
      </p>
      <p className="swarm-approval-tool">
        Tool call <code>{payload.request.tool_name}</code>
      </p>
      <pre className="inbox-raw" data-testid="swarm-approval-input">
        {JSON.stringify(payload.request.input, null, 2)}
      </pre>
      <Disclosure label="Raw request" data-testid="swarm-approval-raw">
        <pre className="inbox-raw" data-testid="swarm-approval-raw-text">
          {JSON.stringify(payload.request, null, 2)}
        </pre>
      </Disclosure>
      {error !== undefined && (
        <Notice tone="danger" data-testid="swarm-approval-error">
          {error}
        </Notice>
      )}
      <div className="swarm-approval-buttons">
        <Button disabled={busy} onClick={() => void answer('deny')} data-testid="swarm-approval-deny">
          Deny
        </Button>
        {buttons.always && (
          <Button disabled={busy} onClick={() => void answer('always')} data-testid="swarm-approval-always" title="Allow this call and the same calls for the rest of the session">
            Always
          </Button>
        )}
        <Button variant="primary" disabled={busy} onClick={() => void answer('allow')} data-testid="swarm-approval-allow">
          Allow
        </Button>
      </div>
    </div>
  );
}
