import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { ChangesetFile } from '../../../core/review/schemas';
import { Button } from '../../ui/Button';
import { Chip } from '../../ui/Chip';
import { EmptyState } from '../../ui/EmptyState';
import { ACTION_ICONS, PANE_ICONS, TONE_ICONS } from '../../ui/icons';
import { Notice } from '../../ui/Notice';
import { HunkView } from './HunkView';
import { HUNK_PAGE, nextUnseen, page, stepIndex } from './hunkModel';
import { addComment, deleteComment, getFileHunks, markSeen } from './reviewApi';
import { fileLabel, findingsOfFile, fileSeen, hunklessNotice, lineCountsText, seenFlags, statusWord } from './reviewModel';
import { useReviewQuery } from './useReviewQuery';

export interface FileViewProps {
  readonly changesetId: string;
  readonly file: ChangesetFile;
  /** False for a changeset that no longer takes decisions. */
  readonly interactive: boolean;
  readonly dwellMs?: number;
  readonly onBack: () => void;
  /** Called after a seen mark or a comment changed, so the changeset view reloads its counts. */
  readonly onChanged: () => void;
}

const isTextEntry = (target: EventTarget | null): boolean => target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

/**
 * One file of a changeset (0040 section 13): its hunks in order with findings and draft comments inline. The hunks
 * load when the file opens and show a page at a time. Keys: `j` and `k` move between hunks, `n` jumps to the next
 * unseen hunk and `m` marks the focused hunk seen. A file without hunks says why and is seen by its own mark.
 * The path is agent text.
 */
export function FileView({ changesetId, file, interactive, dwellMs, onBack, onChanged }: FileViewProps) {
  const query = useReviewQuery(`${changesetId}/${file.idx}`, () => getFileHunks(changesetId, file.idx));
  const [limit, setLimit] = useState(HUNK_PAGE);
  const root = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<number | null>(null);

  const hunkElements = (): HTMLElement[] => [...(root.current?.querySelectorAll<HTMLElement>('[data-testid="review-hunk"]') ?? [])];
  const focusHunk = (at: number): void => {
    const target = hunkElements()[at];
    target?.focus();
    target?.scrollIntoView({ block: 'start' });
  };
  const ready = query.status === 'ready';
  useEffect(() => {
    if (ready) root.current?.focus({ preventScroll: true });
  }, [ready]);
  useEffect(() => {
    if (pendingFocus.current === null) return;
    focusHunk(pendingFocus.current);
    pendingFocus.current = null;
  });

  if (query.status === 'loading') return <EmptyState icon={PANE_ICONS.review.icon} title="Loading the file…" data-testid="review-file-loading" />;
  if (query.status === 'error') {
    return (
      <div className="review-section" data-testid="review-file-error">
        <Notice tone="danger">{query.message}</Notice>
        <div className="review-row">
          <Button onClick={onBack}>Back to the changeset</Button>
          <Button variant="primary" onClick={query.reload}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  const detail = query.value;
  const hunks = (detail.hunks ?? []).filter((hunk) => hunk.fileIdx === file.idx);
  const report = detail.report;
  const seenHunks = detail.seen.hunks;
  const flags = seenFlags(hunks, seenHunks);
  const shown = page(hunks, limit);
  const fileState = fileSeen(detail, file.idx);
  const drafts = detail.comments.filter((comment) => comment.state === 'draft' && comment.fileIdx === file.idx);

  const changed = (): void => {
    query.reload();
    onChanged();
  };
  const mark = async (level: 'file' | 'hunk', how: 'dwell' | 'marked', hunkIdx?: number): Promise<void> => {
    const result = await markSeen(changesetId, level, how, file.idx, hunkIdx);
    if (result.ok) changed();
  };
  const current = (): number => hunkElements().findIndex((element) => element === document.activeElement || element.contains(document.activeElement));
  const move = (to: number): void => {
    if (to < 0) return;
    if (to >= shown.shown.length && shown.hidden > 0) {
      pendingFocus.current = to;
      setLimit(limit + HUNK_PAGE);
    } else focusHunk(to);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (isTextEntry(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
    const at = current();
    if (event.key === 'j') move(stepIndex(hunks.length, at, 1));
    else if (event.key === 'k') move(stepIndex(hunks.length, at, -1));
    else if (event.key === 'n') move(nextUnseen(flags, at));
    else if (event.key === 'm' && interactive && at >= 0 && !flags[at]) void mark('hunk', 'marked', hunks[at]?.idx);
    else return;
    event.preventDefault();
  };

  return (
    <div ref={root} className="review-section review-file" tabIndex={-1} data-testid="review-file" data-file={file.idx} onKeyDown={onKeyDown}>
      <div className="review-row">
        <Button size="sm" icon={ACTION_ICONS.back.icon} data-testid="review-file-back" onClick={onBack}>
          Back to the changeset
        </Button>
        <h3 className="review-file-title" data-testid="review-file-title">
          {fileLabel(file)}
        </h3>
        <Chip label={statusWord(file)} />
        <span className="review-muted">{lineCountsText(file.added, file.removed)}</span>
        {fileState.seen ? <Chip tone="success" icon={TONE_ICONS.success.icon} label="Seen" /> : <Chip label={fileState.unseenHunks > 0 ? `${fileState.unseenHunks} not seen` : 'Not seen'} data-testid="review-file-unseen" />}
      </div>
      {hunks.length > 0 && (
        <p className="review-muted" data-testid="review-keys">
          Keys: j and k move between hunks, n jumps to the next unseen hunk, m marks the focused hunk seen.
        </p>
      )}
      {hunks.length === 0 && (
        <div className="review-section" data-testid="review-hunkless">
          <Notice tone="info">{hunklessNotice(file)}</Notice>
          {interactive && !fileState.seen && (
            <div className="review-row">
              <Button icon={ACTION_ICONS['mark-seen'].icon} data-testid="review-mark-file" onClick={() => void mark('file', 'marked')}>
                Mark seen
              </Button>
            </div>
          )}
        </div>
      )}
      {shown.shown.map((hunk) => (
        <HunkView
          key={hunk.hunkHash}
          hunk={hunk}
          file={file}
          findings={findingsOfFile(report, file).filter((finding) => finding.hunkHash === hunk.hunkHash)}
          drafts={drafts.filter((draft) => draft.hunkHash === hunk.hunkHash)}
          seen={seenHunks.includes(hunk.hunkHash)}
          interactive={interactive}
          {...(dwellMs === undefined ? {} : { dwellMs })}
          onMarkSeen={(how) => void mark('hunk', how, hunk.idx)}
          onComment={async (side, line, body) => {
            const result = await addComment(changesetId, file.idx, side, line, body);
            if (result.ok) changed();
            return result.ok ? undefined : result.failure.message;
          }}
          onDeleteDraft={async (commentId) => {
            const result = await deleteComment(commentId);
            if (result.ok) changed();
            return result.ok ? undefined : result.failure.message;
          }}
        />
      ))}
      {shown.hidden > 0 && (
        <p className="review-not-shown" data-testid="review-hunks-not-shown">
          <span>{shown.hidden} more hunks of this file are not shown.</span>
          <Button size="sm" data-testid="review-show-more-hunks" onClick={() => setLimit(limit + HUNK_PAGE)}>
            Show more hunks
          </Button>
        </p>
      )}
    </div>
  );
}
