import { useEffect, useState } from 'react';
import type { SwarmMergeResult } from '../../../core/review/types';
import { Button } from '../../ui/Button';
import { Checkbox } from '../../ui/Checkbox';
import { Dialog } from '../../ui/Dialog';
import { TextField } from '../../ui/Field';
import { Notice } from '../../ui/Notice';
import { plainText } from './plainText';
import { merge } from './reviewApi';

type Gate = { readonly status: 'checking' } | { readonly status: 'ready'; readonly result: SwarmMergeResult } | { readonly status: 'closed'; readonly refused: readonly { agent?: string; why: string }[]; readonly message: string } | { readonly status: 'failed'; readonly message: string };

interface Refusal {
  readonly agent?: string;
  readonly why: string;
}

const refusalsOf = (details: unknown): Refusal[] => {
  const list = typeof details === 'object' && details !== null ? (details as { refused?: unknown }).refused : undefined;
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry): Refusal[] => (typeof entry === 'object' && entry !== null && typeof (entry as { why?: unknown }).why === 'string' ? [{ ...(typeof (entry as { agent?: unknown }).agent === 'string' ? { agent: (entry as { agent: string }).agent } : {}), why: (entry as { why: string }).why }] : []));
};

export interface MergeDialogProps {
  readonly swarmId: string;
  /** The agents of the swarm, so a rejected one can be left out. */
  readonly agents: readonly string[];
  readonly onClose: () => void;
  readonly onMerged: () => void;
}

/**
 * The "Merge accepted work" dialog (0040 section 15.2). It asks for a dry run first and shows the gate per agent,
 * the conflicts and the commits that would be made; Confirm is the approval of the merge class and runs the real
 * merge. Nothing is pushed.
 */
export function MergeDialog({ swarmId, agents, onClose, onMerged }: MergeDialogProps) {
  const [target, setTarget] = useState('');
  const [exclude, setExclude] = useState<readonly string[]>([]);
  const [gate, setGate] = useState<Gate>({ status: 'checking' });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<SwarmMergeResult | undefined>();
  const [failure, setFailure] = useState<string | undefined>();

  useEffect(() => {
    let current = true;
    setGate({ status: 'checking' });
    const timer = setTimeout(() => {
      void merge(swarmId, { target, exclude, dryRun: true }).then((outcome) => {
        if (!current) return;
        if (outcome.ok) setGate({ status: 'ready', result: outcome.value });
        else if (outcome.failure.code === 'refused') setGate({ status: 'closed', refused: refusalsOf(outcome.failure.details), message: outcome.failure.message });
        else setGate({ status: 'failed', message: outcome.failure.message });
      });
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [swarmId, target, exclude]);

  const ready = gate.status === 'ready' && gate.result.merged.length > 0 && (gate.result.refused ?? []).length === 0 && (gate.result.conflicts ?? []).length === 0;
  const confirm = async (): Promise<void> => {
    setBusy(true);
    setFailure(undefined);
    const outcome = await merge(swarmId, { target, exclude, dryRun: false });
    setBusy(false);
    if (outcome.ok) {
      setDone(outcome.value);
      onMerged();
    } else setFailure(outcome.failure.message);
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title="Merge accepted work"
      size={640}
      data-testid="review-merge-dialog"
      footer={
        <>
          <Button data-dialog-cancel onClick={onClose}>
            {done === undefined ? 'Cancel' : 'Close'}
          </Button>
          {done === undefined && (
            <Button variant="primary" disabled={!ready} loading={busy} data-testid="review-merge-confirm" onClick={() => void confirm()}>
              Merge
            </Button>
          )}
        </>
      }
    >
      {done !== undefined ? (
        <Notice tone="success" data-testid="review-merge-done">
          Merged into {plainText(done.target)}: {done.merged.length === 1 ? '1 commit' : `${done.merged.length} commits`}, one per accepted changeset. Nothing was pushed.
        </Notice>
      ) : (
        <>
          <p>Each accepted changeset becomes one commit on a local branch. Nothing is pushed. You approve the merge by pressing Merge.</p>
          <TextField label="Target branch" value={target} placeholder="The swarm's base branch" mono data-testid="review-merge-target" onChange={(event) => setTarget(event.target.value)} />
          {agents.length > 0 && (
            <fieldset className="review-fieldset">
              <legend>Leave out a rejected agent</legend>
              {agents.map((agent) => (
                <Checkbox key={agent} checked={exclude.includes(agent)} onCheckedChange={(on) => setExclude(on ? [...exclude, agent] : exclude.filter((known) => known !== agent))} label={plainText(agent)} data-testid="review-merge-exclude" />
              ))}
            </fieldset>
          )}
          <GateView gate={gate} />
          {failure !== undefined && (
            <Notice tone="danger" data-testid="review-merge-error">
              {failure}
            </Notice>
          )}
        </>
      )}
    </Dialog>
  );
}

function GateView({ gate }: { readonly gate: Gate }) {
  if (gate.status === 'checking') return <p className="review-muted" data-testid="review-merge-checking">Checking what can be merged…</p>;
  if (gate.status === 'failed') return <Notice tone="danger" data-testid="review-merge-gate-error">{gate.message}</Notice>;
  if (gate.status === 'closed') {
    return (
      <div className="review-section" data-testid="review-merge-blocked">
        <Notice tone="warning">The merge is not open yet: {gate.message}</Notice>
        <ul className="review-list">
          {gate.refused.map((entry, index) => (
            <li key={`${entry.agent ?? 'swarm'}:${index}`} data-testid="review-merge-refusal">
              {entry.agent !== undefined && <strong>{plainText(entry.agent)}: </strong>}
              {plainText(entry.why)}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  const { result } = gate;
  return (
    <div className="review-section" data-testid="review-merge-preview">
      {(result.refused ?? []).map((entry, index) => (
        <Notice key={index} tone="warning" data-testid="review-merge-refusal">
          {entry.agent !== undefined ? `${plainText(entry.agent)}: ` : ''}
          {plainText(entry.why)}
        </Notice>
      ))}
      {(result.conflicts ?? []).map((conflict, index) => (
        <Notice key={index} tone="danger" data-testid="review-merge-conflict">
          Conflict between {conflict.agents.map((agent) => plainText(agent)).join(' and ')} in {conflict.files.map((file) => plainText(file)).join(', ')}.
        </Notice>
      ))}
      {result.merged.length > 0 ? (
        <>
          <p className="review-dialog-heading">Commits that would be made on {plainText(result.target)}</p>
          <ul className="review-list">
            {result.merged.map((entry) => (
              <li key={entry.changesetId} data-testid="review-merge-step">
                {plainText(entry.agent)}
              </li>
            ))}
          </ul>
        </>
      ) : (
        (result.refused ?? []).length === 0 && <p className="review-muted">Nothing accepted is waiting to be merged.</p>
      )}
    </div>
  );
}
