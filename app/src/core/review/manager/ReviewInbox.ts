import { cleanLine, MESSAGE_MAX, type InboxService, type NewItem, type Resolution } from '../../inbox/index';
import type { SwarmId } from '../../swarm/types';
import { rungIndex } from '../rungs';
import { BLOCKING_SEVERITIES, CHANGESET_STATES, FINAL_STATES, type ChangesetRecord, type DecisionRecord, type Reason } from '../schemas';
import { BASE_ALERT_ORIGIN, REPO_ALERT_ORIGIN, REVIEW_ITEM_ORIGIN, type ChangesetStore, type ReviewEvent, type ReviewItemPayload, type ReviewSwarmFacts } from '../types';

const SOURCE = 'app';

export const repositoryAlertKey = (swarmId: SwarmId): string => `review:repo:${swarmId}`;
export const baseAlertKey = (swarmId: SwarmId, baseCommit: string, policyHash: string): string => `review:base:${swarmId}:${baseCommit}:${policyHash}`;
export const reviewItemKey = (swarmId: SwarmId, agent: string): string => `review:${swarmId}:${agent}`;
const COMMAND_SHOWN = 70;
/** A changeset in one of these states still has its base in use; a decided one (`accepted` included, which a merge follows with a new base) does not. */
const UNDECIDED_STATES = CHANGESET_STATES.filter((state) => state !== 'accepted' && !FINAL_STATES.includes(state));
const capped = (message: string): string => {
  const line = cleanLine(message);
  return line.length > MESSAGE_MAX ? `${line.slice(0, MESSAGE_MAX - 1)}…` : line;
};

/**
 * Review items in the inbox (0040 section 12). One open item per agent run: it follows the agent's newest
 * changeset, so a superseding changeset coalesces into it, and a decision resolves it. The item is a view of the
 * changeset tables, so it is rebuilt from the next event after a restart and its state is the inbox's own.
 */
export class ReviewInbox {
  /** The bases an alert was posted for, so a base that stays red does not post again, not even after the user dismissed the alert or the app restarted. */
  private readonly alerted = new Set<string>();

  constructor(
    private readonly inbox: InboxService,
    private readonly store: ChangesetStore,
    private readonly facts: ReviewSwarmFacts,
  ) {
    this.safely(() => this.rememberAlerts());
  }

  /** The alerts of every state, a dismissed one included, are the record of the bases that were posted. */
  private rememberAlerts(): void {
    for (const item of this.inbox.list({ kinds: ['alert'] })) if (item.origin === BASE_ALERT_ORIGIN && item.dedupeKey !== undefined) this.alerted.add(item.dedupeKey);
  }

  /** Listener for `ReviewManager.subscribe`. */
  onEvent = (event: ReviewEvent): void => {
    if (event.type !== 'review.changed') return;
    this.safely(() => this.watchBase(event.changesetId));
    this.safely(() => this.follow(event.changesetId));
  };

  /**
   * One alert for each swarm, base commit and policy whose check is red, and no alert for each changeset. Bases are per
   * agent, since a merge gives an agent's next changesets its own checkpoint as the base: a green base run ends the
   * alert of its own base and policy only, and the alert of a base that no undecided changeset of the swarm uses any
   * more ends too. The text is the app's own, with the command of the policy and nothing from the output of the check.
   */
  private watchBase(changesetId: string): void {
    const changeset = this.store.get(changesetId);
    if (changeset === undefined) return;
    const used = this.basesInUse(changeset.swarmId);
    const key = baseAlertKey(changeset.swarmId, changeset.baseCommit, changeset.policyHash);
    const base = this.store.baseCheck(changeset.baseCommit, changeset.policyHash);
    if (base?.outcome === 'passed') {
      this.alerted.delete(key);
      this.inbox.resolveByDedupeKey(key, 'superseded');
    } else if (base?.outcome === 'failed' && used.has(key) && !this.alerted.has(key)) {
      this.alerted.add(key);
      const command = base.command.join(' ');
      const shown = command.length > COMMAND_SHOWN ? `${command.slice(0, COMMAND_SHOWN - 1)}…` : command;
      this.item({
        kind: 'alert',
        urgency: 'high',
        origin: BASE_ALERT_ORIGIN,
        message: `The check fails on the base commit: ${shown}`,
        details: `The check fails on the base commit: ${command}. Reviews stay at rung C until the base is green: fix the base, or change check.command in the policy.`,
        payload: { swarmId: changeset.swarmId, baseCommit: changeset.baseCommit, policyHash: changeset.policyHash },
        dedupeKey: key,
        swarmId: changeset.swarmId,
      });
    }
    this.resolveUnusedBaseAlerts(changeset.swarmId, used);
  }

  /** The alert keys of the bases that the undecided changesets of the swarm stand on. */
  private basesInUse(swarmId: SwarmId): Set<string> {
    return new Set(this.store.list({ swarmId, states: UNDECIDED_STATES }).map((changeset) => baseAlertKey(swarmId, changeset.baseCommit, changeset.policyHash)));
  }

  /** The key stays in `alerted`: the same base red again later is the same alert, not a new one. */
  private resolveUnusedBaseAlerts(swarmId: SwarmId, used: ReadonlySet<string>): void {
    for (const open of this.inbox.list({ kinds: ['alert'], states: ['new', 'seen', 'snoozed'] })) {
      if (open.origin === BASE_ALERT_ORIGIN && open.dedupeKey?.startsWith(`review:base:${swarmId}:`) === true && !used.has(open.dedupeKey)) this.inbox.resolve(open.id, 'superseded');
    }
  }

  private follow(changesetId: string): void {
    const changeset = this.store.get(changesetId);
    if (changeset === undefined || this.store.latest(changeset.swarmId, changeset.agent)?.id !== changeset.id) return;
    const key = reviewItemKey(changeset.swarmId, changeset.agent);
    const last = this.store.decisions(changeset.id).at(-1);
    switch (changeset.state) {
      case 'awaiting_human':
        this.post(changeset, this.awaitingMessage(changeset, last));
        return;
      case 'queued_for_budget':
        this.post(changeset, `${changeset.agent}: waiting for review budget; rung ${changeset.rung}`);
        return;
      case 'accepted':
        this.inbox.resolveByDedupeKey(key, last?.actor === 'user' ? 'approved' : 'superseded');
        return;
      case 'rejected':
        this.inbox.resolveByDedupeKey(key, 'denied');
        return;
      case 'sent_back':
        this.inbox.resolveByDedupeKey(key, 'acted');
        return;
      default:
    }
  }

  private awaitingMessage(changeset: ChangesetRecord, last: DecisionRecord | undefined): string {
    const why = cleanLine(last?.reason ?? 'no reason given');
    if (last?.action === 'undeliverable') return `${changeset.agent}: the send-back could not reach the agent (${why})`;
    if (last?.action === 'no_new_capture') return `${changeset.agent} ended without new work after the send-back (${why}); the earlier work is shown again at rung ${changeset.rung}`;
    return this.message(changeset);
  }

  private message(changeset: ChangesetRecord): string {
    const goal = this.facts.swarm(changeset.swarmId)?.goal.split('\n')[0] ?? changeset.swarmId;
    const ids = [...new Set(this.store.reasons(changeset.id).sort((a, b) => rungIndex(b.minRung) - rungIndex(a.minRung)).map((reason) => reason.id))].slice(0, 3);
    return `${changeset.agent} in ${goal}: rung ${changeset.rung}${ids.length === 0 ? '' : `, ${ids.join(', ')}`}`;
  }

  private post(changeset: ChangesetRecord, message: string): void {
    const report = this.store.reports(changeset.id).at(-1);
    const payload: ReviewItemPayload = {
      swarmId: changeset.swarmId,
      agent: changeset.agent,
      changesetId: changeset.id,
      rung: changeset.rung,
      contentHash: changeset.contentHash,
      state: changeset.state,
      cardAccept: rungIndex(changeset.rung) <= rungIndex('C') && !(report?.findings ?? []).some((finding) => BLOCKING_SEVERITIES.includes(finding.severity)),
      hasReport: report !== undefined,
    };
    this.item({
      kind: 'review',
      urgency: changeset.floor === 'A' ? 'normal' : 'high',
      origin: REVIEW_ITEM_ORIGIN,
      message,
      linkAnchor: { changesetId: changeset.id },
      payload,
      dedupeKey: reviewItemKey(changeset.swarmId, changeset.agent),
      swarmId: changeset.swarmId,
    });
  }

  /** A capture failed: Retry and Open on the card. */
  captureFailed(swarmId: SwarmId, agent: string, error: string): void {
    this.safely(() =>
      this.item({ kind: 'failure', urgency: 'normal', origin: 'review:capture', message: `Agide could not capture the work of ${agent}: ${cleanLine(error).slice(0, 80)}`, dedupeKey: `review:capture:${swarmId}:${agent}`, swarmId }),
    );
  }

  /** The repository changed outside the agent's worktree (`repo.armed`, `repo.ref_moved`); `what` says which refs and files. */
  repositoryChanged(swarmId: SwarmId, what: string, repoDifferenceHash?: string): void {
    this.safely(() =>
      this.item({
        kind: 'alert',
        urgency: 'high',
        origin: REPO_ALERT_ORIGIN,
        message: `The repository of ${swarmId} changed outside the agents' worktrees: ${what}`,
        payload: { swarmId, ...(repoDifferenceHash === undefined ? {} : { repoDifferenceHash }) },
        dedupeKey: repositoryAlertKey(swarmId),
        swarmId,
      }),
    );
  }

  /** The base policy could not be read; the default applies. */
  policyInvalid(repoPath: string, baseCommit: string): void {
    this.safely(() =>
      this.item({ kind: 'alert', urgency: 'normal', origin: 'review:policy', message: `The review policy of ${repoPath} is not valid; the default policy applies`, dedupeKey: `review:policy:${repoPath}:${baseCommit}`, swarmId: undefined }),
    );
  }

  /** Resolves the open item of an agent run, such as a repository alert the user accepted. */
  resolve(dedupeKey: string, resolution: Resolution): void {
    this.safely(() => this.inbox.resolveByDedupeKey(dedupeKey, resolution));
  }

  private item(input: Omit<NewItem, 'folderId' | 'source' | 'textAuthor'> & { readonly swarmId: SwarmId | undefined }): void {
    const { swarmId, ...rest } = input;
    this.inbox.post({ ...rest, folderId: (swarmId === undefined ? undefined : this.facts.folderOf(swarmId)) ?? null, source: SOURCE, textAuthor: 'app', message: capped(input.message) });
  }

  /** An item that cannot be posted must not stop the review. */
  private safely(work: () => unknown): void {
    try {
      work();
    } catch (error) {
      console.warn('review: inbox item failed', error);
    }
  }
}

const REF_LIMIT = 3;

/** The armed categories and the moved refs of the repository reasons, in one line; the names come from the repository, so they are cleaned like any inbox text. */
export function describeRepoChange(reasons: readonly Pick<Reason, 'id' | 'evidence'>[]): string {
  const parts: string[] = [];
  for (const reason of reasons) {
    if (reason.id === 'repo.armed') {
      const changed = (reason.evidence as { changed?: unknown }).changed;
      if (Array.isArray(changed)) parts.push(`configuration changed (${changed.map(String).join(', ')})`);
    } else if (reason.id === 'repo.ref_moved') {
      const changes = ((reason.evidence as { changes?: unknown }).changes ?? []) as { ref?: unknown; change?: unknown }[];
      const named = changes.slice(0, REF_LIMIT).map((entry) => `${String(entry.ref)} ${String(entry.change)}`);
      parts.push(`${named.join(', ')}${changes.length > REF_LIMIT ? ' and more' : ''}`);
    } else if (reason.id === 'reviewer.user_config_changed') {
      parts.push('a user-level Claude file changed, so reviewers stay stopped until you accept');
    }
  }
  return cleanLine(parts.join('; ') || 'what changed could not be read');
}
