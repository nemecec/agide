import type { Database } from '../../store/Store';
import type { CaptureTrigger, ChangesetId } from '../schemas';
import type { RefChange, RepoSnapshot } from './repoSnapshot';

/** The capture jobs and the repository snapshot of a swarm (0040 sections 3.3 and 4.2); the capture service keeps them over the module's database. */

export type CaptureJobState = 'pending' | 'done' | 'no-change' | 'failed';

export interface CaptureJob {
  readonly id: string;
  readonly swarmId: string;
  readonly agent: string;
  readonly sessionId: string;
  readonly trigger: CaptureTrigger;
  readonly state: CaptureJobState;
  readonly changesetId: ChangesetId | null;
  readonly error: string | null;
  readonly createdAt: string;
  readonly endedAt: string | null;
}

export interface StoredSnapshot extends RepoSnapshot {
  readonly swarmId: string;
  readonly policyHash: string;
  readonly baseDiffers: boolean;
  /** What the user accepted from a `repo.armed` alert; later captures carry `repo.armed`. Null when nothing was accepted. */
  readonly armedAccepted: readonly string[] | null;
  /** Ref moves the user accepted from a `repo.ref_moved` alert; later captures carry `repo.ref_moved`. */
  readonly refsAccepted?: readonly RefChange[];
  readonly createdAt: string;
}

export interface CaptureStateStore {
  putJob(job: CaptureJob): void;
  job(id: string): CaptureJob | undefined;
  pendingJobs(): CaptureJob[];
  putSnapshot(snapshot: StoredSnapshot): void;
  snapshot(swarmId: string): StoredSnapshot | undefined;
}

export class InMemoryCaptureState implements CaptureStateStore {
  private readonly jobs = new Map<string, CaptureJob>();
  private readonly snapshots = new Map<string, StoredSnapshot>();

  putJob(job: CaptureJob): void {
    this.jobs.set(job.id, job);
  }

  job(id: string): CaptureJob | undefined {
    return this.jobs.get(id);
  }

  pendingJobs(): CaptureJob[] {
    return [...this.jobs.values()].filter((job) => job.state === 'pending');
  }

  putSnapshot(snapshot: StoredSnapshot): void {
    this.snapshots.set(snapshot.swarmId, snapshot);
  }

  snapshot(swarmId: string): StoredSnapshot | undefined {
    return this.snapshots.get(swarmId);
  }
}

interface JobRow {
  id: string;
  swarm_id: string;
  agent: string;
  session_id: string;
  trigger: CaptureTrigger;
  state: CaptureJobState;
  changeset_id: string | null;
  error: string | null;
  created_at: string;
  ended_at: string | null;
}

interface SnapshotRow {
  swarm_id: string;
  common_dir: string;
  config_hash: string;
  hooks_hash: string;
  info_attributes_hash: string;
  refs: string;
  user_config_hash: string;
  policy_hash: string;
  base_differs: number;
  created_at: string;
}

const toJob = (row: JobRow): CaptureJob => ({
  id: row.id,
  swarmId: row.swarm_id,
  agent: row.agent,
  sessionId: row.session_id,
  trigger: row.trigger,
  state: row.state,
  changesetId: row.changeset_id,
  error: row.error,
  createdAt: row.created_at,
  endedAt: row.ended_at,
});

/**
 * The same state in the `review_capture_jobs` and `review_repo_snapshots` tables. The `refs` column holds the refs and
 * the accepted repository changes as one JSON object, so no column is added to migration 1.
 */
export class SqliteCaptureState implements CaptureStateStore {
  constructor(private readonly db: Database) {}

  putJob(job: CaptureJob): void {
    this.db
      .prepare(
        `INSERT INTO review_capture_jobs (id, swarm_id, agent, session_id, trigger, state, changeset_id, error, created_at, ended_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET state = excluded.state, changeset_id = excluded.changeset_id, error = excluded.error, ended_at = excluded.ended_at`,
      )
      .run(job.id, job.swarmId, job.agent, job.sessionId, job.trigger, job.state, job.changesetId, job.error, job.createdAt, job.endedAt);
  }

  job(id: string): CaptureJob | undefined {
    const row = this.db.prepare('SELECT * FROM review_capture_jobs WHERE id = ?').get(id) as JobRow | undefined;
    return row === undefined ? undefined : toJob(row);
  }

  pendingJobs(): CaptureJob[] {
    return (this.db.prepare("SELECT * FROM review_capture_jobs WHERE state = 'pending' ORDER BY created_at, id").all() as unknown as JobRow[]).map(toJob);
  }

  putSnapshot(snapshot: StoredSnapshot): void {
    this.db
      .prepare(
        `INSERT INTO review_repo_snapshots (swarm_id, common_dir, config_hash, hooks_hash, info_attributes_hash, refs, user_config_hash, policy_hash, base_differs, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(swarm_id) DO UPDATE SET common_dir = excluded.common_dir, config_hash = excluded.config_hash, hooks_hash = excluded.hooks_hash,
           info_attributes_hash = excluded.info_attributes_hash, refs = excluded.refs, user_config_hash = excluded.user_config_hash,
           policy_hash = excluded.policy_hash, base_differs = excluded.base_differs, created_at = excluded.created_at`,
      )
      .run(
        snapshot.swarmId,
        snapshot.commonDir,
        snapshot.configHash,
        snapshot.hooksHash,
        snapshot.infoAttributesHash,
        JSON.stringify({ refs: snapshot.refs, armedAccepted: snapshot.armedAccepted, refsAccepted: snapshot.refsAccepted ?? [] }),
        snapshot.userConfigHash,
        snapshot.policyHash,
        snapshot.baseDiffers ? 1 : 0,
        snapshot.createdAt,
      );
  }

  snapshot(swarmId: string): StoredSnapshot | undefined {
    const row = this.db.prepare('SELECT * FROM review_repo_snapshots WHERE swarm_id = ?').get(swarmId) as SnapshotRow | undefined;
    if (row === undefined) return undefined;
    const stored = JSON.parse(row.refs) as { refs: Record<string, string>; armedAccepted: string[] | null; refsAccepted?: RefChange[] };
    return {
      swarmId: row.swarm_id,
      commonDir: row.common_dir,
      configHash: row.config_hash,
      hooksHash: row.hooks_hash,
      infoAttributesHash: row.info_attributes_hash,
      refs: stored.refs,
      armedAccepted: stored.armedAccepted,
      refsAccepted: stored.refsAccepted ?? [],
      userConfigHash: row.user_config_hash,
      policyHash: row.policy_hash,
      baseDiffers: row.base_differs === 1,
      createdAt: row.created_at,
    };
  }
}
