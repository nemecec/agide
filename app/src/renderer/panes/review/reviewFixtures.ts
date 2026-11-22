import type { ChangesetFile, ChangesetRecord, CheckRecord, CommentRecord, Hunk, ReviewReport, ReviewRunRecord, StoredReason } from '../../../core/review/schemas';
import type { ChangesetDetail, ChangesetSummary } from '../../../core/review/types';

/** Builders of review views for the tests of the review UI. Hashes and ids are derived from a number. */
export const hex = (n: number, length = 64): string => n.toString(16).padStart(length, '0');
export const CHANGESET = 'cs_0000000000000001';
const T = '2026-11-21T10:00:00.000Z';

export const changesetRecord = (extra: Partial<ChangesetRecord> = {}): ChangesetRecord => ({
  id: CHANGESET,
  swarmId: 'sw1',
  agent: 'worker',
  sessionId: 'session-worker',
  seq: 1,
  attempt: 0,
  trigger: 'quiet-result',
  repoPath: 'repo',
  commonDir: 'repo/.git',
  baseCommit: hex(1, 40),
  headCommit: hex(2, 40),
  checkpointCommit: hex(3, 40),
  checkpointTree: hex(4, 40),
  contentHash: hex(5),
  policyHash: hex(6),
  patchPath: 'review/sw1/one.patch',
  fileCount: 2,
  added: 3,
  removed: 1,
  workerTier: 'mid',
  claim: { source: 'report_outcome', summary: 'Validated the signup form.', confidence: 'medium', testsRun: ['pnpm test'], unverified: ['browser behaviour'] },
  telemetry: { endState: 'done', turns: 2, retries: 0, denials: 0, deniedTools: [], toolErrors: 0, spendUsd: 0.2, backgroundStopped: 0 },
  state: 'awaiting_human',
  rung: 'C',
  floor: 'A',
  supersedes: null,
  mergedCommit: null,
  createdAt: T,
  updatedAt: T,
  ...extra,
});

export const fileRecord = (idx: number, path: string, extra: Partial<ChangesetFile> = {}): ChangesetFile => ({
  changesetId: CHANGESET,
  idx,
  status: 'M',
  oldPath: path,
  newPath: path,
  oldMode: '100644',
  newMode: '100644',
  oldBlob: hex(10 + idx, 40),
  newBlob: hex(20 + idx, 40),
  similarity: null,
  kind: 'text',
  added: 2,
  removed: 1,
  oddName: false,
  fileHash: hex(100 + idx),
  ...extra,
});

export const hunkRecord = (fileIdx: number, idx: number, body: string, extra: Partial<Hunk> = {}): Hunk => ({
  changesetId: CHANGESET,
  fileIdx,
  idx,
  oldStart: 10,
  oldLines: 3,
  newStart: 10,
  newLines: 4,
  section: null,
  body,
  hunkHash: hex(1000 + fileIdx * 100 + idx),
  ...extra,
});

export const BODY = ' keep\n-old line\n+new line\n+second line';

export const reasonRecord = (id: string, extra: Partial<StoredReason> = {}): StoredReason => ({
  changesetId: CHANGESET,
  id,
  subject: '',
  source: 'rule',
  evidence: {},
  minRung: 'C',
  hard: false,
  createdAt: T,
  ...extra,
});

export const checkRecord = (extra: Partial<CheckRecord> = {}): CheckRecord => ({
  id: 'chk1',
  changesetId: CHANGESET,
  target: 'checkpoint',
  commitId: hex(3, 40),
  policyHash: hex(6),
  command: ['pnpm', 'test'],
  outcome: 'passed',
  notRunReason: null,
  exitCode: 0,
  signal: null,
  durationMs: 1200,
  outputPath: null,
  outputTail: 'all green',
  truncated: false,
  startedAt: T,
  endedAt: T,
  ...extra,
});

export const runRecord = (extra: Partial<ReviewRunRecord> = {}): ReviewRunRecord => ({
  id: 'run1',
  changesetId: CHANGESET,
  attempt: 1,
  sessionId: 'session-reviewer',
  model: 'sonnet',
  effort: 'medium',
  promptVersion: 'v1',
  state: 'reported',
  failure: null,
  pid: null,
  reservedUsd: 0.2,
  reportedUsd: 0.1,
  rejectedCalls: 0,
  queuedAt: T,
  startedAt: T,
  endedAt: T,
  ...extra,
});

export const reportRecord = (extra: Partial<ReviewReport> = {}): ReviewReport => ({
  id: 'rep1',
  runId: 'run1',
  changesetId: CHANGESET,
  verdict: 'revise',
  escalateTo: null,
  claimCheck: 'partly',
  summary: 'The validation misses an empty name.',
  findings: [{ idx: 0, fileIdx: 0, side: 'new', line: 11, hunkHash: hex(1000), onChangedLine: true, severity: 'major', title: 'Empty name accepted', body: 'Add a check.' }],
  droppedFindings: 0,
  receivedAt: T,
  ...extra,
});

export const commentRecord = (extra: Partial<CommentRecord> = {}): CommentRecord => ({
  id: 'cm1',
  changesetId: CHANGESET,
  fileIdx: 0,
  side: 'new',
  line: 11,
  hunkHash: hex(1000),
  body: 'Why not trim first?',
  state: 'draft',
  sentIn: null,
  createdAt: T,
  ...extra,
});

export function detailFixture(extra: Partial<ChangesetDetail> & { readonly seenHunks?: readonly string[] } = {}): ChangesetDetail {
  const { seenHunks = [], ...rest } = extra;
  const files = rest.files ?? [fileRecord(0, 'src/form.ts'), fileRecord(1, 'src/rules.ts')];
  return {
    changeset: changesetRecord(),
    files,
    reasons: [reasonRecord('size.large')],
    checks: [checkRecord()],
    runs: [runRecord()],
    decisions: [],
    comments: [],
    seen: {
      summaryHash: hex(7),
      summary: false,
      files: files.map((file) => ({ idx: file.idx, seen: false, unseenHunks: 1 })),
      hunks: [...seenHunks],
    },
    ...rest,
  };
}

export const summaryRecord = (extra: Partial<ChangesetSummary> = {}): ChangesetSummary => ({
  id: CHANGESET,
  swarmId: 'sw1',
  agent: 'worker',
  seq: 1,
  state: 'awaiting_human',
  rung: 'C',
  floor: 'A',
  reasonCount: 1,
  checkOutcome: 'passed',
  fileCount: 2,
  added: 3,
  removed: 1,
  contentHash: hex(5),
  merged: false,
  createdAt: T,
  updatedAt: T,
  ...extra,
});
