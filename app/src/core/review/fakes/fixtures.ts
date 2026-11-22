import { createHash } from 'node:crypto';
import { DEFAULT_REVIEW_POLICY, type ReviewPolicy } from '../policy/schema';
import type { ChangesetFile, ChangesetRecord, Hunk, PolicySnapshot } from '../schemas';
import type { CapturedChangeset } from '../types';

/** Valid records for tests of the store, the manager and the views. Ids and hashes are derived from a seed. */

export const sha1Of = (seed: string): string => createHash('sha1').update(seed).digest('hex');
export const sha256Of = (seed: string): string => createHash('sha256').update(seed).digest('hex');
export const changesetIdOf = (seed: string): string => `cs_${sha256Of(seed).slice(0, 16)}`;

export function policySnapshot(policy: ReviewPolicy = DEFAULT_REVIEW_POLICY, seed = 'policy'): PolicySnapshot {
  return {
    hash: sha256Of(`${seed}:${JSON.stringify(policy)}`),
    source: 'default',
    repoPath: '/repo',
    baseCommit: sha1Of('base'),
    projectJson: null,
    userJson: null,
    effective: policy,
    errors: null,
    warnings: [],
    createdAt: '2026-11-21T00:00:00.000Z',
  };
}

export interface FixtureFile {
  readonly path: string;
  /** Hunk bodies; each becomes one hunk. */
  readonly hunks: readonly string[];
}

/** Files and hunks without `changesetId`, as a capture hands them over. */
export function capturedFiles(files: readonly FixtureFile[], contentSeed = ''): { files: CapturedChangeset['files']; hunks: CapturedChangeset['hunks'] } {
  const outFiles: Omit<ChangesetFile, 'changesetId'>[] = [];
  const outHunks: Omit<Hunk, 'changesetId'>[] = [];
  files.forEach((file, idx) => {
    const added = file.hunks.reduce((sum, body) => sum + body.split('\n').filter((line) => line.startsWith('+')).length, 0);
    const removed = file.hunks.reduce((sum, body) => sum + body.split('\n').filter((line) => line.startsWith('-')).length, 0);
    outFiles.push({
      idx,
      status: 'M',
      oldPath: file.path,
      newPath: file.path,
      oldMode: '100644',
      newMode: '100644',
      oldBlob: sha1Of(`old:${file.path}`),
      newBlob: sha1Of(`new:${file.path}:${file.hunks.join('|')}:${contentSeed}`),
      similarity: null,
      kind: 'text',
      added,
      removed,
      oddName: false,
      fileHash: sha256Of(`file:${file.path}:${file.hunks.join('|')}`),
    });
    file.hunks.forEach((body, hunkIdx) => {
      const lines = body.split('\n');
      outHunks.push({
        fileIdx: idx,
        idx: hunkIdx,
        oldStart: 1 + hunkIdx * 10,
        oldLines: lines.filter((line) => !line.startsWith('+')).length,
        newStart: 1 + hunkIdx * 10,
        newLines: lines.filter((line) => !line.startsWith('-')).length,
        section: null,
        body,
        hunkHash: sha256Of(`hunk:${file.path}:${body}`),
      });
    });
  });
  return { files: outFiles, hunks: outHunks };
}

export interface CaptureFixture {
  readonly swarmId?: string;
  readonly agent?: string;
  readonly sessionId?: string;
  readonly seed: string;
  readonly policyHash: string;
  readonly files?: readonly FixtureFile[];
  readonly claim?: CapturedChangeset['claim'];
  readonly reasons?: CapturedChangeset['reasons'];
  readonly workerTier?: CapturedChangeset['workerTier'];
}

/** A capture of one agent's worktree with one text file by default. */
export function captureFixture(input: CaptureFixture): CapturedChangeset {
  const files = input.files ?? [{ path: 'src/a.ts', hunks: [` keep\n-old ${input.seed}\n+new ${input.seed}`] }];
  const parsed = capturedFiles(files, input.seed);
  return {
    id: changesetIdOf(input.seed),
    subject: { kind: 'swarm-agent', swarmId: input.swarmId ?? 'sw1', agent: input.agent ?? 'worker' },
    sessionId: input.sessionId ?? 'session-worker',
    trigger: 'quiet-result',
    repoPath: '/repo',
    commonDir: '/repo/.git',
    baseCommit: sha1Of('base'),
    headCommit: sha1Of(`head:${input.seed}`),
    checkpointCommit: sha1Of(`checkpoint:${input.seed}`),
    checkpointTree: sha1Of(`tree:${input.seed}`),
    contentHash: sha256Of(`content:${input.seed}`),
    policyHash: input.policyHash,
    patchPath: `review/sw1/${changesetIdOf(input.seed)}.patch`,
    workerTier: input.workerTier ?? 'mid',
    claim: input.claim ?? { source: 'result', text: `done ${input.seed}` },
    telemetry: { endState: 'done', turns: 1, retries: 0, denials: 0, deniedTools: [], toolErrors: 0, spendUsd: 0.01, backgroundStopped: 0 },
    files: parsed.files,
    hunks: parsed.hunks,
    reasons: input.reasons ?? [],
  };
}

/** A stored changeset record in `captured` at rung A, for store tests. */
export function changesetRecord(capture: CapturedChangeset, seq = 1, createdAt = '2026-11-21T10:00:00.000Z'): { changeset: ChangesetRecord; files: ChangesetFile[]; hunks: Hunk[] } {
  const changeset: ChangesetRecord = {
    id: capture.id,
    swarmId: capture.subject.swarmId,
    agent: capture.subject.agent,
    sessionId: capture.sessionId,
    seq,
    attempt: 0,
    trigger: capture.trigger,
    repoPath: capture.repoPath,
    commonDir: capture.commonDir,
    baseCommit: capture.baseCommit,
    headCommit: capture.headCommit,
    checkpointCommit: capture.checkpointCommit,
    checkpointTree: capture.checkpointTree,
    contentHash: capture.contentHash,
    policyHash: capture.policyHash,
    patchPath: capture.patchPath,
    fileCount: capture.files.length,
    added: capture.files.reduce((sum, file) => sum + file.added, 0),
    removed: capture.files.reduce((sum, file) => sum + file.removed, 0),
    workerTier: capture.workerTier,
    claim: capture.claim,
    telemetry: capture.telemetry,
    state: 'captured',
    rung: 'A',
    floor: 'A',
    supersedes: null,
    mergedCommit: null,
    createdAt,
    updatedAt: createdAt,
  };
  return {
    changeset,
    files: capture.files.map((file) => ({ ...file, changesetId: capture.id })),
    hunks: capture.hunks.map((hunk) => ({ ...hunk, changesetId: capture.id })),
  };
}
