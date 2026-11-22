import { escapePath } from '../../../core/review/rules/classify';
import { RUNGS, type ChangesetFile, type ChangesetState, type CheckOutcome, type CommentRecord, type Hunk, type ReviewReport, type Rung, type StoredReason, type StoredFinding } from '../../../core/review/schemas';
import type { ChangesetDetail, ChangesetSummary, ReviewItemPayload } from '../../../core/review/types';
import type { StatusKind, Tone } from '../../ui/icons';
import { plainText, shorten } from './plainText';

export interface ChipSpec {
  readonly label: string;
  readonly tone: Tone;
}

export const STATE_CHIPS: Readonly<Record<ChangesetState, ChipSpec & { readonly status: StatusKind }>> = {
  captured: { label: 'Captured', tone: 'neutral', status: 'queued' },
  checking: { label: 'Checking', tone: 'info', status: 'busy' },
  assessed: { label: 'Assessed', tone: 'neutral', status: 'idle' },
  in_review: { label: 'Reviewer running', tone: 'info', status: 'busy' },
  queued_for_budget: { label: 'Waiting for budget', tone: 'warning', status: 'waiting' },
  awaiting_human: { label: 'Needs you', tone: 'warning', status: 'waiting' },
  accepted: { label: 'Accepted', tone: 'success', status: 'done' },
  rejected: { label: 'Rejected', tone: 'danger', status: 'failed' },
  sent_back: { label: 'Sent back', tone: 'neutral', status: 'interrupted' },
  superseded: { label: 'Superseded', tone: 'neutral', status: 'stopped' },
};

export const RUNG_LABELS: Readonly<Record<Rung, string>> = {
  A: 'Check only',
  B: 'Reviewer agent',
  C: 'Your decision',
  D: 'Look at what is flagged',
  E: 'Read everything',
};

export const RUNG_TONES: Readonly<Record<Rung, Tone>> = { A: 'success', B: 'info', C: 'warning', D: 'warning', E: 'danger' };

export const CHECK_CHIPS: Readonly<Record<CheckOutcome, ChipSpec>> = {
  running: { label: 'Check running', tone: 'info' },
  passed: { label: 'Check passed', tone: 'success' },
  failed: { label: 'Check failed', tone: 'danger' },
  timed_out: { label: 'Check timed out', tone: 'danger' },
  not_run: { label: 'Check not run', tone: 'warning' },
};

export const VERDICT_WORDS: Readonly<Record<ReviewReport['verdict'], string>> = { accept: 'Reviewer: accept', revise: 'Reviewer: revise', escalate: 'Reviewer: escalate' };

export const CLAIM_CHECK_WORDS: Readonly<Record<ReviewReport['claimCheck'], string>> = {
  confirmed: 'The reviewer confirmed the claim',
  partly: 'The reviewer confirmed the claim in part',
  contradicted: 'The reviewer found the claim contradicted',
  not_checkable: 'The reviewer could not check the claim',
};

export const SOURCE_WORDS: Readonly<Record<StoredReason['source'], string>> = {
  rule: 'Rule',
  check: 'Check',
  telemetry: 'Run telemetry',
  policy: 'Project policy',
  claim: 'Agent claim',
  reviewer: 'Reviewer',
  agent: 'Agent request',
  user: 'You',
  repo: 'Repository',
};

export const rungIndex = (rung: Rung): number => RUNGS.indexOf(rung);

/** Who may decide a changeset in each state, from the transition table of 0040 section 9.2. */
const DECIDABLE: readonly ChangesetState[] = ['in_review', 'queued_for_budget', 'awaiting_human'];
const REOPENABLE: readonly ChangesetState[] = [...DECIDABLE, 'accepted'];

export interface ActionState {
  readonly accept: boolean;
  readonly reject: boolean;
  readonly sendBack: boolean;
  readonly escalate: boolean;
  readonly demote: boolean;
  /** Rung B and above without a stored reviewer report: accepting needs the "without the reviewer" tick. */
  readonly needsWithoutReviewer: boolean;
}

/**
 * Why Accept is not available yet at rung D or E, in words, or undefined. The server holds the rule; this only knows
 * what the view has: files flagged by a reason (D), the summary mark, and the seen state of every file.
 */
export function acceptBlock(detail: ChangesetDetail): string | undefined {
  const { rung } = detail.changeset;
  if (rung === 'E') return detail.seen.files.some((file) => !file.seen) ? 'Look at every hunk and every file before you accept.' : undefined;
  if (rung !== 'D') return undefined;
  const flagged = detail.files.filter((file) => reasonsOfFile(detail.reasons, file).length > 0);
  if (flagged.length > 0) return flagged.some((file) => !fileSeen(detail, file.idx).seen) ? 'Look at every flagged hunk before you accept.' : undefined;
  return !detail.seen.summary && detail.seen.files.some((file) => !file.seen) ? 'Look at the summary or every hunk before you accept.' : undefined;
}

export function actionState(detail: ChangesetDetail): ActionState {
  const { changeset } = detail;
  const merged = changeset.mergedCommit !== null;
  const live = changeset.state !== 'rejected' && changeset.state !== 'superseded';
  return {
    accept: DECIDABLE.includes(changeset.state) && acceptBlock(detail) === undefined,
    reject: REOPENABLE.includes(changeset.state) && !merged,
    sendBack: REOPENABLE.includes(changeset.state) && !merged,
    escalate: live,
    demote: DECIDABLE.includes(changeset.state) && rungIndex(changeset.rung) > 0,
    needsWithoutReviewer: rungIndex(changeset.rung) >= rungIndex('B') && detail.report === undefined,
  };
}

/** The latest changeset of each agent, newest activity first, and the earlier ones of every agent. */
export function splitLatest(items: readonly ChangesetSummary[]): { readonly latest: readonly ChangesetSummary[]; readonly earlier: readonly ChangesetSummary[] } {
  const top = new Map<string, ChangesetSummary>();
  for (const item of items) {
    const known = top.get(item.agent);
    if (known === undefined || item.seq > known.seq) top.set(item.agent, item);
  }
  const latest = [...top.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const earlier = items.filter((item) => top.get(item.agent)?.id !== item.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { latest, earlier };
}

export const acceptedWaitingForMerge = (items: readonly ChangesetSummary[]): number => splitLatest(items).latest.filter((item) => item.state === 'accepted' && !item.merged).length;

export interface EvidenceItem {
  readonly key: string;
  readonly value: string;
  /** The value is text an agent wrote or produced. */
  readonly untrusted: boolean;
  readonly shortened: boolean;
}

const EVIDENCE_LIMIT = 300;

const isUntrustedText = (value: unknown): value is { untrusted: true; text: string } =>
  typeof value === 'object' && value !== null && (value as { untrusted?: unknown }).untrusted === true && typeof (value as { text?: unknown }).text === 'string';

/** The evidence of a reason as `key: value` rows; agent text inside it is marked and escaped. */
export function evidenceItems(evidence: Readonly<Record<string, unknown>>): EvidenceItem[] {
  return Object.entries(evidence).map(([key, value]) => {
    const untrusted = isUntrustedText(value);
    const raw = untrusted ? value.text : typeof value === 'string' ? value : (JSON.stringify(value) ?? String(value));
    const cut = shorten(raw, EVIDENCE_LIMIT);
    return { key, value: plainText(cut.text, { multiline: true }), untrusted, shortened: cut.cut };
  });
}

/** Reasons by rung, highest first, hard ones before soft ones at the same rung. */
export function sortReasons(reasons: readonly StoredReason[]): StoredReason[] {
  return [...reasons].sort((a, b) => rungIndex(b.minRung) - rungIndex(a.minRung) || Number(b.hard) - Number(a.hard) || a.id.localeCompare(b.id) || a.subject.localeCompare(b.subject));
}

export const filePath = (file: Pick<ChangesetFile, 'oldPath' | 'newPath'>): string => file.newPath ?? file.oldPath ?? '';

export function fileLabel(file: Pick<ChangesetFile, 'oldPath' | 'newPath' | 'status'>): string {
  if (file.status === 'R' && file.oldPath !== null && file.newPath !== null && file.oldPath !== file.newPath) return `${plainText(file.oldPath)} → ${plainText(file.newPath)}`;
  return plainText(filePath(file));
}

const STATUS_WORDS: Readonly<Record<ChangesetFile['status'], string>> = { A: 'Added', M: 'Modified', D: 'Deleted', R: 'Renamed', T: 'Type changed' };
export const statusWord = (file: Pick<ChangesetFile, 'status'>): string => STATUS_WORDS[file.status];

/** What a file without hunks says in place of a diff. */
export function hunklessNotice(file: ChangesetFile): string {
  switch (file.kind) {
    case 'binary':
      return 'Binary file. Its content is not shown.';
    case 'symlink':
      return 'Symbolic link. Its target is not shown here.';
    case 'submodule':
      return 'Submodule. Its commit change is not shown here.';
    case 'large':
      return 'Large file. Its diff was not read, so no line can be commented.';
    case 'text':
      if (file.status === 'R') return 'Renamed without a change to its content.';
      if (file.oldMode !== file.newMode) return `Mode changed from ${file.oldMode ?? 'none'} to ${file.newMode ?? 'none'}.`;
      return 'No lines changed.';
  }
}

export const reasonsOfFile = (reasons: readonly StoredReason[], file: ChangesetFile): StoredReason[] =>
  reasons.filter((reason) => reason.subject !== '' && [file.newPath, file.oldPath].some((path) => path !== null && (reason.subject === path || reason.subject === escapePath(path))));

export const findingsOfFile = (report: ReviewReport | undefined, file: ChangesetFile): StoredFinding[] => report?.findings.filter((finding) => finding.fileIdx === file.idx) ?? [];

export const findingId = (report: ReviewReport, finding: StoredFinding): string => `${report.id}:${finding.idx}`;

/** Unseen hunks of the whole changeset, from the seen state. */
export const unseenTotal = (detail: ChangesetDetail): number => detail.seen.files.reduce((sum, file) => sum + file.unseenHunks, 0);

export const fileSeen = (detail: ChangesetDetail, idx: number): { readonly seen: boolean; readonly unseenHunks: number } => detail.seen.files.find((file) => file.idx === idx) ?? { seen: false, unseenHunks: 0 };

export interface DraftSplit {
  readonly live: readonly CommentRecord[];
  readonly outdated: readonly CommentRecord[];
}

/**
 * Drafts that the next send-back carries, and drafts that it leaves out because their hunk is gone. A draft of an
 * earlier changeset is outdated when its hunk is not among the hunks loaded for its file; a file whose hunks are
 * not loaded cannot tell, so such a draft counts as live.
 */
export function splitDrafts(comments: readonly CommentRecord[], loaded: ReadonlyMap<number, readonly Hunk[]>): DraftSplit {
  const drafts = comments.filter((comment) => comment.state === 'draft');
  const outdated = (comment: CommentRecord): boolean => {
    const hunks = loaded.get(comment.fileIdx);
    return hunks !== undefined && !hunks.some((hunk) => hunk.hunkHash === comment.hunkHash);
  };
  return { live: drafts.filter((comment) => !outdated(comment)), outdated: drafts.filter(outdated) };
}

/** Per hunk, in order, whether a seen mark exists; the keyboard uses it to jump to the next unseen hunk. */
export const seenFlags = (hunks: readonly Hunk[], seen: readonly string[]): boolean[] => hunks.map((hunk) => seen.includes(hunk.hunkHash));

export const countText = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

export function lineCountsText(added: number, removed: number): string {
  return `+${added} -${removed}`;
}

export function reasonIdsText(reasons: readonly StoredReason[], limit = 3): string {
  const ids = sortReasons(reasons).map((reason) => reason.id);
  return ids.length <= limit ? ids.join(', ') : `${ids.slice(0, limit).join(', ')} and ${ids.length - limit} more`;
}

const isRung = (value: unknown): value is Rung => typeof value === 'string' && (RUNGS as readonly string[]).includes(value);

/** The payload of a review inbox item, or undefined when a field is missing or of the wrong kind. */
export function readReviewPayload(payload: unknown): ReviewItemPayload | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const value = payload as Record<string, unknown>;
  const { swarmId, agent, changesetId, rung, contentHash, state, cardAccept, hasReport } = value;
  if (typeof swarmId !== 'string' || typeof agent !== 'string' || typeof changesetId !== 'string' || typeof contentHash !== 'string' || typeof state !== 'string' || typeof cardAccept !== 'boolean' || !isRung(rung)) return undefined;
  // A payload without `hasReport` cannot tell, so the card asks for the tick.
  return { swarmId, agent, changesetId, rung, contentHash, state: state as ChangesetState, cardAccept, hasReport: hasReport === true };
}

/**
 * What the card of a review item offers (0040 section 12): Accept at rung C when no finding is major or above,
 * and for work waiting for budget as at C; Send back at rung C on the same condition; Reject always; Raise
 * budget while the work waits for it.
 */
export function cardButtons(payload: ReviewItemPayload): { readonly accept: boolean; readonly sendBack: boolean; readonly raiseBudget: boolean; readonly withoutReviewer: boolean } {
  const waiting = payload.state === 'queued_for_budget';
  const upToC = rungIndex(payload.rung) <= rungIndex('C');
  const atC = payload.state === 'awaiting_human' && payload.rung === 'C';
  const withoutReviewer = waiting || (rungIndex(payload.rung) >= rungIndex('B') && !payload.hasReport);
  return { accept: payload.cardAccept && upToC && (atC || waiting), sendBack: payload.cardAccept && atC, raiseBudget: waiting, withoutReviewer };
}
