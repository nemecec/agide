import { useRef, useState, type ReactNode } from 'react';
import type { ChangesetFile } from '../../../core/review/schemas';
import type { ChangesetDetail } from '../../../core/review/types';
import { Banner } from '../../ui/Banner';
import { Button } from '../../ui/Button';
import { Chip } from '../../ui/Chip';
import { EmptyState } from '../../ui/EmptyState';
import { ACTION_ICONS, PANE_ICONS, TONE_ICONS } from '../../ui/icons';
import { Notice } from '../../ui/Notice';
import { ActionBar } from './ActionBar';
import { CheckBlock, ClaimBlock, DraftsPanel, FilesTable, ReasonsTable, ReportBlock } from './ChangesetSections';
import { FileView } from './FileView';
import { deleteComment, getChangeset, listChangesets, markSeen, run } from './reviewApi';
import { CHECK_CHIPS, RUNG_LABELS, RUNG_TONES, STATE_CHIPS, VERDICT_WORDS, countText, lineCountsText, splitDrafts, unseenTotal } from './reviewModel';
import { useDwell } from './useDwell';
import { useReviewQuery } from './useReviewQuery';

export interface ChangesetViewProps {
  readonly changesetId: string;
  readonly onBack?: () => void;
  readonly onOpenChangeset: (changesetId: string) => void;
  readonly dwellMs?: number;
}

/**
 * One changeset (0040 section 13): the rung with every reason, its source and evidence, the check result, the
 * reviewer's report with its author, the working agent's claim marked as not verified, the files with their seen
 * state, the batch of draft comments and the decisions. The summary counts as seen after the dwell time in view,
 * or by "Mark read"; the mark binds to the content, rung and reasons, so a change lets it lapse.
 */
export function ChangesetView({ changesetId, onBack, onOpenChangeset, dwellMs }: ChangesetViewProps) {
  const query = useReviewQuery(changesetId, () => getChangeset(changesetId));
  const [fileIdx, setFileIdx] = useState<number | null>(null);
  if (query.status === 'loading') return <EmptyState icon={PANE_ICONS.review.icon} title="Loading the changeset…" data-testid="review-changeset-loading" />;
  if (query.status === 'error') {
    return (
      <div className="review-section review-pad" data-testid="review-changeset-error">
        <Notice tone="danger">{query.message}</Notice>
        <div className="review-row">
          {onBack !== undefined && <Button onClick={onBack}>Back to the list</Button>}
          <Button variant="primary" onClick={query.reload}>
            Try again
          </Button>
        </div>
      </div>
    );
  }
  const detail = query.value;
  const file = fileIdx === null ? undefined : detail.files.find((candidate) => candidate.idx === fileIdx);
  const interactive = detail.changeset.state !== 'superseded' && detail.changeset.state !== 'rejected' && detail.changeset.mergedCommit === null;
  if (file !== undefined) {
    return (
      <div className="review-pad">
        <FileView changesetId={changesetId} file={file} interactive={interactive} {...(dwellMs === undefined ? {} : { dwellMs })} onBack={() => setFileIdx(null)} onChanged={query.reload} />
      </div>
    );
  }
  return <Body detail={detail} interactive={interactive} reload={query.reload} onBack={onBack} onOpenFile={(idx) => setFileIdx(idx)} onOpenChangeset={onOpenChangeset} dwellMs={dwellMs} />;
}

interface BodyProps {
  readonly detail: ChangesetDetail;
  readonly interactive: boolean;
  readonly reload: () => void;
  readonly onBack: (() => void) | undefined;
  readonly onOpenFile: (fileIdx: number) => void;
  readonly onOpenChangeset: (changesetId: string) => void;
  readonly dwellMs: number | undefined;
}

function Body({ detail, interactive, reload, onBack, onOpenFile, onOpenChangeset, dwellMs }: BodyProps) {
  const { changeset } = detail;
  const summary = useRef<HTMLDivElement>(null);
  const [failure, setFailure] = useState<string | undefined>();
  const markSummary = async (how: 'dwell' | 'marked'): Promise<void> => {
    const result = await markSeen(changeset.id, 'summary', how);
    if (result.ok) reload();
    else if (how === 'marked') setFailure(result.failure.message);
  };
  useDwell(summary, { enabled: interactive && !detail.seen.summary, ratio: 0.5, ...(dwellMs === undefined ? {} : { ms: dwellMs }), onSeen: () => void markSummary('dwell') });

  const carried = detail.comments.some((comment) => comment.state === 'draft' && comment.changesetId !== changeset.id);
  const allHunks = useReviewQuery(carried ? `${changeset.id}/all` : null, () => run<ChangesetDetail>('review_get', { changesetId: changeset.id, hunks: true }));
  const loaded = new Map<number, NonNullable<ChangesetDetail['hunks']>[number][]>();
  if (allHunks.status === 'ready') for (const hunk of allHunks.value.hunks ?? []) loaded.set(hunk.fileIdx, [...(loaded.get(hunk.fileIdx) ?? []), hunk]);
  const drafts = splitDrafts(detail.comments, loaded);

  const stateChip = STATE_CHIPS[changeset.state];
  const checkpoint = detail.checks.filter((check) => check.target === 'checkpoint').at(-1);
  const unseen = unseenTotal(detail);
  const newest = async (): Promise<void> => {
    const listed = await listChangesets(changeset.swarmId);
    if (!listed.ok) return setFailure(listed.failure.message);
    const latest = listed.value.filter((item) => item.agent === changeset.agent).sort((a, b) => b.seq - a.seq)[0];
    if (latest === undefined || latest.id === changeset.id) setFailure('No newer changeset was found.');
    else onOpenChangeset(latest.id);
  };

  return (
    <div className="review-pad review-stack" data-testid="review-changeset" data-changeset={changeset.id} data-state={changeset.state} data-rung={changeset.rung}>
      <header className="review-header">
        {onBack !== undefined && (
          <Button size="sm" icon={ACTION_ICONS.back.icon} data-testid="review-back" onClick={onBack}>
            Back to the list
          </Button>
        )}
        <h2 className="review-title" data-testid="review-title">
          {changeset.agent}
          <span className="review-muted"> changeset {changeset.seq}</span>
        </h2>
        <div className="review-chips">
          <Chip tone={stateChip.tone} label={stateChip.label} data-testid="review-state" />
          <Chip tone={RUNG_TONES[changeset.rung]} label={`Rung ${changeset.rung}: ${RUNG_LABELS[changeset.rung]}`} data-testid="review-rung" />
          {checkpoint !== undefined && <Chip tone={CHECK_CHIPS[checkpoint.outcome].tone} label={CHECK_CHIPS[checkpoint.outcome].label} />}
          {detail.report !== undefined && <Chip label={VERDICT_WORDS[detail.report.verdict]} />}
          {changeset.mergedCommit !== null && <Chip tone="success" icon={ACTION_ICONS.merge.icon} label="Merged" data-testid="review-merged" />}
          <span className="review-muted">{countText(changeset.fileCount, 'file', 'files')}, {lineCountsText(changeset.added, changeset.removed)}</span>
          {changeset.attempt > 0 && <span className="review-muted">sent back {countText(changeset.attempt, 'time', 'times')} before</span>}
        </div>
      </header>

      {changeset.state === 'superseded' && (
        <Banner
          tone="warning"
          message="The agent changed its work, so a newer changeset replaced this one. Nothing you decide here applies to it."
          actions={
            <Button size="sm" variant="primary" data-testid="review-open-newest" onClick={() => void newest()}>
              Open the newest
            </Button>
          }
          data-testid="review-superseded"
        />
      )}
      {changeset.state === 'rejected' && <Banner tone="info" message="This changeset was rejected and is never merged." data-testid="review-rejected" />}
      {changeset.state === 'sent_back' && <Banner tone="info" message="This work was sent back. The agent's next capture replaces it." data-testid="review-sent-back" />}
      {failure !== undefined && (
        <Notice tone="danger" data-testid="review-error">
          {failure}
        </Notice>
      )}

      <ActionBar detail={detail} drafts={drafts.live} outdated={drafts.outdated} onDecided={reload} />

      <div ref={summary} className="review-block" data-testid="review-summary" data-seen={detail.seen.summary ? 'true' : 'false'}>
        <Heading title="Why this rung">
          {detail.seen.summary ? (
            <Chip tone="success" icon={TONE_ICONS.success.icon} label="Summary read" data-testid="review-summary-seen" />
          ) : (
            interactive && (
              <Button size="sm" icon={ACTION_ICONS['mark-seen'].icon} data-testid="review-mark-summary" onClick={() => void markSummary('marked')}>
                Mark read
              </Button>
            )
          )}
        </Heading>
        <ReasonsTable reasons={detail.reasons} />
        <Heading title="Project check" />
        <CheckBlock checks={detail.checks} />
        <Heading title="Reviewer" />
        <ReportBlock report={detail.report} runs={detail.runs} onOpenFile={onOpenFile} />
        <Heading title="What the agent says it did" />
        <ClaimBlock claim={changeset.claim} />
      </div>

      <div className="review-block">
        <Heading title="Files">{unseen > 0 && <span className="review-muted" data-testid="review-unseen-total">{countText(unseen, 'hunk', 'hunks')} not seen</span>}</Heading>
        <FilesTable detail={detail} onOpen={(file: ChangesetFile) => onOpenFile(file.idx)} />
      </div>

      <div className="review-block">
        <Heading title="Draft comments" />
        <DraftsPanel
          detail={detail}
          live={drafts.live}
          outdated={drafts.outdated}
          interactive={interactive}
          onDelete={(commentId) => void deleteComment(commentId).then((result) => (result.ok ? reload() : setFailure(result.failure.message)))}
        />
      </div>
    </div>
  );
}

function Heading({ title, children }: { readonly title: string; readonly children?: ReactNode }) {
  return (
    <div className="review-heading">
      <h3>{title}</h3>
      {children}
    </div>
  );
}
