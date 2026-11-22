import { useEffect, useState, type ReactNode } from 'react';
import { EmptyState } from '../../ui/EmptyState';
import { PANE_ICONS } from '../../ui/icons';
import type { PaneProps } from '../paneTypes';
import { ChangesetList } from './ChangesetList';
import { ChangesetView } from './ChangesetView';
import './review.css';

/**
 * `agide/review` (0040 section 13): the changesets of a swarm, or one changeset with its files and hunks. The
 * pane opens on the list (from "Review work"), or on the changeset named by `changesetId` (from the inbox
 * card); the list and the changeset lead to each other inside the pane. Every string an agent wrote
 * renders as plain text with control and bidirectional characters escaped.
 */
export function ReviewPane({ instanceId, config }: PaneProps) {
  const swarmId = typeof config['swarmId'] === 'string' ? config['swarmId'] : '';
  const configured = typeof config['changesetId'] === 'string' ? config['changesetId'] : '';
  const [changesetId, setChangesetId] = useState(configured);
  useEffect(() => setChangesetId(configured), [configured]);
  const shell = (children: ReactNode) => (
    <section className="review-pane" data-testid="review-pane" data-instance={instanceId} data-swarm={swarmId} aria-label="Review">
      {children}
    </section>
  );
  if (swarmId === '' && changesetId === '') return shell(<EmptyState icon={PANE_ICONS.review.icon} title="No swarm selected" help="Open the review from a swarm's Review tab." />);
  if (changesetId === '') return shell(<ChangesetList swarmId={swarmId} onOpen={setChangesetId} />);
  return shell(<ChangesetView key={changesetId} changesetId={changesetId} onOpenChangeset={setChangesetId} {...(swarmId === '' ? {} : { onBack: () => setChangesetId('') })} />);
}
