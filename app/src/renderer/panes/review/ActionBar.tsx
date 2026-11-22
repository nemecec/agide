import { useState } from 'react';
import type { CommentRecord } from '../../../core/review/schemas';
import type { ChangesetDetail } from '../../../core/review/types';
import { Button } from '../../ui/Button';
import { Checkbox } from '../../ui/Checkbox';
import { ACTION_ICONS, TONE_ICONS } from '../../ui/icons';
import { Notice } from '../../ui/Notice';
import { Toolbar, ToolbarItem } from '../../ui/Toolbar';
import { DemoteDialog, EscalateDialog, RejectDialog, SendBackDialog } from './ReviewDialogs';
import { accept, basisOf } from './reviewApi';
import { acceptBlock, actionState } from './reviewModel';

type Open = 'reject' | 'send-back' | 'escalate' | 'demote' | null;

export interface ActionBarProps {
  readonly detail: ChangesetDetail;
  readonly drafts: readonly CommentRecord[];
  readonly outdated: readonly CommentRecord[];
  /** Called after a decision went through, so the view reloads. */
  readonly onDecided: () => void;
}

/** What stops the user from accepting, in words, for the line under the buttons. */
function hint(detail: ChangesetDetail): string | undefined {
  const { changeset } = detail;
  if (changeset.state === 'superseded') return 'A newer changeset replaced this one, so no decision on it applies.';
  if (changeset.state === 'rejected') return 'This changeset was rejected.';
  if (changeset.mergedCommit !== null) return 'This changeset is merged.';
  if (changeset.state === 'in_review') return 'The reviewer is still working. You can accept or decide now without waiting.';
  if (changeset.rung === 'D') return acceptBlock(detail) ?? 'At rung D every flagged hunk must be seen before you accept.';
  if (changeset.rung === 'E') return acceptBlock(detail) ?? 'At rung E every hunk and every file must be seen before you accept.';
  return undefined;
}

/**
 * Accept, send back, reject and the two rung changes of one changeset (0040 section 11.3). Accept sends the
 * content hash and rung that the view shows, so content that changed in the meantime is refused and the view says
 * so. Rung B and above without a reviewer report needs the "without the reviewer" tick.
 */
export function ActionBar({ detail, drafts, outdated, onDecided }: ActionBarProps) {
  const [open, setOpen] = useState<Open>(null);
  const [withoutReviewer, setWithoutReviewer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const allowed = actionState(detail);
  const note = hint(detail);
  const close = (): void => setOpen(null);

  const doAccept = async (): Promise<void> => {
    setBusy(true);
    setError(undefined);
    const result = await accept(basisOf(detail.changeset), { withoutReviewer: allowed.needsWithoutReviewer && withoutReviewer });
    setBusy(false);
    if (result.ok) onDecided();
    else setError(result.failure.message);
  };
  const dialog = { detail, onClose: close, onDone: onDecided };

  return (
    <div className="review-actions" data-testid="review-actions">
      <Toolbar aria-label="Decisions" className="review-toolbar">
        <ToolbarItem asChild>
          <Button variant="primary" icon={TONE_ICONS.success.icon} loading={busy} disabled={!allowed.accept || (allowed.needsWithoutReviewer && !withoutReviewer)} data-testid="review-accept" onClick={() => void doAccept()}>
            Accept
          </Button>
        </ToolbarItem>
        <ToolbarItem asChild>
          <Button disabled={!allowed.sendBack} data-testid="review-send-back" onClick={() => setOpen('send-back')}>
            Send back…
          </Button>
        </ToolbarItem>
        <ToolbarItem asChild>
          <Button variant="danger" disabled={!allowed.reject} data-testid="review-reject" onClick={() => setOpen('reject')}>
            Reject…
          </Button>
        </ToolbarItem>
        <ToolbarItem asChild>
          <Button icon={ACTION_ICONS.escalate.icon} disabled={!allowed.escalate} data-testid="review-escalate" onClick={() => setOpen('escalate')}>
            Raise the rung…
          </Button>
        </ToolbarItem>
        <ToolbarItem asChild>
          <Button variant="quiet" disabled={!allowed.demote} data-testid="review-demote" onClick={() => setOpen('demote')}>
            Lower the rung…
          </Button>
        </ToolbarItem>
      </Toolbar>
      {allowed.accept && allowed.needsWithoutReviewer && (
        <Checkbox checked={withoutReviewer} onCheckedChange={setWithoutReviewer} label="Accept without the reviewer" description="No reviewer report is stored for this changeset. The decision records that you went without it." data-testid="review-without-reviewer" />
      )}
      {note !== undefined && (
        <p className="review-muted" data-testid="review-action-hint">
          {note}
        </p>
      )}
      {error !== undefined && (
        <Notice tone="danger" data-testid="review-action-error">
          {error}
        </Notice>
      )}
      {open === 'reject' && <RejectDialog {...dialog} />}
      {open === 'send-back' && <SendBackDialog {...dialog} drafts={drafts} outdated={outdated} />}
      {open === 'escalate' && <EscalateDialog {...dialog} />}
      {open === 'demote' && <DemoteDialog {...dialog} />}
    </div>
  );
}
