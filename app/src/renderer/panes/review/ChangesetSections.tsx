import type { ChangesetFile, CheckRecord, Claim, CommentRecord, ReviewReport, ReviewRunRecord, StoredReason } from '../../../core/review/schemas';
import type { ChangesetDetail } from '../../../core/review/types';
import { Button } from '../../ui/Button';
import { Chip } from '../../ui/Chip';
import { IconButton } from '../../ui/IconButton';
import { ACTION_ICONS, TONE_ICONS } from '../../ui/icons';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../ui/Table';
import { FindingView } from './FindingView';
import { plainText } from './plainText';
import {
  CHECK_CHIPS,
  CLAIM_CHECK_WORDS,
  RUNG_TONES,
  SOURCE_WORDS,
  evidenceItems,
  fileLabel,
  fileSeen,
  filePath,
  findingsOfFile,
  lineCountsText,
  reasonsOfFile,
  sortReasons,
  statusWord,
  VERDICT_WORDS,
} from './reviewModel';

const UNSEEN_LABEL = 'Not seen';

export function ReasonsTable({ reasons }: { readonly reasons: readonly StoredReason[] }) {
  if (reasons.length === 0) return <p className="review-muted" data-testid="review-no-reasons">No reason raised the rung, so it is A.</p>;
  return (
    <Table aria-label="Reasons for the rung" data-testid="review-reasons">
      <TableHead>
        <TableRow>
          <TableHeader>Reason</TableHeader>
          <TableHeader>Source</TableHeader>
          <TableHeader>Evidence</TableHeader>
          <TableHeader>Rung</TableHeader>
        </TableRow>
      </TableHead>
      <TableBody>
        {sortReasons(reasons).map((reason) => (
          <TableRow key={`${reason.id}:${reason.subject}`} data-testid="review-reason" data-reason={reason.id}>
            <TableCell>
              <code>{reason.id}</code>
              {reason.subject !== '' && <span className="review-cell-note">{plainText(reason.subject)}</span>}
            </TableCell>
            <TableCell>{SOURCE_WORDS[reason.source]}</TableCell>
            <TableCell>
              <Evidence evidence={reason.evidence} />
            </TableCell>
            <TableCell>
              <Chip tone={RUNG_TONES[reason.minRung]} label={`Rung ${reason.minRung}`} />
              {reason.hard && <span className="review-cell-note">Hard: a policy cannot lower it</span>}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function Evidence({ evidence }: { readonly evidence: Readonly<Record<string, unknown>> }) {
  const items = evidenceItems(evidence);
  if (items.length === 0) return <span className="review-muted">None</span>;
  return (
    <dl className="review-evidence">
      {items.map((item) => (
        <div key={item.key} data-untrusted={item.untrusted || undefined}>
          <dt>{item.key}</dt>
          <dd>
            {item.value}
            {item.shortened && <span className="review-muted"> (shortened)</span>}
            {item.untrusted && <span className="review-muted"> (text from the agent)</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** What the base run says about the checkpoint run: a red base cannot tell good changes from bad, and a change that makes it green is worth saying. */
function baseSentence(checkpoint: CheckRecord, base: CheckRecord): string {
  if (base.outcome === 'failed') {
    return checkpoint.outcome === 'passed'
      ? 'The same check fails on the base commit, and this change made it pass.'
      : 'The same check fails on the base commit as well, so it cannot tell good changes from bad. You decide.';
  }
  return `On the base commit the same check ${CHECK_CHIPS[base.outcome].label.replace('Check ', '')}.`;
}

export function CheckBlock({ checks }: { readonly checks: readonly CheckRecord[] }) {
  const checkpoint = checks.filter((check) => check.target === 'checkpoint').at(-1);
  const base = checks.filter((check) => check.target === 'base').at(-1);
  if (checkpoint === undefined) return <p className="review-muted" data-testid="review-no-check">No project check ran for this changeset.</p>;
  const chip = CHECK_CHIPS[checkpoint.outcome];
  return (
    <div className="review-section" data-testid="review-check" data-outcome={checkpoint.outcome}>
      <div className="review-row">
        <Chip tone={chip.tone} label={chip.label} data-testid="review-check-chip" />
        <code>{plainText(checkpoint.command.join(' '))}</code>
        {checkpoint.durationMs !== null && <span className="review-muted">{(checkpoint.durationMs / 1000).toFixed(1)} s</span>}
        {checkpoint.exitCode !== null && <span className="review-muted">exit code {checkpoint.exitCode}</span>}
      </div>
      {checkpoint.notRunReason !== null && <p className="review-muted">{plainText(checkpoint.notRunReason)}</p>}
      {base !== undefined && <p className="review-muted" data-testid="review-check-base">{baseSentence(checkpoint, base)}</p>}
      {checkpoint.outputTail !== null && checkpoint.outputTail !== '' && (
        <>
          <pre className="review-output" tabIndex={0} aria-label="End of the check output" data-testid="review-check-output">
            {plainText(checkpoint.outputTail, { multiline: true })}
          </pre>
          <p className="review-muted">
            The end of the output{checkpoint.truncated ? ', cut short' : ''}. The project's code produced it, so it is untrusted.
          </p>
        </>
      )}
    </div>
  );
}

export function ReportBlock({ report, runs, onOpenFile }: { readonly report: ReviewReport | undefined; readonly runs: readonly ReviewRunRecord[]; readonly onOpenFile: (fileIdx: number) => void }) {
  const run = report === undefined ? runs.at(-1) : (runs.find((candidate) => candidate.id === report.runId) ?? runs.at(-1));
  if (report === undefined) {
    if (run === undefined) return <p className="review-muted" data-testid="review-no-report">No reviewer ran for this changeset.</p>;
    const word = run.state === 'failed' ? `The reviewer run failed${run.failure === null ? '' : ` (${run.failure})`}.` : run.state === 'cancelled' ? 'The reviewer run was cancelled.' : 'The reviewer has not reported yet.';
    return (
      <p className="review-muted" data-testid="review-no-report">
        {word}
      </p>
    );
  }
  const author = run === undefined ? 'the reviewer agent' : `the reviewer agent (${run.model}${run.promptVersion === null ? '' : `, prompt ${run.promptVersion}`})`;
  return (
    <div className="review-section" data-testid="review-report">
      <div className="review-row">
        <Chip tone={report.verdict === 'accept' ? 'success' : report.verdict === 'revise' ? 'warning' : 'danger'} label={VERDICT_WORDS[report.verdict] + (report.escalateTo === null ? '' : ` to ${report.escalateTo}`)} data-testid="review-verdict" />
        <span className="review-muted">{CLAIM_CHECK_WORDS[report.claimCheck]}</span>
      </div>
      <p className="review-prose" data-testid="review-report-summary">
        {plainText(report.summary, { multiline: true })}
      </p>
      <p className="review-muted">Summary written by {author}.</p>
      {report.droppedFindings > 0 && <p className="review-muted">{report.droppedFindings} findings were dropped because they did not point at a line of the diff.</p>}
      {report.findings.map((finding) => (
        <div key={finding.idx} className="review-finding-row">
          <FindingView finding={finding} author={author} />
          <Button size="sm" data-testid="review-finding-open" onClick={() => onOpenFile(finding.fileIdx)}>
            Show in file
          </Button>
        </div>
      ))}
    </div>
  );
}

export function ClaimBlock({ claim }: { readonly claim: Claim | null }) {
  if (claim === null) return <p className="review-muted" data-testid="review-no-claim">The agent gave no account of its work.</p>;
  return (
    <div className="review-section" data-testid="review-claim">
      <p className="review-muted">Claim, not verified by Agide. Text written by the working agent.</p>
      {claim.source === 'result' ? (
        <>
          <p className="review-prose">{plainText(claim.text, { multiline: true })}</p>
          <p className="review-muted">This is the text of its last result. It did not call report_outcome.</p>
        </>
      ) : (
        <>
          <p className="review-prose">{plainText(claim.summary, { multiline: true })}</p>
          <p className="review-muted">Its confidence: {claim.confidence}.</p>
          {claim.testsRun.length > 0 && (
            <>
              <p className="review-dialog-heading">Tests it says it ran</p>
              <ul className="review-list">
                {claim.testsRun.map((test) => (
                  <li key={test}>{plainText(test)}</li>
                ))}
              </ul>
            </>
          )}
          {claim.unverified.length > 0 && (
            <>
              <p className="review-dialog-heading">What it says it could not verify</p>
              <ul className="review-list">
                {claim.unverified.map((item) => (
                  <li key={item}>{plainText(item)}</li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}

export function FilesTable({ detail, onOpen }: { readonly detail: ChangesetDetail; readonly onOpen: (file: ChangesetFile) => void }) {
  if (detail.files.length === 0) return <p className="review-muted" data-testid="review-no-files">This changeset changes no file.</p>;
  return (
    <Table aria-label="Changed files" data-testid="review-files">
      <TableHead>
        <TableRow>
          <TableHeader>File</TableHeader>
          <TableHeader>Change</TableHeader>
          <TableHeader numeric>Lines</TableHeader>
          <TableHeader>Reasons</TableHeader>
          <TableHeader>Findings</TableHeader>
          <TableHeader>Seen</TableHeader>
        </TableRow>
      </TableHead>
      <TableBody>
        {detail.files.map((file) => {
          const reasons = reasonsOfFile(detail.reasons, file);
          const findings = findingsOfFile(detail.report, file);
          const seen = fileSeen(detail, file.idx);
          return (
            <TableRow key={file.idx} data-testid="review-file-row" data-file={file.idx}>
              <TableCell>
                <button type="button" className="review-link" data-testid="review-file-open" aria-label={`Open ${filePath(file)}`} onClick={() => onOpen(file)}>
                  {fileLabel(file)}
                </button>
                {file.oddName && <span className="review-cell-note">The name holds unusual characters</span>}
              </TableCell>
              <TableCell>{statusWord(file)}</TableCell>
              <TableCell numeric>{lineCountsText(file.added, file.removed)}</TableCell>
              <TableCell>{reasons.length === 0 ? <span className="review-muted">None</span> : reasons.map((reason) => reason.id).join(', ')}</TableCell>
              <TableCell>{findings.length === 0 ? <span className="review-muted">None</span> : `${findings.length}`}</TableCell>
              <TableCell>
                {seen.seen ? <Chip tone="success" icon={TONE_ICONS.success.icon} label="Seen" /> : <Chip label={seen.unseenHunks > 0 ? `${seen.unseenHunks} not seen` : UNSEEN_LABEL} data-testid="review-file-row-unseen" />}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

export interface DraftsPanelProps {
  readonly detail: ChangesetDetail;
  readonly live: readonly CommentRecord[];
  readonly outdated: readonly CommentRecord[];
  readonly onDelete: (commentId: string) => void;
  readonly interactive: boolean;
}

/** The batch: every draft comment of this changeset, sent together with the next send-back. */
export function DraftsPanel({ detail, live, outdated, onDelete, interactive }: DraftsPanelProps) {
  if (live.length === 0 && outdated.length === 0) return <p className="review-muted" data-testid="review-no-drafts">No draft comments. Open a file and comment on a line to add one.</p>;
  const path = (comment: CommentRecord): string => {
    const file = detail.files.find((candidate) => candidate.idx === comment.fileIdx);
    return plainText(file?.newPath ?? file?.oldPath ?? `file ${comment.fileIdx}`);
  };
  const row = (comment: CommentRecord, stale: boolean) => (
    <li key={comment.id} className="review-draft" data-testid="review-draft-row" data-outdated={stale || undefined}>
      <div className="review-draft-head">
        <code>{`${path(comment)}:${comment.line}`}</code>
        <Chip label={stale ? 'Outdated, not sent' : 'Draft'} tone={stale ? 'warning' : 'neutral'} />
        {interactive && <IconButton size="sm" icon={ACTION_ICONS.remove.icon} label="Delete this draft comment" data-testid="review-draft-row-delete" onClick={() => onDelete(comment.id)} />}
      </div>
      <p className="review-draft-body">{plainText(comment.body, { multiline: true })}</p>
    </li>
  );
  return (
    <ul className="review-drafts" data-testid="review-drafts">
      {live.map((comment) => row(comment, false))}
      {outdated.map((comment) => row(comment, true))}
    </ul>
  );
}
