import type { SessionId } from '../../session/types';
import { migrate, type Database } from '../../store/Store';
import type { SwarmId } from '../../swarm/types';
import { reviewPolicySchema } from '../policy/schema';
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
  Rung,
  SeenMark,
  StoredFinding,
  StoredReason,
} from '../schemas';
import { ReviewError, type ChangesetFilter, type ChangesetStore, type ChangesetUpdate } from '../types';
import { REVIEW_MODULE, reviewMigrations } from './reviewMigrations';

type Row = Record<string, unknown>;
type Param = string | number | null;

const json = (value: unknown): string => JSON.stringify(value);
const flag = (value: unknown): boolean => value === 1;
const text = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));
const num = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value));
const bit = (value: boolean): number => (value ? 1 : 0);
const placeholders = (count: number): string => Array.from({ length: count }, () => '?').join(', ');

function changesetOf(row: Row): ChangesetRecord {
  return {
    id: row['id'] as string,
    swarmId: row['swarm_id'] as string,
    agent: row['agent'] as string,
    sessionId: row['session_id'] as string,
    seq: Number(row['seq']),
    attempt: Number(row['attempt']),
    trigger: row['trigger'] as ChangesetRecord['trigger'],
    repoPath: row['repo_path'] as string,
    commonDir: row['common_dir'] as string,
    baseCommit: row['base_commit'] as string,
    headCommit: row['head_commit'] as string,
    checkpointCommit: row['checkpoint_commit'] as string,
    checkpointTree: row['checkpoint_tree'] as string,
    contentHash: row['content_hash'] as string,
    policyHash: row['policy_hash'] as string,
    patchPath: row['patch_path'] as string,
    fileCount: Number(row['file_count']),
    added: Number(row['added']),
    removed: Number(row['removed']),
    workerTier: row['worker_tier'] as ChangesetRecord['workerTier'],
    claim: row['claim'] === null ? null : (JSON.parse(row['claim'] as string) as ChangesetRecord['claim']),
    telemetry: JSON.parse(row['telemetry'] as string) as ChangesetRecord['telemetry'],
    state: row['state'] as ChangesetRecord['state'],
    rung: row['rung'] as Rung,
    floor: row['floor'] as Rung,
    supersedes: text(row['supersedes']),
    mergedCommit: text(row['merged_commit']),
    createdAt: row['created_at'] as string,
    updatedAt: row['updated_at'] as string,
  };
}

function fileOf(row: Row): ChangesetFile {
  return {
    changesetId: row['changeset_id'] as string,
    idx: Number(row['idx']),
    status: row['status'] as ChangesetFile['status'],
    oldPath: text(row['old_path']),
    newPath: text(row['new_path']),
    oldMode: text(row['old_mode']),
    newMode: text(row['new_mode']),
    oldBlob: text(row['old_blob']),
    newBlob: text(row['new_blob']),
    similarity: num(row['similarity']),
    kind: row['kind'] as ChangesetFile['kind'],
    added: Number(row['added']),
    removed: Number(row['removed']),
    oddName: flag(row['odd_name']),
    fileHash: row['file_hash'] as string,
  };
}

function hunkOf(row: Row): Hunk {
  return {
    changesetId: row['changeset_id'] as string,
    fileIdx: Number(row['file_idx']),
    idx: Number(row['idx']),
    oldStart: Number(row['old_start']),
    oldLines: Number(row['old_lines']),
    newStart: Number(row['new_start']),
    newLines: Number(row['new_lines']),
    section: text(row['section']),
    body: row['body'] as string,
    hunkHash: row['hunk_hash'] as string,
  };
}

function reasonOf(row: Row): StoredReason {
  return {
    changesetId: row['changeset_id'] as string,
    id: row['reason_id'] as string,
    subject: row['subject'] as string,
    source: row['source'] as StoredReason['source'],
    evidence: JSON.parse(row['evidence'] as string) as Record<string, unknown>,
    minRung: row['min_rung'] as Rung,
    hard: flag(row['hard']),
    createdAt: row['created_at'] as string,
  };
}

function checkOf(row: Row): CheckRecord {
  return {
    id: row['id'] as string,
    changesetId: text(row['changeset_id']),
    target: row['target'] as CheckRecord['target'],
    commitId: row['commit_id'] as string,
    policyHash: row['policy_hash'] as string,
    command: JSON.parse(row['command'] as string) as string[],
    outcome: row['outcome'] as CheckRecord['outcome'],
    notRunReason: text(row['not_run_reason']),
    exitCode: num(row['exit_code']),
    signal: text(row['signal']),
    durationMs: num(row['duration_ms']),
    outputPath: text(row['output_path']),
    outputTail: text(row['output_tail']),
    truncated: flag(row['truncated']),
    startedAt: row['started_at'] as string,
    endedAt: text(row['ended_at']),
  };
}

function runOf(row: Row): ReviewRunRecord {
  return {
    id: row['id'] as string,
    changesetId: row['changeset_id'] as string,
    attempt: Number(row['attempt']) as 1 | 2,
    sessionId: text(row['session_id']),
    model: row['model'] as string,
    effort: row['effort'] as string,
    promptVersion: text(row['prompt_version']),
    state: row['state'] as ReviewRunRecord['state'],
    failure: text(row['failure']) as ReviewRunRecord['failure'],
    pid: num(row['pid']),
    reservedUsd: Number(row['reserved_usd']),
    reportedUsd: Number(row['reported_usd']),
    rejectedCalls: Number(row['rejected_calls']),
    queuedAt: row['queued_at'] as string,
    startedAt: text(row['started_at']),
    endedAt: text(row['ended_at']),
  };
}

function findingOf(row: Row): StoredFinding {
  return {
    idx: Number(row['idx']),
    fileIdx: Number(row['file_idx']),
    side: row['side'] as StoredFinding['side'],
    line: Number(row['line']),
    hunkHash: row['hunk_hash'] as string,
    onChangedLine: flag(row['on_changed_line']),
    severity: row['severity'] as StoredFinding['severity'],
    title: row['title'] as string,
    body: row['body'] as string,
  };
}

function decisionOf(row: Row): DecisionRecord {
  return {
    id: row['id'] as string,
    changesetId: row['changeset_id'] as string,
    actor: row['actor'] as DecisionRecord['actor'],
    actorSessionId: text(row['actor_session_id']),
    action: row['action'] as DecisionRecord['action'],
    fromState: row['from_state'] as DecisionRecord['fromState'],
    toState: row['to_state'] as DecisionRecord['toState'],
    fromRung: row['from_rung'] as Rung,
    toRung: row['to_rung'] as Rung,
    contentHash: row['content_hash'] as string,
    reason: text(row['reason']),
    createdAt: row['created_at'] as string,
  };
}

function commentOf(row: Row): CommentRecord {
  return {
    id: row['id'] as string,
    changesetId: row['changeset_id'] as string,
    fileIdx: Number(row['file_idx']),
    side: row['side'] as CommentRecord['side'],
    line: Number(row['line']),
    hunkHash: row['hunk_hash'] as string,
    body: row['body'] as string,
    state: row['state'] as CommentRecord['state'],
    sentIn: text(row['sent_in']),
    createdAt: row['created_at'] as string,
  };
}

function policyOf(row: Row): PolicySnapshot {
  return {
    hash: row['hash'] as string,
    source: row['source'] as PolicySnapshot['source'],
    repoPath: row['repo_path'] as string,
    baseCommit: row['base_commit'] as string,
    projectJson: text(row['project_json']),
    userJson: text(row['user_json']),
    effective: reviewPolicySchema.parse(JSON.parse(row['effective_json'] as string)),
    errors: row['errors'] === null ? null : (JSON.parse(row['errors'] as string) as string[]),
    warnings: JSON.parse(row['warnings'] as string) as string[],
    createdAt: row['created_at'] as string,
  };
}

/**
 * The `review` tables on SQLite (0040 section 3.3, 0041). Every method is one synchronous call, so a write that
 * spans several statements runs in one transaction and no other writer of the app database interleaves. Diffs are
 * kept as rows (files and hunks with their text), so removing a worktree, a ref or the patch file loses nothing the
 * review views need.
 */
export class SqliteChangesetStore implements ChangesetStore {
  constructor(private readonly db: Database) {
    migrate(db, REVIEW_MODULE, reviewMigrations);
  }

  putPolicy(snapshot: PolicySnapshot): void {
    this.write(
      `INSERT OR IGNORE INTO review_policies (hash, source, repo_path, base_commit, project_json, user_json, effective_json, errors, warnings, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        snapshot.hash,
        snapshot.source,
        snapshot.repoPath,
        snapshot.baseCommit,
        snapshot.projectJson,
        snapshot.userJson,
        json(snapshot.effective),
        snapshot.errors === null ? null : json(snapshot.errors),
        json(snapshot.warnings),
        snapshot.createdAt,
      ],
    );
  }

  policy(hash: string): PolicySnapshot | undefined {
    const row = this.one('SELECT * FROM review_policies WHERE hash = ?', [hash]);
    return row === undefined ? undefined : policyOf(row);
  }

  insert(changeset: ChangesetRecord, files: readonly ChangesetFile[], hunks: readonly Hunk[]): void {
    if (files.some((file) => file.changesetId !== changeset.id) || hunks.some((hunk) => hunk.changesetId !== changeset.id))
      throw new ReviewError('refused', 'files and hunks belong to the changeset they are inserted with');
    if (hunks.some((hunk) => !files.some((file) => file.idx === hunk.fileIdx))) throw new ReviewError('refused', 'a hunk names a file the changeset does not have');
    this.transaction(() => {
      this.write(
        `INSERT INTO review_changesets (id, swarm_id, agent, session_id, seq, attempt, trigger, repo_path, common_dir, base_commit, head_commit,
           checkpoint_commit, checkpoint_tree, content_hash, policy_hash, patch_path, file_count, added, removed, worker_tier, claim, telemetry,
           state, rung, floor, supersedes, merged_commit, created_at, updated_at)
         VALUES (${placeholders(29)})`,
        [
          changeset.id,
          changeset.swarmId,
          changeset.agent,
          changeset.sessionId,
          changeset.seq,
          changeset.attempt,
          changeset.trigger,
          changeset.repoPath,
          changeset.commonDir,
          changeset.baseCommit,
          changeset.headCommit,
          changeset.checkpointCommit,
          changeset.checkpointTree,
          changeset.contentHash,
          changeset.policyHash,
          changeset.patchPath,
          changeset.fileCount,
          changeset.added,
          changeset.removed,
          changeset.workerTier,
          changeset.claim === null ? null : json(changeset.claim),
          json(changeset.telemetry),
          changeset.state,
          changeset.rung,
          changeset.floor,
          changeset.supersedes,
          changeset.mergedCommit,
          changeset.createdAt,
          changeset.updatedAt,
        ],
      );
      for (const file of files)
        this.write(`INSERT INTO review_files VALUES (${placeholders(15)})`, [
          file.changesetId,
          file.idx,
          file.status,
          file.oldPath,
          file.newPath,
          file.oldMode,
          file.newMode,
          file.oldBlob,
          file.newBlob,
          file.similarity,
          file.kind,
          file.added,
          file.removed,
          bit(file.oddName),
          file.fileHash,
        ]);
      for (const hunk of hunks)
        this.write(`INSERT INTO review_hunks VALUES (${placeholders(10)})`, [
          hunk.changesetId,
          hunk.fileIdx,
          hunk.idx,
          hunk.oldStart,
          hunk.oldLines,
          hunk.newStart,
          hunk.newLines,
          hunk.section,
          hunk.body,
          hunk.hunkHash,
        ]);
    });
  }

  get(id: ChangesetId): ChangesetRecord | undefined {
    const row = this.one('SELECT * FROM review_changesets WHERE id = ?', [id]);
    return row === undefined ? undefined : changesetOf(row);
  }

  list(filter: ChangesetFilter = {}): ChangesetRecord[] {
    const where: string[] = [];
    const params: Param[] = [];
    if (filter.swarmId !== undefined) {
      where.push('swarm_id = ?');
      params.push(filter.swarmId);
    }
    if (filter.agent !== undefined) {
      where.push('agent = ?');
      params.push(filter.agent);
    }
    if (filter.states !== undefined) {
      if (filter.states.length === 0) return [];
      where.push(`state IN (${placeholders(filter.states.length)})`);
      params.push(...filter.states);
    }
    params.push(filter.limit ?? -1);
    return this.all(`SELECT * FROM review_changesets ${where.length === 0 ? '' : `WHERE ${where.join(' AND ')}`} ORDER BY created_at DESC, seq DESC LIMIT ?`, params).map(changesetOf);
  }

  latest(swarmId: SwarmId, agent: string): ChangesetRecord | undefined {
    const row = this.one('SELECT * FROM review_changesets WHERE swarm_id = ? AND agent = ? ORDER BY seq DESC LIMIT 1', [swarmId, agent]);
    return row === undefined ? undefined : changesetOf(row);
  }

  files(id: ChangesetId): ChangesetFile[] {
    return this.all('SELECT * FROM review_files WHERE changeset_id = ? ORDER BY idx', [id]).map(fileOf);
  }

  hunks(id: ChangesetId, fileIdx?: number): Hunk[] {
    if (fileIdx !== undefined) return this.all('SELECT * FROM review_hunks WHERE changeset_id = ? AND file_idx = ? ORDER BY idx', [id, fileIdx]).map(hunkOf);
    return this.all('SELECT * FROM review_hunks WHERE changeset_id = ? ORDER BY file_idx, idx', [id]).map(hunkOf);
  }

  applyDecision(decision: DecisionRecord, update: ChangesetUpdate): ChangesetRecord | undefined {
    if (update.state !== decision.toState || update.rung !== decision.toRung) throw new ReviewError('refused', 'the update and its decision name different states or rungs');
    if (update.rung < update.floor) throw new ReviewError('refused', 'the rung is never below the floor');
    if (update.mergedCommit !== undefined && update.state !== 'accepted') throw new ReviewError('refused', 'only an accepted changeset is merged');
    return this.transaction(() => {
      const changed = this.write(
        `UPDATE review_changesets SET state = ?, rung = ?, floor = ?, attempt = COALESCE(?, attempt), merged_commit = COALESCE(?, merged_commit), updated_at = ?
         WHERE id = ? AND state = ? AND rung = ?`,
        [update.state, update.rung, update.floor, update.attempt ?? null, update.mergedCommit ?? null, decision.createdAt, decision.changesetId, decision.fromState, decision.fromRung],
      );
      if (changed === 0) return undefined;
      this.write(`INSERT INTO review_decisions VALUES (${placeholders(12)})`, [
        decision.id,
        decision.changesetId,
        decision.actor,
        decision.actorSessionId,
        decision.action,
        decision.fromState,
        decision.toState,
        decision.fromRung,
        decision.toRung,
        decision.contentHash,
        decision.reason,
        decision.createdAt,
      ]);
      return this.get(decision.changesetId);
    });
  }

  decisions(id: ChangesetId): DecisionRecord[] {
    return this.all('SELECT * FROM review_decisions WHERE changeset_id = ? ORDER BY rowid', [id]).map(decisionOf);
  }

  addReasons(id: ChangesetId, reasons: readonly Reason[], createdAt: string): StoredReason[] {
    if (this.get(id) === undefined) throw new ReviewError('not_found', `no changeset ${id}`);
    return this.transaction(() => {
      const added: StoredReason[] = [];
      for (const reason of reasons) {
        const changed = this.write(`INSERT OR IGNORE INTO review_reasons VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [
          id,
          reason.id,
          reason.subject,
          reason.source,
          json(reason.evidence),
          reason.minRung,
          bit(reason.hard),
          createdAt,
        ]);
        if (changed > 0) added.push({ ...reason, changesetId: id, createdAt });
      }
      return added;
    });
  }

  reasons(id: ChangesetId): StoredReason[] {
    return this.all('SELECT * FROM review_reasons WHERE changeset_id = ? ORDER BY rowid', [id]).map(reasonOf);
  }

  putCheck(check: CheckRecord): void {
    this.write(
      `INSERT INTO review_checks (id, changeset_id, target, commit_id, policy_hash, command, outcome, not_run_reason, exit_code, signal,
         duration_ms, output_path, output_tail, truncated, started_at, ended_at)
       VALUES (${placeholders(16)})
       ON CONFLICT(id) DO UPDATE SET changeset_id = excluded.changeset_id, target = excluded.target, commit_id = excluded.commit_id,
         policy_hash = excluded.policy_hash, command = excluded.command, outcome = excluded.outcome, not_run_reason = excluded.not_run_reason,
         exit_code = excluded.exit_code, signal = excluded.signal, duration_ms = excluded.duration_ms, output_path = excluded.output_path,
         output_tail = excluded.output_tail, truncated = excluded.truncated, started_at = excluded.started_at, ended_at = excluded.ended_at`,
      [
        check.id,
        check.changesetId,
        check.target,
        check.commitId,
        check.policyHash,
        json(check.command),
        check.outcome,
        check.notRunReason,
        check.exitCode,
        check.signal,
        check.durationMs,
        check.outputPath,
        check.outputTail,
        bit(check.truncated),
        check.startedAt,
        check.endedAt,
      ],
    );
  }

  checks(id: ChangesetId): CheckRecord[] {
    return this.all('SELECT * FROM review_checks WHERE changeset_id = ? ORDER BY rowid', [id]).map(checkOf);
  }

  baseCheck(commitId: string, policyHash: string): CheckRecord | undefined {
    const row = this.one("SELECT * FROM review_checks WHERE target = 'base' AND commit_id = ? AND policy_hash = ? ORDER BY rowid LIMIT 1", [commitId, policyHash]);
    return row === undefined ? undefined : checkOf(row);
  }

  putRun(run: ReviewRunRecord): void {
    this.write(
      `INSERT INTO review_runs (id, changeset_id, attempt, session_id, model, effort, prompt_version, state, failure, pid, reserved_usd,
         reported_usd, rejected_calls, queued_at, started_at, ended_at)
       VALUES (${placeholders(16)})
       ON CONFLICT(id) DO UPDATE SET session_id = excluded.session_id, model = excluded.model, effort = excluded.effort,
         prompt_version = excluded.prompt_version, state = excluded.state, failure = excluded.failure, pid = excluded.pid,
         reserved_usd = excluded.reserved_usd, reported_usd = excluded.reported_usd, rejected_calls = excluded.rejected_calls,
         queued_at = excluded.queued_at, started_at = excluded.started_at, ended_at = excluded.ended_at`,
      [
        run.id,
        run.changesetId,
        run.attempt,
        run.sessionId,
        run.model,
        run.effort,
        run.promptVersion,
        run.state,
        run.failure,
        run.pid,
        run.reservedUsd,
        run.reportedUsd,
        run.rejectedCalls,
        run.queuedAt,
        run.startedAt,
        run.endedAt,
      ],
    );
  }

  run(runId: string): ReviewRunRecord | undefined {
    const row = this.one('SELECT * FROM review_runs WHERE id = ?', [runId]);
    return row === undefined ? undefined : runOf(row);
  }

  runs(id: ChangesetId): ReviewRunRecord[] {
    return this.all('SELECT * FROM review_runs WHERE changeset_id = ? ORDER BY attempt', [id]).map(runOf);
  }

  runBySession(sessionId: SessionId): ReviewRunRecord | undefined {
    const row = this.one('SELECT * FROM review_runs WHERE session_id = ?', [sessionId]);
    return row === undefined ? undefined : runOf(row);
  }

  putReport(report: ReviewReport): void {
    this.transaction(() => {
      this.write(`INSERT INTO review_reports VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
        report.id,
        report.runId,
        report.changesetId,
        report.verdict,
        report.escalateTo,
        report.claimCheck,
        report.summary,
        report.droppedFindings,
        report.receivedAt,
      ]);
      for (const finding of report.findings)
        this.write(`INSERT INTO review_findings VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
          report.id,
          finding.idx,
          finding.fileIdx,
          finding.side,
          finding.line,
          finding.hunkHash,
          bit(finding.onChangedLine),
          finding.severity,
          finding.title,
          finding.body,
        ]);
    });
  }

  reports(id: ChangesetId): ReviewReport[] {
    return this.all('SELECT * FROM review_reports WHERE changeset_id = ? ORDER BY received_at, rowid', [id]).map((row) => ({
      id: row['id'] as string,
      runId: row['run_id'] as string,
      changesetId: row['changeset_id'] as string,
      verdict: row['verdict'] as ReviewReport['verdict'],
      escalateTo: text(row['escalate_to']) as ReviewReport['escalateTo'],
      claimCheck: row['claim_check'] as ReviewReport['claimCheck'],
      summary: row['summary'] as string,
      findings: this.all('SELECT * FROM review_findings WHERE report_id = ? ORDER BY idx', [row['id'] as string]).map(findingOf),
      droppedFindings: Number(row['dropped_findings']),
      receivedAt: row['received_at'] as string,
    }));
  }

  putComment(comment: CommentRecord): void {
    this.write(
      `INSERT INTO review_comments VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET body = excluded.body, state = excluded.state, sent_in = excluded.sent_in`,
      [comment.id, comment.changesetId, comment.fileIdx, comment.side, comment.line, comment.hunkHash, comment.body, comment.state, comment.sentIn, comment.createdAt],
    );
  }

  comment(commentId: string): CommentRecord | undefined {
    const row = this.one('SELECT * FROM review_comments WHERE id = ?', [commentId]);
    return row === undefined ? undefined : commentOf(row);
  }

  deleteComment(commentId: string): boolean {
    return this.write('DELETE FROM review_comments WHERE id = ?', [commentId]) > 0;
  }

  comments(id: ChangesetId): CommentRecord[] {
    return this.all('SELECT * FROM review_comments WHERE changeset_id = ? ORDER BY created_at, rowid', [id]).map(commentOf);
  }

  markSent(commentIds: readonly string[], decisionId: string): void {
    this.transaction(() => {
      for (const id of commentIds) this.write("UPDATE review_comments SET state = 'sent', sent_in = ? WHERE id = ? AND state = 'draft'", [decisionId, id]);
    });
  }

  putSeen(mark: SeenMark): void {
    this.write(
      `INSERT INTO review_seen (scope, level, subject_hash, changeset_id, how, seen_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(scope, level, subject_hash) DO UPDATE SET changeset_id = excluded.changeset_id, how = excluded.how, seen_at = excluded.seen_at`,
      [mark.scope, mark.level, mark.subjectHash, mark.changesetId, mark.how, mark.seenAt],
    );
  }

  seen(scope: string): SeenMark[] {
    return this.all('SELECT * FROM review_seen WHERE scope = ? ORDER BY rowid', [scope]).map((row) => ({
      scope: row['scope'] as string,
      level: row['level'] as SeenMark['level'],
      subjectHash: row['subject_hash'] as string,
      changesetId: row['changeset_id'] as string,
      how: row['how'] as SeenMark['how'],
      seenAt: row['seen_at'] as string,
    }));
  }

  /** Runs one statement and returns the number of rows it changed. */
  private write(sql: string, params: readonly Param[]): number {
    try {
      return Number(this.db.prepare(sql).run(...params).changes);
    } catch (error) {
      throw refusal(error);
    }
  }

  private one(sql: string, params: readonly Param[]): Row | undefined {
    return this.db.prepare(sql).get(...params) as Row | undefined;
  }

  private all(sql: string, params: readonly Param[]): Row[] {
    return this.db.prepare(sql).all(...params) as Row[];
  }

  private transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}

/** A violated constraint is the caller's mistake, not a crash. */
function refusal(error: unknown): unknown {
  const message = error instanceof Error ? error.message : String(error);
  return /constraint failed|FOREIGN KEY|UNIQUE|CHECK/i.test(message) ? new ReviewError('refused', message) : error;
}
