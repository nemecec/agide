import { useState } from 'react';
import type { ItemRow } from '../../../core/inbox/viewTypes';
import { REPO_ALERT_ORIGIN, REVIEW_ITEM_ORIGIN, type ReviewItemPayload } from '../../../core/review/types';
import { Button } from '../../ui/Button';
import { TextField } from '../../ui/Field';
import { Notice } from '../../ui/Notice';
import { openReviewPane } from '../review/openReviewPane';
import { accept, acceptRepoChange, failureOf, reject, sendBack } from '../review/reviewApi';
import { cardButtons, readReviewPayload } from '../review/reviewModel';
import { openSwarmPane } from '../swarm/openSwarmPane';

/**
 * The actions of a review card (0040 section 12): Open (primary); Accept and Send back at rung C when no report
 * finding is `major` or above; Reject with a reason; Raise budget for work queued for budget. Accept sends the
 * payload's `contentHash` and `rung` as the expected values, so a card that shows old content is refused and says
 * so. Reads only the `ReviewItemPayload` of the item. Renders nothing for other items.
 */
export function ReviewCardActions({ item }: { readonly item: ItemRow }) {
  if (item.origin === REPO_ALERT_ORIGIN) return <RepositoryAlertActions payload={item.payload} />;
  if (item.origin !== REVIEW_ITEM_ORIGIN) return null;
  const payload = readReviewPayload(item.payload);
  if (payload === undefined) {
    return (
      <div data-testid="review-card-actions">
        <Notice tone="warning" data-testid="review-card-unreadable">
          This item cannot be decided here: its record is incomplete.
        </Notice>
      </div>
    );
  }
  return <Body payload={payload} />;
}

/** The repository alert of a swarm: Accept applies to the change the alert shows, and a repository that changed again is refused. An alert without the hash of its change offers Open only. */
function RepositoryAlertActions({ payload }: { readonly payload: unknown }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const { swarmId, repoDifferenceHash } = (typeof payload === 'object' && payload !== null ? payload : {}) as { swarmId?: unknown; repoDifferenceHash?: unknown };
  if (typeof swarmId !== 'string') return null;
  const accept = async (): Promise<void> => {
    setBusy(true);
    setError(undefined);
    setError(failureOf(await acceptRepoChange(swarmId, repoDifferenceHash as string)));
    setBusy(false);
  };
  return (
    <div className="review-card" data-testid="review-repo-actions">
      <div className="review-card-buttons">
        {typeof repoDifferenceHash === 'string' && (
          <Button size="sm" disabled={busy} data-testid="review-repo-accept" onClick={() => void accept()}>
            Accept the change
          </Button>
        )}
        <Button size="sm" disabled={busy} data-testid="review-repo-open-swarm" onClick={() => void openSwarmPane(swarmId)}>
          Open swarm
        </Button>
      </div>
      {error !== undefined && (
        <Notice tone="danger" data-testid="review-repo-error">
          {error}
        </Notice>
      )}
    </div>
  );
}

function Body({ payload }: { readonly payload: ReviewItemPayload }) {
  const buttons = cardButtons(payload);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const basis = { changesetId: payload.changesetId, contentHash: payload.contentHash, rung: payload.rung };

  const attempt = async (action: () => Promise<string | undefined>): Promise<void> => {
    setBusy(true);
    setError(undefined);
    setError(await action());
    setBusy(false);
  };
  const open = (): void => void attempt(() => openReviewPane(payload.swarmId, payload.changesetId));

  return (
    <div className="review-card" data-testid="review-card-actions" data-changeset={payload.changesetId}>
      <div className="review-card-buttons">
        <Button variant="primary" size="sm" data-testid="review-card-open" onClick={open}>
          Open
        </Button>
        {buttons.accept && (
          <Button size="sm" disabled={busy} data-testid="review-card-accept" onClick={() => void attempt(() => accept(basis, { withoutReviewer: buttons.withoutReviewer }).then(failureOf))}>
            {buttons.withoutReviewer ? 'Accept without the reviewer' : 'Accept'}
          </Button>
        )}
        {buttons.sendBack && (
          <Button size="sm" disabled={busy} data-testid="review-card-send-back" onClick={() => void attempt(() => sendBack(basis, '', []).then(failureOf))}>
            Send back
          </Button>
        )}
        <Button size="sm" variant="danger" disabled={busy} data-testid="review-card-reject" onClick={() => setRejecting(!rejecting)}>
          Reject…
        </Button>
        {buttons.raiseBudget && (
          <Button size="sm" data-testid="review-card-raise-budget" onClick={() => void attempt(() => openSwarmPane(payload.swarmId))}>
            Raise budget
          </Button>
        )}
      </div>
      {rejecting && (
        <form
          className="review-card-reject"
          onSubmit={(event) => {
            event.preventDefault();
            if (reason.trim() !== '') void attempt(() => reject(basis, reason.trim()).then(failureOf));
          }}
        >
          <TextField label="Reason for rejecting" value={reason} maxLength={1_000} data-testid="review-card-reason" onChange={(event) => setReason(event.target.value)} />
          <Button size="sm" variant="danger" type="submit" disabled={busy || reason.trim() === ''} data-testid="review-card-reject-confirm">
            Reject
          </Button>
        </form>
      )}
      {error !== undefined && (
        <Notice tone="danger" data-testid="review-card-error">
          {error}
        </Notice>
      )}
    </div>
  );
}
