import type { SessionId } from '../../session/types';
import type { SwarmId } from '../../swarm/types';
import type {
  ChangesetFile,
  ChangesetId,
  ChangesetRecord,
  CheckRecord,
  CommentRecord,
  DecisionRecord,
  Hunk,
  PolicySnapshot,
  Reason,
  ReviewReport,
  ReviewRunRecord,
  SeenMark,
  StoredReason,
} from '../schemas';
import { ReviewError, type ChangesetFilter, type ChangesetStore, type ChangesetUpdate } from '../types';

const byNewest = (a: ChangesetRecord, b: ChangesetRecord): number => b.createdAt.localeCompare(a.createdAt) || b.seq - a.seq;
const reasonKey = (reason: { readonly id: string; readonly subject: string }): string => `${reason.id}\0${reason.subject}`;
const seenKey = (mark: SeenMark): string => `${mark.scope}\0${mark.level}\0${mark.subjectHash}`;

/** The review tables in memory, for tests and the contract suite. Records are copied in and out. */
export class InMemoryChangesetStore implements ChangesetStore {
  private readonly policies = new Map<string, PolicySnapshot>();
  private readonly changesets = new Map<ChangesetId, ChangesetRecord>();
  private readonly fileRows = new Map<ChangesetId, ChangesetFile[]>();
  private readonly hunkRows = new Map<ChangesetId, Hunk[]>();
  private readonly decisionRows = new Map<ChangesetId, DecisionRecord[]>();
  private readonly reasonRows = new Map<ChangesetId, StoredReason[]>();
  private readonly checkRows = new Map<string, CheckRecord>();
  private readonly runRows = new Map<string, ReviewRunRecord>();
  private readonly reportRows = new Map<string, ReviewReport>();
  private readonly commentRows = new Map<string, CommentRecord>();
  private readonly seenRows = new Map<string, SeenMark>();

  putPolicy(snapshot: PolicySnapshot): void {
    if (!this.policies.has(snapshot.hash)) this.policies.set(snapshot.hash, structuredClone(snapshot));
  }

  policy(hash: string): PolicySnapshot | undefined {
    const found = this.policies.get(hash);
    return found === undefined ? undefined : structuredClone(found);
  }

  insert(changeset: ChangesetRecord, files: readonly ChangesetFile[], hunks: readonly Hunk[]): void {
    if (this.changesets.has(changeset.id)) throw new ReviewError('refused', `changeset ${changeset.id} exists`);
    if ([...this.changesets.values()].some((other) => other.swarmId === changeset.swarmId && other.agent === changeset.agent && other.seq === changeset.seq))
      throw new ReviewError('refused', `${changeset.agent} already has a changeset ${changeset.seq}`);
    if (!this.policies.has(changeset.policyHash)) throw new ReviewError('refused', `unknown policy ${changeset.policyHash}`);
    if (files.some((file) => file.changesetId !== changeset.id) || hunks.some((hunk) => hunk.changesetId !== changeset.id))
      throw new ReviewError('refused', 'files and hunks belong to the changeset they are inserted with');
    if (hunks.some((hunk) => !files.some((file) => file.idx === hunk.fileIdx))) throw new ReviewError('refused', 'a hunk names a file the changeset does not have');
    this.changesets.set(changeset.id, structuredClone(changeset));
    this.fileRows.set(changeset.id, structuredClone([...files]).sort((a, b) => a.idx - b.idx));
    this.hunkRows.set(changeset.id, structuredClone([...hunks]).sort((a, b) => a.fileIdx - b.fileIdx || a.idx - b.idx));
    this.decisionRows.set(changeset.id, []);
    this.reasonRows.set(changeset.id, []);
  }

  get(id: ChangesetId): ChangesetRecord | undefined {
    const found = this.changesets.get(id);
    return found === undefined ? undefined : structuredClone(found);
  }

  list(filter: ChangesetFilter = {}): ChangesetRecord[] {
    return [...this.changesets.values()]
      .filter((changeset) => filter.swarmId === undefined || changeset.swarmId === filter.swarmId)
      .filter((changeset) => filter.agent === undefined || changeset.agent === filter.agent)
      .filter((changeset) => filter.states === undefined || filter.states.includes(changeset.state))
      .sort(byNewest)
      .slice(0, filter.limit ?? Number.MAX_SAFE_INTEGER)
      .map((changeset) => structuredClone(changeset));
  }

  latest(swarmId: SwarmId, agent: string): ChangesetRecord | undefined {
    const own = [...this.changesets.values()].filter((changeset) => changeset.swarmId === swarmId && changeset.agent === agent);
    const top = own.sort((a, b) => b.seq - a.seq)[0];
    return top === undefined ? undefined : structuredClone(top);
  }

  files(id: ChangesetId): ChangesetFile[] {
    return structuredClone(this.fileRows.get(id) ?? []);
  }

  hunks(id: ChangesetId, fileIdx?: number): Hunk[] {
    return structuredClone((this.hunkRows.get(id) ?? []).filter((hunk) => fileIdx === undefined || hunk.fileIdx === fileIdx));
  }

  applyDecision(decision: DecisionRecord, update: ChangesetUpdate): ChangesetRecord | undefined {
    const current = this.changesets.get(decision.changesetId);
    if (current === undefined || current.state !== decision.fromState || current.rung !== decision.fromRung) return undefined;
    if (update.state !== decision.toState || update.rung !== decision.toRung) throw new ReviewError('refused', 'the update and its decision name different states or rungs');
    if (update.rung < update.floor) throw new ReviewError('refused', 'the rung is never below the floor');
    if (update.mergedCommit !== undefined && update.state !== 'accepted') throw new ReviewError('refused', 'only an accepted changeset is merged');
    const next: ChangesetRecord = {
      ...current,
      state: update.state,
      rung: update.rung,
      floor: update.floor,
      ...(update.attempt === undefined ? {} : { attempt: update.attempt }),
      ...(update.mergedCommit === undefined ? {} : { mergedCommit: update.mergedCommit }),
      updatedAt: decision.createdAt,
    };
    this.changesets.set(next.id, next);
    this.decisionRows.get(next.id)!.push(structuredClone(decision));
    return structuredClone(next);
  }

  decisions(id: ChangesetId): DecisionRecord[] {
    return structuredClone(this.decisionRows.get(id) ?? []);
  }

  addReasons(id: ChangesetId, reasons: readonly Reason[], createdAt: string): StoredReason[] {
    const rows = this.reasonRows.get(id);
    if (rows === undefined) throw new ReviewError('not_found', `no changeset ${id}`);
    const known = new Set(rows.map(reasonKey));
    const added: StoredReason[] = [];
    for (const reason of reasons) {
      if (known.has(reasonKey(reason))) continue;
      known.add(reasonKey(reason));
      const stored: StoredReason = { ...structuredClone(reason), changesetId: id, createdAt };
      rows.push(stored);
      added.push(structuredClone(stored));
    }
    return added;
  }

  reasons(id: ChangesetId): StoredReason[] {
    return structuredClone(this.reasonRows.get(id) ?? []);
  }

  putCheck(check: CheckRecord): void {
    this.checkRows.set(check.id, structuredClone(check));
  }

  checks(id: ChangesetId): CheckRecord[] {
    return [...this.checkRows.values()].filter((check) => check.changesetId === id).map((check) => structuredClone(check));
  }

  baseCheck(commitId: string, policyHash: string): CheckRecord | undefined {
    const found = [...this.checkRows.values()].find((check) => check.target === 'base' && check.commitId === commitId && check.policyHash === policyHash);
    return found === undefined ? undefined : structuredClone(found);
  }

  putRun(run: ReviewRunRecord): void {
    const other = [...this.runRows.values()].find((candidate) => candidate.id !== run.id && candidate.changesetId === run.changesetId && candidate.attempt === run.attempt);
    if (other !== undefined) throw new ReviewError('refused', `attempt ${run.attempt} of ${run.changesetId} exists`);
    if (run.sessionId !== null && [...this.runRows.values()].some((candidate) => candidate.id !== run.id && candidate.sessionId === run.sessionId))
      throw new ReviewError('refused', 'a reviewer session belongs to one run');
    this.runRows.set(run.id, structuredClone(run));
  }

  run(runId: string): ReviewRunRecord | undefined {
    const found = this.runRows.get(runId);
    return found === undefined ? undefined : structuredClone(found);
  }

  runs(id: ChangesetId): ReviewRunRecord[] {
    return [...this.runRows.values()].filter((run) => run.changesetId === id).sort((a, b) => a.attempt - b.attempt).map((run) => structuredClone(run));
  }

  runBySession(sessionId: SessionId): ReviewRunRecord | undefined {
    const found = [...this.runRows.values()].find((run) => run.sessionId === sessionId);
    return found === undefined ? undefined : structuredClone(found);
  }

  putReport(report: ReviewReport): void {
    if ([...this.reportRows.values()].some((other) => other.runId === report.runId)) throw new ReviewError('refused', 'already reported');
    this.reportRows.set(report.id, structuredClone(report));
  }

  reports(id: ChangesetId): ReviewReport[] {
    return [...this.reportRows.values()]
      .filter((report) => report.changesetId === id)
      .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
      .map((report) => structuredClone(report));
  }

  putComment(comment: CommentRecord): void {
    this.commentRows.set(comment.id, structuredClone(comment));
  }

  comment(commentId: string): CommentRecord | undefined {
    const found = this.commentRows.get(commentId);
    return found === undefined ? undefined : structuredClone(found);
  }

  deleteComment(commentId: string): boolean {
    return this.commentRows.delete(commentId);
  }

  comments(id: ChangesetId): CommentRecord[] {
    return [...this.commentRows.values()].filter((comment) => comment.changesetId === id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((comment) => structuredClone(comment));
  }

  markSent(commentIds: readonly string[], decisionId: string): void {
    for (const id of commentIds) {
      const found = this.commentRows.get(id);
      if (found !== undefined && found.state === 'draft') this.commentRows.set(id, { ...found, state: 'sent', sentIn: decisionId });
    }
  }

  putSeen(mark: SeenMark): void {
    this.seenRows.set(seenKey(mark), structuredClone(mark));
  }

  seen(scope: string): SeenMark[] {
    return [...this.seenRows.values()].filter((mark) => mark.scope === scope).map((mark) => structuredClone(mark));
  }
}
