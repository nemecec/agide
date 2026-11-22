import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { UserPolicy } from '../policy/schema';
import { reasonMaker } from '../rules/reasons';
import { fieldsHash } from '../rungs';
import type { CaptureSubject, CaptureTrigger, ChangesetId, Claim, PolicySnapshot, Reason } from '../schemas';
import { ReviewError, type CaptureAgentFacts, type CapturedChangeset, type CaptureResult, type CaptureService, type ChangesetStore, type PolicyLoader, type RepoRef, type ReviewSwarmFacts, type SwarmReviewSetup } from '../types';
import { InMemoryCaptureState, type CaptureJob, type CaptureStateStore, type StoredSnapshot } from './captureState';
import { checkpointRef, commitCheckpoint, readDiff, snapshotTree } from './checkpoint';
import { GuardedGit, type GitExec } from './guardedGit';
import { DiffParseError, type DiffLimits } from './parseDiff';
import { compareSnapshots, takeSnapshot, type RepoSnapshot, type SnapshotDifference } from './repoSnapshot';

export interface GitCaptureServiceDeps {
  readonly facts: ReviewSwarmFacts;
  readonly store: Pick<ChangesetStore, 'putPolicy' | 'policy' | 'latest'>;
  readonly loader: PolicyLoader;
  readonly state?: CaptureStateStore;
  /** The profile data directory; patches are written under `review/<swarm id>/` and their paths stored relative to it. */
  readonly dataDir: string;
  readonly overlay?: () => UserPolicy | undefined;
  /** The user-level Claude files a reviewer would load, compared at each reviewer start. */
  readonly userConfigPaths?: () => readonly string[];
  /** Called once the work tree has been read (or the capture ended without reading it): the manager releases held messages. */
  readonly snapshotTaken?: (subject: CaptureSubject) => void;
  readonly limits?: DiffLimits;
  readonly exec?: GitExec;
  readonly now?: () => Date;
  readonly newId?: () => string;
}

const CLAIM_LIMIT = 8_000;

/**
 * Takes the checkpoint of a swarm agent's worktree, parses the diff against the base and hands the manager a
 * `CapturedChangeset` (0040 sections 4 and 5). The policy is read once per swarm at `prepare`; every capture carries
 * its hash.
 */
export class GitCaptureService implements CaptureService {
  private readonly state: CaptureStateStore;

  constructor(private readonly deps: GitCaptureServiceDeps) {
    this.state = deps.state ?? new InMemoryCaptureState();
  }

  private now(): string {
    return (this.deps.now?.() ?? new Date()).toISOString();
  }

  private git(commonDir: string): Promise<GuardedGit> {
    return GuardedGit.open(commonDir, { ...(this.deps.exec === undefined ? {} : { exec: this.deps.exec }) });
  }

  private userConfigPaths(): readonly string[] {
    return this.deps.userConfigPaths?.() ?? [];
  }

  async prepare(swarmId: string): Promise<SwarmReviewSetup> {
    const swarm = this.deps.facts.swarm(swarmId);
    if (swarm?.repository === undefined) throw new ReviewError('failed', `swarm ${swarmId} has no repository to review`);
    const { path: repoPath, baseCommit } = swarm.repository;
    const commonDir = await GuardedGit.commonDirOf(repoPath, this.deps.exec);
    const repo: RepoRef = { repoPath, commonDir };
    const overlay = this.deps.overlay?.();
    const policy = await this.deps.loader.load(repo, baseCommit, overlay);
    this.deps.store.putPolicy(policy);

    let baseDiffers = false;
    if (this.deps.facts.callerSessionOf(swarmId) !== undefined) {
      const head = (await (await this.git(commonDir)).text(['rev-parse', '--verify', 'HEAD^{commit}'])).trim();
      baseDiffers = (await this.deps.loader.load(repo, head, overlay)).hash !== policy.hash;
    }
    const snapshot = await takeSnapshot({ commonDir, userConfigPaths: this.userConfigPaths(), ...(this.deps.exec === undefined ? {} : { exec: this.deps.exec }) });
    this.state.putSnapshot({ ...snapshot, swarmId, policyHash: policy.hash, baseDiffers, armedAccepted: null, createdAt: this.now() });
    return { policy, baseDiffers };
  }

  async compareRepo(swarmId: string): Promise<readonly Reason[]> {
    const stored = this.requireSnapshot(swarmId);
    const difference = await this.difference(stored);
    return this.reasonsOf(stored, difference);
  }

  /**
   * The user accepted the repository change of the alert. `expectedHash` is the `repoDifferenceHash` of the
   * reasons the user saw: it covers the content of each changed file, the old and new id of each moved ref and the
   * user-level Claude content, so a different change is refused. One snapshot is both compared and stored, so a
   * change made during the accept is never absorbed. A user-level Claude change shown in the alert is covered by the
   * accept. Accepted config changes and ref moves stay on later captures as `repo.armed` and `repo.ref_moved`.
   */
  async acceptRepoChange(swarmId: string, expectedHash: string): Promise<void> {
    const stored = this.requireSnapshot(swarmId);
    const current = await this.currentSnapshot(stored);
    const difference = compareSnapshots(stored, current);
    if (repoDifferenceHash(this.reasonsOf(stored, difference)) !== expectedHash)
      throw new ReviewError('refused', 'the repository changed again since the alert; look at the new change first');
    const accepted = difference.armed.length > 0 ? [...new Set([...(stored.armedAccepted ?? []), ...difference.armed])] : stored.armedAccepted;
    const refsAccepted = [...(stored.refsAccepted ?? []), ...difference.refs];
    this.state.putSnapshot({ ...current, swarmId, policyHash: stored.policyHash, baseDiffers: stored.baseDiffers, armedAccepted: accepted, refsAccepted, createdAt: this.now() });
  }

  /**
   * The app itself moved `ref` from `expectedOld` to `newTip` (a merge): only that ref moves in the snapshot, and only
   * when the snapshot still holds `expectedOld`, so a move by an agent is never absorbed.
   */
  async refreshRef(swarmId: string, ref: string, expectedOld: string, newTip: string): Promise<boolean> {
    const stored = this.requireSnapshot(swarmId);
    if (stored.refs[ref] !== expectedOld) return false;
    this.state.putSnapshot({ ...stored, refs: { ...stored.refs, [ref]: newTip } });
    return true;
  }

  private requireSnapshot(swarmId: string): StoredSnapshot {
    const stored = this.state.snapshot(swarmId);
    if (stored === undefined) throw new ReviewError('failed', `swarm ${swarmId} has no repository snapshot; prepare runs at swarm start`);
    return stored;
  }

  private currentSnapshot(stored: StoredSnapshot): Promise<RepoSnapshot> {
    return takeSnapshot({ commonDir: stored.commonDir, userConfigPaths: this.userConfigPaths(), ...(this.deps.exec === undefined ? {} : { exec: this.deps.exec }) });
  }

  private async difference(stored: StoredSnapshot): Promise<SnapshotDifference> {
    return compareSnapshots(stored, await this.currentSnapshot(stored));
  }

  private policyOf(hash: string): PolicySnapshot {
    const policy = this.deps.store.policy(hash);
    if (policy === undefined) throw new ReviewError('failed', 'the policy of the swarm is not stored');
    return policy;
  }

  private reasonsOf(stored: StoredSnapshot, difference: SnapshotDifference): Reason[] {
    const make = reasonMaker(this.policyOf(stored.policyHash).effective.rungs);
    const reasons: Reason[] = [];
    if (difference.armed.length > 0) reasons.push(make('repo.armed', { evidence: { changed: difference.armed, content: difference.armedContent } }));
    if (difference.refs.length > 0) reasons.push(make('repo.ref_moved', { evidence: { changes: difference.refs.slice(0, 50), changesHash: fieldsHash(JSON.stringify(difference.refs)) } }));
    if (difference.userConfigChanged) reasons.push(make('reviewer.user_config_changed', { evidence: { changed: 'a user-level Claude file', content: difference.userConfigContent } }));
    return reasons;
  }

  async capture(subject: CaptureSubject, trigger: CaptureTrigger): Promise<CaptureResult> {
    const facts = this.deps.facts.captureFacts(subject.swarmId, subject.agent);
    const id = `cs_${(this.deps.newId ?? (() => randomBytes(8).toString('hex')))()}` as ChangesetId;
    if (facts === undefined) return { kind: 'failed', subject, error: `agent ${subject.agent} is not known to swarm ${subject.swarmId}` };
    const job: CaptureJob = { id: `job_${randomBytes(8).toString('hex')}`, swarmId: subject.swarmId, agent: subject.agent, sessionId: facts.sessionId, trigger, state: 'pending', changesetId: id, error: null, createdAt: this.now(), endedAt: null };
    this.state.putJob(job);
    return this.runJob(job, subject);
  }

  async resumePending(): Promise<readonly CaptureResult[]> {
    const results: CaptureResult[] = [];
    for (const job of this.state.pendingJobs()) {
      const subject: CaptureSubject = { kind: 'swarm-agent', swarmId: job.swarmId, agent: job.agent };
      results.push(await this.runJob(job, subject));
    }
    return results;
  }

  private end(job: CaptureJob, state: CaptureJob['state'], error: string | null = null): void {
    this.state.putJob({ ...job, state, error, endedAt: this.now() });
  }

  private async runJob(job: CaptureJob, subject: CaptureSubject): Promise<CaptureResult> {
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      this.deps.snapshotTaken?.(subject);
    };
    try {
      return await this.runSteps(job, subject, release);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.end(job, 'failed', message);
      return { kind: 'failed', subject, error: message };
    } finally {
      release();
    }
  }

  private async runSteps(job: CaptureJob, subject: CaptureSubject, release: () => void): Promise<CaptureResult> {
    const changesetId = job.changesetId!;
    const stored = this.requireSnapshot(subject.swarmId);
    const facts = this.deps.facts.captureFacts(subject.swarmId, subject.agent);
    const swarm = this.deps.facts.swarm(subject.swarmId);
    if (facts?.worktreePath === undefined || swarm?.repository === undefined) {
      this.end(job, 'failed', 'the agent has no worktree to capture');
      return { kind: 'failed', subject, error: 'the agent has no worktree to capture' };
    }

    // Step 1: the repository is compared before any git call that reads the work tree or attributes.
    const difference = await this.difference(stored);
    if (difference.armed.length > 0) {
      const reasons = this.reasonsOf(stored, difference);
      this.end(job, 'failed', 'repo.armed');
      return { kind: 'failed', subject, error: 'repo.armed', reasons };
    }
    const reasons = this.reasonsOf(stored, difference).filter((reason) => reason.id !== 'reviewer.user_config_changed');
    const policy = this.policyOf(stored.policyHash);
    const make = reasonMaker(policy.effective.rungs);
    if (stored.armedAccepted !== null) reasons.push(make('repo.armed', { evidence: { changed: stored.armedAccepted, accepted: true } }));
    if ((stored.refsAccepted ?? []).length > 0 && difference.refs.length === 0) reasons.push(make('repo.ref_moved', { evidence: { changes: stored.refsAccepted!.slice(0, 50), accepted: true } }));
    // The swarm's own policy is the one in doubt, so its rungs do not apply to this reason.
    if (stored.baseDiffers) reasons.push(reasonMaker({})('policy.base_differs', { evidence: { baseCommit: swarm.repository.baseCommit, policyHash: policy.hash } }));

    // Steps 2 and 3: the checkpoint tree from a temporary index, and the no-change decisions.
    const commonDir = stored.commonDir;
    const latest = this.deps.store.latest(subject.swarmId, subject.agent);
    // After a merge every later changeset diffs from the merged checkpoint, which the latest changeset carries as its base.
    const base = latest === undefined ? swarm.repository.baseCommit : latest.mergedCommit !== null ? latest.checkpointCommit : latest.baseCommit;
    const git = await this.git(commonDir);
    const snapshot = await snapshotTree({ worktreePath: facts.worktreePath, commonDir, ...(this.deps.exec === undefined ? {} : { exec: this.deps.exec }) });
    const baseTree = (await git.text(['rev-parse', '--verify', `${base}^{tree}`])).trim();
    if (snapshot.tree === baseTree || snapshot.tree === latest?.checkpointTree) {
      this.end(job, 'no-change');
      return { kind: 'no-change' };
    }

    // Step 4: the checkpoint commit and its ref; a retried job reuses its commit when the ref already holds this tree.
    const commit = await this.checkpointCommit(git, commonDir, changesetId, snapshot);
    release();

    // Steps 6 and 7: diff, parse, store the patch.
    let diff;
    try {
      diff = await readDiff({ commonDir, base, checkpoint: commit, ...(this.deps.limits === undefined ? {} : { limits: this.deps.limits }), ...(this.deps.exec === undefined ? {} : { exec: this.deps.exec }) });
    } catch (error) {
      if (error instanceof DiffParseError) {
        this.end(job, 'failed', error.message);
        return { kind: 'failed', subject, error: error.message };
      }
      throw error;
    }
    const patchPath = join('review', subject.swarmId, `${changesetId}.patch`);
    const absolute = join(this.deps.dataDir, patchPath);
    await mkdir(dirname(absolute), { recursive: true, mode: 0o700 });
    await writeFile(absolute, Buffer.from(diff.patch, 'latin1'), { mode: 0o600 });

    const changeset: CapturedChangeset = {
      id: changesetId,
      subject,
      sessionId: facts.sessionId,
      trigger: job.trigger,
      repoPath: swarm.repository.path,
      commonDir,
      baseCommit: base,
      headCommit: snapshot.head,
      checkpointCommit: commit,
      checkpointTree: snapshot.tree,
      contentHash: fieldsHash(base, snapshot.tree),
      policyHash: stored.policyHash,
      patchPath,
      workerTier: facts.tier,
      claim: claimOf(facts),
      telemetry: facts.telemetry,
      files: diff.files,
      hunks: diff.hunks,
      reasons,
    };
    this.state.putJob({ ...job, state: 'done', changesetId, error: null, endedAt: this.now() });
    return { kind: 'captured', changeset };
  }

  private async checkpointCommit(git: GuardedGit, commonDir: string, changesetId: ChangesetId, snapshot: { head: string; tree: string }): Promise<string> {
    const existing = await git.text(['rev-parse', '--verify', '--quiet', `${checkpointRef(changesetId)}^{commit}`]).catch(() => '');
    if (existing.trim() !== '') {
      const tree = (await git.text(['rev-parse', '--verify', `${existing.trim()}^{tree}`])).trim();
      if (tree !== snapshot.tree) throw new ReviewError('failed', 'the review ref of this job holds another tree');
      return existing.trim();
    }
    return commitCheckpoint({ commonDir, changesetId, tree: snapshot.tree, head: snapshot.head, ...(this.deps.exec === undefined ? {} : { exec: this.deps.exec }) });
  }
}

const ALERT_REASONS = new Set(['repo.armed', 'repo.ref_moved', 'reviewer.user_config_changed']);

/** A hash of the repository reasons an alert shows, with the content hashes in their evidence, so an accept applies to that change only. */
export function repoDifferenceHash(reasons: readonly Pick<Reason, 'id' | 'evidence'>[]): string {
  return fieldsHash(...reasons.filter((reason) => ALERT_REASONS.has(reason.id)).map((reason) => JSON.stringify([reason.id, reason.evidence])));
}

function claimOf(facts: CaptureAgentFacts): Claim | null {
  if (facts.resultText === undefined || facts.resultText === '') return null;
  return { source: 'result', text: facts.resultText.length > CLAIM_LIMIT ? facts.resultText.slice(0, CLAIM_LIMIT) : facts.resultText };
}
