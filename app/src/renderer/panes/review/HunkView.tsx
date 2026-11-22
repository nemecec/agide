import { useRef, useState } from 'react';
import { VisuallyHidden } from 'radix-ui';
import type { ChangesetFile, CommentRecord, Hunk, StoredFinding } from '../../../core/review/schemas';
import { Button } from '../../ui/Button';
import { Chip } from '../../ui/Chip';
import { TextArea } from '../../ui/Field';
import { IconButton } from '../../ui/IconButton';
import { ACTION_ICONS, TONE_ICONS } from '../../ui/icons';
import { Notice } from '../../ui/Notice';
import { FindingView } from './FindingView';
import { GLYPHS, KIND_WORDS, LINE_PAGE, anchorOfLine, page, parseHunkLines, type DiffLine } from './hunkModel';
import { plainText } from './plainText';
import { useDwell } from './useDwell';

export interface HunkViewProps {
  readonly hunk: Hunk;
  readonly file: Pick<ChangesetFile, 'idx'>;
  readonly findings: readonly StoredFinding[];
  readonly drafts: readonly CommentRecord[];
  readonly seen: boolean;
  /** False for a changeset that no longer takes decisions: no seen marks, no comments. */
  readonly interactive: boolean;
  readonly dwellMs?: number;
  readonly onMarkSeen: (how: 'dwell' | 'marked') => void;
  /** Resolves with a failure message, or undefined once the draft is stored. */
  readonly onComment: (side: 'new' | 'old', line: number, body: string) => Promise<string | undefined>;
  readonly onDeleteDraft: (commentId: string) => Promise<string | undefined>;
}

const anchorKey = (side: 'new' | 'old', line: number): string => `${side}:${line}`;

/**
 * One hunk (0040 section 13): line numbers on both sides, `+` and `-` in their own column so the meaning does not
 * rest on colour, added lines on the success surface and removed lines on the danger surface, a marker for CRLF,
 * findings under their line and a comment box per line. A long hunk shows a page of lines and says how many it
 * does not show. It counts as seen when half of it stayed in view for the dwell time, or by "Mark seen". Every
 * line is agent text.
 */
export function HunkView({ hunk, file, findings, drafts, seen, interactive, dwellMs, onMarkSeen, onComment, onDeleteDraft }: HunkViewProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [limit, setLimit] = useState(LINE_PAGE);
  const [composer, setComposer] = useState<{ readonly side: 'new' | 'old'; readonly line: number } | null>(null);
  const [error, setError] = useState<string | undefined>();
  useDwell(ref, { enabled: interactive && !seen, ratio: 0.5, ...(dwellMs === undefined ? {} : { ms: dwellMs }), onSeen: () => onMarkSeen('dwell') });

  const lines = parseHunkLines(hunk);
  const { shown, hidden } = page(lines, limit);
  const shownAnchors = new Set(shown.flatMap((line) => anchorOfLine(line) ?? []).map((anchor) => anchorKey(anchor.side, anchor.line)));
  const findingsAt = (line: DiffLine) => {
    const anchor = anchorOfLine(line);
    return anchor === undefined ? [] : findings.filter((finding) => finding.side === anchor.side && finding.line === anchor.line);
  };
  const draftsAt = (line: DiffLine) => {
    const anchor = anchorOfLine(line);
    return anchor === undefined ? [] : drafts.filter((draft) => draft.side === anchor.side && draft.line === anchor.line);
  };
  const offScreenFindings = findings.filter((finding) => !shownAnchors.has(anchorKey(finding.side, finding.line)));
  const offScreenDrafts = drafts.filter((draft) => !shownAnchors.has(anchorKey(draft.side, draft.line)));

  const submit = async (body: string): Promise<void> => {
    if (composer === null) return;
    const failure = await onComment(composer.side, composer.line, body);
    if (failure === undefined) {
      setComposer(null);
      setError(undefined);
    } else setError(failure);
  };
  const remove = async (commentId: string): Promise<void> => setError(await onDeleteDraft(commentId));

  return (
    <div ref={ref} className="review-hunk" tabIndex={0} data-testid="review-hunk" data-file={file.idx} data-hunk={hunk.idx} data-seen={seen ? 'true' : 'false'} aria-label={`Hunk ${hunk.idx + 1}, ${seen ? 'seen' : 'not seen'}`}>
      <div className="review-hunk-head">
        <code className="review-hunk-range">{`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`}</code>
        {hunk.section !== null && hunk.section !== '' && <span className="review-hunk-section">{plainText(hunk.section)}</span>}
        <span className="review-hunk-seen">
          {seen ? <Chip tone="success" icon={TONE_ICONS.success.icon} label="Seen" data-testid="review-hunk-seen" /> : <Chip label="Not seen" data-testid="review-hunk-unseen" />}
          {interactive && !seen && (
            <Button size="sm" icon={ACTION_ICONS['mark-seen'].icon} data-testid="review-mark-hunk" onClick={() => onMarkSeen('marked')}>
              Mark seen
            </Button>
          )}
        </span>
      </div>
      <table className="review-diff" aria-label="Changed lines">
        <tbody>
          {shown.map((line) => {
            const anchor = anchorOfLine(line);
            const open = composer !== null && anchor !== undefined && composer.side === anchor.side && composer.line === anchor.line;
            return (
              <LineRows
                key={line.index}
                line={line}
                canComment={interactive && anchor !== undefined}
                composing={open}
                findings={findingsAt(line)}
                drafts={draftsAt(line)}
                interactive={interactive}
                error={open ? error : undefined}
                onOpenComposer={() => anchor !== undefined && setComposer(anchor)}
                onCloseComposer={() => setComposer(null)}
                onSubmit={submit}
                onDelete={remove}
              />
            );
          })}
        </tbody>
      </table>
      {hidden > 0 && (
        <p className="review-not-shown" data-testid="review-lines-not-shown">
          <span>{hidden} more lines of this hunk are not shown.</span>
          <Button size="sm" data-testid="review-show-more-lines" onClick={() => setLimit(limit + LINE_PAGE)}>
            Show more lines
          </Button>
        </p>
      )}
      {(offScreenFindings.length > 0 || offScreenDrafts.length > 0) && (
        <div className="review-off-screen" data-testid="review-off-screen">
          <p className="review-muted">Notes on lines that are not shown yet</p>
          {offScreenFindings.map((finding) => (
            <FindingView key={`${finding.idx}`} finding={finding} />
          ))}
          {offScreenDrafts.map((draft) => (
            <DraftRow key={draft.id} draft={draft} interactive={interactive} onDelete={remove} />
          ))}
        </div>
      )}
      {error !== undefined && composer === null && (
        <Notice tone="danger" data-testid="review-hunk-error">
          {error}
        </Notice>
      )}
    </div>
  );
}

interface LineRowsProps {
  readonly line: DiffLine;
  readonly canComment: boolean;
  readonly composing: boolean;
  readonly findings: readonly StoredFinding[];
  readonly drafts: readonly CommentRecord[];
  readonly interactive: boolean;
  readonly error: string | undefined;
  readonly onOpenComposer: () => void;
  readonly onCloseComposer: () => void;
  readonly onSubmit: (body: string) => Promise<void>;
  readonly onDelete: (commentId: string) => Promise<void>;
}

function LineRows({ line, canComment, composing, findings, drafts, interactive, error, onOpenComposer, onCloseComposer, onSubmit, onDelete }: LineRowsProps) {
  const number = (value: number | undefined) => (value === undefined ? '' : value);
  const anchor = anchorOfLine(line);
  const actionCell = useRef<HTMLTableCellElement>(null);
  // Closing the box hands the focus back to the button that opened it.
  const close = (): void => {
    onCloseComposer();
    queueMicrotask(() => actionCell.current?.querySelector('button')?.focus());
  };
  return (
    <>
      <tr className="review-line" data-kind={line.kind} data-testid="review-line" data-side={anchor?.side} data-line={anchor?.line}>
        <td className="review-no" aria-hidden="true">
          {number(line.oldNo)}
        </td>
        <td className="review-no" aria-hidden="true">
          {number(line.newNo)}
        </td>
        <td className="review-glyph">
          <span aria-hidden="true">{GLYPHS[line.kind]}</span>
          <VisuallyHidden.Root>{KIND_WORDS[line.kind]}</VisuallyHidden.Root>
        </td>
        <td className="review-text">
          <span className="review-code">{line.kind === 'note' ? plainText(line.text) : plainText(line.text, { multiline: true })}</span>
          {line.crlf && (
            <span className="review-marker" title="This line ends with a carriage return and a line feed">
              CRLF
            </span>
          )}
        </td>
        <td className="review-action" ref={actionCell}>
          {canComment && (
            <IconButton
              size="sm"
              icon={ACTION_ICONS.comment.icon}
              label={`Comment on ${anchor?.side === 'old' ? 'old' : 'new'} line ${anchor?.line ?? ''}`}
              tooltip={false}
              data-testid="review-comment-open"
              onClick={onOpenComposer}
            />
          )}
        </td>
      </tr>
      {(findings.length > 0 || drafts.length > 0 || composing) && (
        <tr className="review-line-notes">
          <td colSpan={5}>
            {findings.map((finding) => (
              <FindingView key={finding.idx} finding={finding} />
            ))}
            {drafts.map((draft) => (
              <DraftRow key={draft.id} draft={draft} interactive={interactive} onDelete={onDelete} />
            ))}
            {composing && <Composer error={error} line={anchor?.line ?? 0} onCancel={close} onSubmit={onSubmit} />}
          </td>
        </tr>
      )}
    </>
  );
}

function DraftRow({ draft, interactive, onDelete }: { readonly draft: CommentRecord; readonly interactive: boolean; readonly onDelete: (commentId: string) => Promise<void> }) {
  return (
    <div className="review-draft" data-testid="review-draft">
      <div className="review-draft-head">
        <Chip label="Draft comment" />
        <span className="review-muted">Sent with the next send-back</span>
        {interactive && <IconButton size="sm" icon={ACTION_ICONS.remove.icon} label="Delete this draft comment" data-testid="review-draft-delete" onClick={() => void onDelete(draft.id)} />}
      </div>
      <p className="review-draft-body">{plainText(draft.body, { multiline: true })}</p>
    </div>
  );
}

function Composer({ line, error, onCancel, onSubmit }: { readonly line: number; readonly error: string | undefined; readonly onCancel: () => void; readonly onSubmit: (body: string) => Promise<void> }) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const add = async (): Promise<void> => {
    setBusy(true);
    await onSubmit(body.trim());
    setBusy(false);
  };
  return (
    <form
      className="review-composer"
      data-testid="review-composer"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        onCancel();
      }}
      onSubmit={(event) => {
        event.preventDefault();
        if (body.trim() !== '') void add();
      }}
    >
      <TextArea label={`Comment on line ${line}`} value={body} rows={3} maxLength={4_000} autoFocus data-testid="review-comment-text" error={error} onChange={(event) => setBody(event.target.value)} />
      <div className="review-composer-actions">
        <Button size="sm" onClick={onCancel} data-testid="review-comment-cancel">
          Cancel
        </Button>
        <Button size="sm" variant="primary" type="submit" loading={busy} disabled={body.trim() === ''} data-testid="review-comment-add">
          Add comment
        </Button>
      </div>
    </form>
  );
}
