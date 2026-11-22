import { useState, type ReactNode } from 'react';
import type { CommentRecord, Rung } from '../../../core/review/schemas';
import { RUNGS } from '../../../core/review/schemas';
import type { ChangesetDetail } from '../../../core/review/types';
import { Button } from '../../ui/Button';
import { Checkbox } from '../../ui/Checkbox';
import { Dialog } from '../../ui/Dialog';
import { TextArea } from '../../ui/Field';
import { Notice } from '../../ui/Notice';
import { Select } from '../../ui/Select';
import { plainText } from './plainText';
import { basisOf, demote, escalate, reject, sendBack, type Outcome } from './reviewApi';
import { RUNG_LABELS, findingId, rungIndex, sortReasons } from './reviewModel';

interface DialogShellProps {
  readonly title: string;
  readonly testId: string;
  readonly confirmLabel: string;
  readonly confirmVariant?: 'primary' | 'danger';
  readonly canConfirm: boolean;
  readonly busy: boolean;
  readonly error: string | undefined;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
  readonly children: ReactNode;
}

function Shell({ title, testId, confirmLabel, confirmVariant = 'primary', canConfirm, busy, error, onClose, onConfirm, children }: DialogShellProps) {
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={title}
      size={480}
      data-testid={testId}
      onSubmit={(event) => {
        event.preventDefault();
        if (canConfirm && !busy) onConfirm();
      }}
      footer={
        <>
          <Button data-dialog-cancel onClick={onClose}>
            Cancel
          </Button>
          <Button variant={confirmVariant} type="submit" disabled={!canConfirm} loading={busy} data-testid={`${testId}-confirm`}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
      {error !== undefined && (
        <Notice tone="danger" data-testid={`${testId}-error`}>
          {error}
        </Notice>
      )}
    </Dialog>
  );
}

/** Runs a command, closes on success and shows the failure otherwise. */
function useSubmit(onDone: () => void): { readonly busy: boolean; readonly error: string | undefined; readonly submit: <T>(call: () => Promise<Outcome<T>>) => Promise<Outcome<T>> } {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const submit = async <T,>(call: () => Promise<Outcome<T>>): Promise<Outcome<T>> => {
    setBusy(true);
    setError(undefined);
    const result = await call();
    setBusy(false);
    if (result.ok) onDone();
    else setError(result.failure.message);
    return result;
  };
  return { busy, error, submit };
}

export interface DialogProps {
  readonly detail: ChangesetDetail;
  readonly onClose: () => void;
  /** Called after the command succeeded, before the dialog closes. */
  readonly onDone: () => void;
}

export function RejectDialog({ detail, onClose, onDone }: DialogProps) {
  const [reason, setReason] = useState('');
  const { busy, error, submit } = useSubmit(() => {
    onDone();
    onClose();
  });
  return (
    <Shell
      title="Reject this changeset?"
      testId="review-reject-dialog"
      confirmLabel="Reject"
      confirmVariant="danger"
      canConfirm={reason.trim() !== ''}
      busy={busy}
      error={error}
      onClose={onClose}
      onConfirm={() => void submit(() => reject(basisOf(detail.changeset), reason.trim()))}
    >
      <p>A rejected changeset is never merged. Say why, so the record keeps it.</p>
      <TextArea label="Reason" value={reason} maxLength={1_000} data-autofocus data-testid="review-reject-reason" onChange={(event) => setReason(event.target.value)} />
    </Shell>
  );
}

export function SendBackDialog({ detail, drafts, outdated, onClose, onDone }: DialogProps & { readonly drafts: readonly CommentRecord[]; readonly outdated: readonly CommentRecord[] }) {
  const [message, setMessage] = useState('');
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const { busy, error, submit } = useSubmit(() => {
    onDone();
    onClose();
  });
  const report = detail.report;
  const pathOf = (comment: CommentRecord): string => {
    const file = detail.files.find((candidate) => candidate.idx === comment.fileIdx);
    return plainText(file?.newPath ?? file?.oldPath ?? `file ${comment.fileIdx}`);
  };
  const toggle = (id: string, on: boolean): void => setChosen((previous) => new Set(on ? [...previous, id] : [...previous].filter((known) => known !== id)));
  return (
    <Shell
      title="Send this work back"
      testId="review-send-back-dialog"
      confirmLabel="Send back"
      canConfirm
      busy={busy}
      error={error}
      onClose={onClose}
      onConfirm={() => void submit(() => sendBack(basisOf(detail.changeset), message.trim(), [...chosen]))}
    >
      <p>The agent receives your message, the draft comments below and the reviewer findings you tick, as one message.</p>
      <TextArea label="Message to the agent" value={message} maxLength={4_000} data-autofocus data-testid="review-send-back-message" onChange={(event) => setMessage(event.target.value)} />
      <div className="review-dialog-list" data-testid="review-send-back-drafts">
        <p className="review-dialog-heading">Draft comments sent with it ({drafts.length})</p>
        {drafts.length === 0 && <p className="review-muted">None.</p>}
        {drafts.map((comment) => (
          <p key={comment.id} className="review-dialog-item">
            <code>{`${pathOf(comment)}:${comment.line}`}</code> {plainText(comment.body, { multiline: true })}
          </p>
        ))}
        {outdated.length > 0 && <p className="review-muted">{outdated.length} draft comments point at hunks that changed and are not sent.</p>}
      </div>
      {report !== undefined && report.findings.length > 0 && (
        <div className="review-dialog-list" data-testid="review-send-back-findings">
          <p className="review-dialog-heading">Reviewer findings to include</p>
          {report.findings.map((finding) => (
            <div key={finding.idx} className="review-dialog-item">
              <Checkbox checked={chosen.has(findingId(report, finding))} onCheckedChange={(on) => toggle(findingId(report, finding), on)} label={`${finding.severity}: ${plainText(finding.title)}`} data-testid="review-send-back-finding" />
            </div>
          ))}
        </div>
      )}
    </Shell>
  );
}

export function EscalateDialog({ detail, onClose, onDone }: DialogProps) {
  const higher = RUNGS.filter((rung) => rungIndex(rung) > rungIndex(detail.changeset.rung));
  const [to, setTo] = useState<Rung>(higher[0] ?? 'E');
  const [reason, setReason] = useState('');
  const { busy, error, submit } = useSubmit(() => {
    onDone();
    onClose();
  });
  return (
    <Shell
      title="Raise the rung"
      testId="review-escalate-dialog"
      confirmLabel="Raise the rung"
      canConfirm={higher.length > 0}
      busy={busy}
      error={error}
      onClose={onClose}
      onConfirm={() => void submit(() => escalate(detail.changeset.id, to, reason.trim()))}
    >
      <p>
        The rung is {detail.changeset.rung}. A higher rung asks for more of your attention before this work can be accepted.
      </p>
      {higher.length === 0 ? (
        <Notice tone="info">The rung is already the highest.</Notice>
      ) : (
        <>
          <Select value={to} onValueChange={(value) => setTo(value as Rung)} options={higher.map((rung) => ({ value: rung, label: `${rung}: ${RUNG_LABELS[rung]}` }))} aria-label="New rung" data-testid="review-escalate-rung" />
          <TextArea label="Reason (optional)" value={reason} maxLength={1_000} data-testid="review-escalate-reason" onChange={(event) => setReason(event.target.value)} />
        </>
      )}
    </Shell>
  );
}

export function DemoteDialog({ detail, onClose, onDone }: DialogProps) {
  const lower = RUNGS.filter((rung) => rungIndex(rung) < rungIndex(detail.changeset.rung));
  const [to, setTo] = useState<Rung>(lower[lower.length - 1] ?? 'A');
  const [reason, setReason] = useState('');
  const [token, setToken] = useState<string | undefined>();
  const { busy, error, submit } = useSubmit(() => undefined);
  const hardBlockers = sortReasons(detail.reasons).filter((reason) => reason.hard && rungIndex(reason.minRung) > rungIndex(to));
  const run = async (): Promise<void> => {
    const result = await submit(() => demote(detail.changeset.id, to, reason.trim(), token));
    if (!result.ok) return;
    if (result.value.committed) {
      onDone();
      onClose();
    } else setToken(result.value.confirmToken);
  };
  return (
    <Shell
      title="Lower the rung"
      testId="review-demote-dialog"
      confirmLabel={token === undefined ? 'Lower the rung' : 'Lower it below the floor'}
      confirmVariant={token === undefined ? 'primary' : 'danger'}
      canConfirm={reason.trim().length >= 10 && lower.length > 0}
      busy={busy}
      error={error}
      onClose={onClose}
      onConfirm={() => void run()}
    >
      <p>The rung is {detail.changeset.rung}. Say why a lower rung is enough; the reason is kept in the record.</p>
      <Select
        value={to}
        onValueChange={(value) => {
          setTo(value as Rung);
          setToken(undefined);
        }}
        options={lower.map((rung) => ({ value: rung, label: `${rung}: ${RUNG_LABELS[rung]}` }))}
        aria-label="New rung"
        data-testid="review-demote-rung"
      />
      <TextArea label="Reason (at least ten characters)" value={reason} maxLength={1_000} data-testid="review-demote-reason" onChange={(event) => setReason(event.target.value)} />
      {(token !== undefined || hardBlockers.length > 0) && (
        <Notice tone="warning" role="alert" data-testid="review-demote-floor">
          {token === undefined ? 'Hard reasons hold the floor above this rung. Lowering it asks for a second confirmation.' : 'Press the button again to lower the rung below its floor. These reasons set the floor:'}{' '}
          {hardBlockers.map((reason) => reason.id).join(', ')}
        </Notice>
      )}
    </Shell>
  );
}
