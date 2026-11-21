import { useState } from 'react';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { TextArea } from '../../ui/Field';
import { Notice } from '../../ui/Notice';
import { Switch } from '../../ui/Switch';
import { sendToAgent, stopAgent, stopSwarm } from './swarmActions';
import { closeSwarmDialog, useSwarmDialog, type SwarmDialogRequest } from './swarmDialogStore';
import { useSwarmById } from './useSwarms';
import './swarm.css';

/** Renders the open swarm dialog above the layout; mounted once by the app. */
export function SwarmActionDialogs() {
  const request = useSwarmDialog();
  if (request === null) return null;
  return <Body key={`${request.kind}:${request.swarmId}:${'agent' in request ? request.agent : ''}`} request={request} />;
}

function Body({ request }: { readonly request: SwarmDialogRequest }) {
  switch (request.kind) {
    case 'stop-swarm':
      return <StopDialog swarmId={request.swarmId} />;
    case 'stop-agent':
      return <StopDialog swarmId={request.swarmId} agent={request.agent} />;
    case 'send':
      return <SendDialog swarmId={request.swarmId} agent={request.agent} />;
    case 'definition':
      return <DefinitionDialog swarmId={request.swarmId} />;
  }
}

function StopDialog({ swarmId, agent }: { readonly swarmId: string; readonly agent?: string }) {
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const confirm = async (): Promise<void> => {
    setBusy(true);
    const failure = await (agent === undefined ? stopSwarm(swarmId) : stopAgent(swarmId, agent));
    setBusy(false);
    if (failure === undefined) closeSwarmDialog();
    else setError(failure);
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && closeSwarmDialog()}
      title={agent === undefined ? 'Stop the swarm?' : `Stop ${agent}?`}
      size={400}
      data-testid="swarm-stop-dialog"
      footer={
        <>
          <Button data-dialog-cancel onClick={closeSwarmDialog}>
            Cancel
          </Button>
          <Button variant="danger" data-autofocus data-testid="swarm-stop-confirm" loading={busy} onClick={() => void confirm()}>
            {agent === undefined ? 'Stop swarm' : 'Stop agent'}
          </Button>
        </>
      }
    >
      <p>{agent === undefined ? 'Every running agent is stopped and the queued agents are dropped. Worktrees stay.' : 'The agent is stopped. Agents that depend on it follow the failure policy.'}</p>
      {error !== undefined && (
        <Notice tone="danger" data-testid="swarm-dialog-error">
          {error}
        </Notice>
      )}
    </Dialog>
  );
}

function SendDialog({ swarmId, agent }: { readonly swarmId: string; readonly agent: string }) {
  const [message, setMessage] = useState('');
  const [now, setNow] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const send = async (): Promise<void> => {
    setBusy(true);
    const failure = await sendToAgent(swarmId, agent, message.trim(), now);
    setBusy(false);
    if (failure === undefined) closeSwarmDialog();
    else setError(failure);
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && closeSwarmDialog()}
      title={`Message to ${agent}`}
      size={480}
      data-testid="swarm-send-dialog"
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy && message.trim() !== '') void send();
      }}
      footer={
        <>
          <Button data-dialog-cancel onClick={closeSwarmDialog}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" data-testid="swarm-send-confirm" disabled={message.trim() === ''} loading={busy}>
            Send
          </Button>
        </>
      }
    >
      <div className="swarm-dialog">
        <TextArea label="Message" data-autofocus data-testid="swarm-send-text" rows={4} value={message} maxLength={8000} onChange={(event) => setMessage(event.target.value)} />
        <Switch checked={now} onCheckedChange={setNow} label="Interrupt the running turn first" data-testid="swarm-send-now" />
        {error !== undefined && (
          <Notice tone="danger" data-testid="swarm-dialog-error">
            {error}
          </Notice>
        )}
      </div>
    </Dialog>
  );
}

function DefinitionDialog({ swarmId }: { readonly swarmId: string }) {
  const { swarm } = useSwarmById(swarmId);
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && closeSwarmDialog()}
      title="Swarm definition"
      size={640}
      data-testid="swarm-definition-dialog"
      footer={
        <Button variant="primary" data-dialog-cancel onClick={closeSwarmDialog}>
          Close
        </Button>
      }
    >
      <div className="swarm-dialog">
        {swarm === undefined ? <Notice tone="warning">The swarm is no longer listed.</Notice> : <pre data-testid="swarm-definition-text">{JSON.stringify(swarm.definition, null, 2)}</pre>}
      </div>
    </Dialog>
  );
}
