import { useState } from 'react';
import type { ChangesetSummary } from '../../../core/review/types';
import { Button } from '../../ui/Button';
import { Chip } from '../../ui/Chip';
import { Disclosure } from '../../ui/Disclosure';
import { EmptyState } from '../../ui/EmptyState';
import { ACTION_ICONS, PANE_ICONS } from '../../ui/icons';
import { Notice } from '../../ui/Notice';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../ui/Table';
import { MergeDialog } from './MergeDialog';
import { plainText } from './plainText';
import { listChangesets } from './reviewApi';
import { CHECK_CHIPS, RUNG_TONES, STATE_CHIPS, VERDICT_WORDS, acceptedWaitingForMerge, countText, lineCountsText, splitLatest } from './reviewModel';
import { useReviewQuery } from './useReviewQuery';

export interface ChangesetListProps {
  readonly swarmId: string;
  readonly onOpen: (changesetId: string) => void;
}

/**
 * The changesets of a swarm (0040 section 13): per agent the latest changeset with its state, rung, reasons,
 * check, reviewer verdict and line counts, the earlier ones in a Disclosure, and the merge control. It reloads on
 * every review event.
 */
export function ChangesetList({ swarmId, onOpen }: ChangesetListProps) {
  const query = useReviewQuery(swarmId, () => listChangesets(swarmId));
  const [merging, setMerging] = useState(false);
  if (query.status === 'loading') return <EmptyState icon={PANE_ICONS.review.icon} title="Loading the changesets…" data-testid="review-list-loading" />;
  if (query.status === 'error') {
    return (
      <div className="review-section review-pad" data-testid="review-list-error">
        <Notice tone="danger">{query.message}</Notice>
        <div className="review-row">
          <Button variant="primary" onClick={query.reload}>
            Try again
          </Button>
        </div>
      </div>
    );
  }
  const items = query.value;
  if (items.length === 0) {
    return (
      <EmptyState
        icon={PANE_ICONS.review.icon}
        title="Nothing to review yet"
        help="Work of the agents appears here once an agent finishes a turn in its worktree."
        data-testid="review-list-empty"
        data-swarm={swarmId}
      />
    );
  }
  const { latest, earlier } = splitLatest(items);
  const waiting = acceptedWaitingForMerge(items);
  return (
    <div className="review-pad review-stack" data-testid="review-list" data-swarm={swarmId}>
      <div className="review-row">
        <p className="review-muted" data-testid="review-list-summary">
          {countText(latest.length, 'agent', 'agents')} with work to review. {waiting === 0 ? 'Nothing accepted is waiting to be merged.' : `${countText(waiting, 'accepted changeset', 'accepted changesets')} waiting to be merged.`}
        </p>
        <Button variant="primary" icon={ACTION_ICONS.merge.icon} data-testid="review-merge" onClick={() => setMerging(true)}>
          Merge accepted work…
        </Button>
      </div>
      <Rows items={latest} onOpen={onOpen} label="Latest changeset of each agent" />
      {earlier.length > 0 && (
        <Disclosure label={`Earlier changesets (${earlier.length})`} data-testid="review-earlier">
          <Rows items={earlier} onOpen={onOpen} label="Earlier changesets" />
        </Disclosure>
      )}
      {merging && <MergeDialog swarmId={swarmId} agents={latest.map((item) => item.agent)} onClose={() => setMerging(false)} onMerged={query.reload} />}
    </div>
  );
}

function Rows({ items, onOpen, label }: { readonly items: readonly ChangesetSummary[]; readonly onOpen: (id: string) => void; readonly label: string }) {
  return (
    <Table aria-label={label} data-testid="review-changesets">
      <TableHead>
        <TableRow>
          <TableHeader>Agent</TableHeader>
          <TableHeader>State</TableHeader>
          <TableHeader>Rung</TableHeader>
          <TableHeader numeric>Reasons</TableHeader>
          <TableHeader>Check</TableHeader>
          <TableHeader>Reviewer</TableHeader>
          <TableHeader numeric>Files and lines</TableHeader>
          <TableHeader>
            <span className="review-sr">Open</span>
          </TableHeader>
        </TableRow>
      </TableHead>
      <TableBody>
        {items.map((item) => {
          const state = STATE_CHIPS[item.state];
          return (
            <TableRow key={item.id} data-testid="review-changeset-row" data-changeset={item.id} data-state={item.state}>
              <TableCell>
                {plainText(item.agent)}
                <span className="review-cell-note">changeset {item.seq}</span>
              </TableCell>
              <TableCell>
                <Chip tone={state.tone} label={state.label} />
                {item.merged && <Chip tone="success" label="Merged" />}
              </TableCell>
              <TableCell>
                <Chip tone={RUNG_TONES[item.rung]} label={`Rung ${item.rung}`} />
              </TableCell>
              <TableCell numeric>{item.reasonCount}</TableCell>
              <TableCell>{item.checkOutcome === undefined ? <span className="review-muted">None</span> : <Chip tone={CHECK_CHIPS[item.checkOutcome].tone} label={CHECK_CHIPS[item.checkOutcome].label} />}</TableCell>
              <TableCell>{item.verdict === undefined ? <span className="review-muted">None</span> : VERDICT_WORDS[item.verdict].replace('Reviewer: ', '')}</TableCell>
              <TableCell numeric>
                {countText(item.fileCount, 'file', 'files')}, {lineCountsText(item.added, item.removed)}
              </TableCell>
              <TableCell>
                <Button size="sm" data-testid="review-open" aria-label={`Open the changeset of ${item.agent}`} onClick={() => onOpen(item.id)}>
                  Open
                </Button>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
