import { rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CommandError, type Caller } from '../../core/commands/index';
import type { InboxService } from '../../core/inbox/index';
import type { AppMcpServer } from '../../core/mcp/index';
import { DEFAULT_PROFILE_ID, profilePaths, type ProfileService } from '../../core/profile/index';
import { checkCacheDirectory, GitCaptureService, ProcessCheckExecutor, resolveCheckEnvironment, SqliteCaptureState, userConfigPaths, type CheckEnvironment } from '../../core/review/capture/index';
import { repoDifferenceHash } from '../../core/review/capture/GitCaptureService';
import { permissionSettingsOf } from '../../core/permissions/index';
import { readIsolationOptions } from '../../core/isolation/providerOptions';
import { atEveryLocalMidnight, dailyLimitUsd, localDay } from '../../core/review/budgetDay';
import { reviewCallerOf } from '../../core/review/reviewCaller';
import { GitPolicyLoader } from '../../core/review/policy/index';
import { DefaultRiskRules } from '../../core/review/rules/index';
import { GitReviewerCheckouts, StreamReviewerRuntime } from '../../core/review/reviewer/index';
import { reportReviewInputSchema } from '../../core/review/schemas';
import {
  registerReviewCommands,
  resolveReviewSettings,
  ReviewError,
  type CaptureResult,
  type CaptureService,
  type ChangesetStore,
  type CheckExecutor,
  type ReviewCaller,
  type ReviewCommandHandlers,
  type ReviewerRuntime,
  type ReviewSwarmFacts,
  type RiskRules,
} from '../../core/review/index';
import { detailForCaller } from '../../core/review/manager/callerView';
import { GitMerger } from '../../core/review/manager/GitMerger';
import { PersistentReviewManager } from '../../core/review/manager/PersistentReviewManager';
import { SwitchableChecks, SwitchableReviewer, SwitchableRules } from '../../core/review/manager/pipelineSlots';
import { describeRepoChange, repositoryAlertKey, ReviewInbox } from '../../core/review/manager/ReviewInbox';
import { SqliteReviewBudget } from '../../core/review/manager/SqliteReviewBudget';
import { SwarmReviewFacts, SwarmSendBack } from '../../core/review/manager/SwarmReviewFacts';
import { SqliteChangesetStore } from '../../core/review/store/SqliteChangesetStore';
import { profileLaunchSpec, type SessionService } from '../../core/session/index';
import type { Reason } from '../../core/review/schemas';
import { ENDED_RUN_STATES, resolveSwarmSettings, SwarmError, type SwarmCaller, type SwarmId } from '../../core/swarm/index';
import { Git } from '../../core/swarm/workspace/git';
import { taskBaseDir } from '../../core/tasks/index';
import { TreeFolders } from '../../core/swarm/manager/TreeFolders';
import type { TreeService } from '../../core/tree/index';
import type { ModuleContext, ModuleHandle } from '../context';
import type { SwarmModuleService } from './swarm';

/** The services of the capture and reviewer builders, connected by the integration step. */
export interface ReviewServices {
  readonly capture?: CaptureService;
  readonly rules?: RiskRules;
  readonly checks?: CheckExecutor;
  readonly reviewer?: ReviewerRuntime;
}

export interface ReviewModuleService {
  readonly manager: PersistentReviewManager;
  readonly store: ChangesetStore;
  readonly facts: ReviewSwarmFacts;
  readonly inbox: ReviewInbox;
  /** Connects the capture, rules, check and reviewer services; each is used from the next call on. */
  connect(services: ReviewServices): void;
  /** Stores the captures of `CaptureService` and posts the alerts of the ones that failed. */
  ingest(results: readonly CaptureResult[]): Promise<void>;
}

const UI: SwarmCaller = { kind: 'ui' };

/**
 * Review module (0040, 0041). Initialized after `swarm`: it reads the swarm manager for callers, captures and the
 * merge gate and posts inbox items. It builds the SQLite store, the persistent manager and the budget over the
 * swarm's ledger numbers, registers the `review_*` commands and the review handler of `swarm_merge`, and
 * picks up the work an earlier run left open. The capture, rules, check and reviewer services are connected by
 * `connect`; until then a changeset waits for a person and a reviewer run ends with `spawn`.
 */
export function init(
  ctx: ModuleContext,
  deps: {
    tree: TreeService;
    sessions: SessionService;
    profile: ProfileService;
    inbox: InboxService;
    mcp: AppMcpServer;
    swarm: SwarmModuleService;
  },
  options: { readonly connectPipeline?: boolean } = {},
): ModuleHandle<ReviewModuleService> {
  const { profile, swarm } = deps;
  const settings = () => resolveReviewSettings(profile.settings().review);
  const store = new SqliteChangesetStore(ctx.db);
  const folders = new TreeFolders(deps.tree);
  const facts = new SwarmReviewFacts(swarm.manager, { isWithin: (folderId, scope) => folders.isWithin(folderId, scope) });
  const rules = new SwitchableRules();
  const checks = new SwitchableChecks();
  const reviewer = new SwitchableReviewer();

  const budget = new SqliteReviewBudget({
    db: ctx.db,
    potUsd: (swarmId) => {
      try {
        return swarm.manager.status(swarmId, UI).budget.reviewUsd;
      } catch (error) {
        if (error instanceof SwarmError) return 0;
        throw error;
      }
    },
    dailyUsd: (swarmId) => {
      const policyHash = store.list({ swarmId, limit: 1 })[0]?.policyHash;
      const lowered = policyHash === undefined ? undefined : store.policy(policyHash)?.effective.reviewer.dailyBudgetUsd;
      return dailyLimitUsd(settings().dailyBudgetUsd, lowered);
    },
    dayOf: localDay,
  });

  // The repository snapshot of the capture service, once it is connected; until then nothing is compared.
  let connectedCapture: CaptureService | undefined;
  const repo = {
    compareRepo: async (swarmId: SwarmId) => (connectedCapture === undefined ? [] : connectedCapture.compareRepo(swarmId)),
    refreshRef: async (swarmId: SwarmId, ref: string, expectedOld: string, newTip: string) => (connectedCapture === undefined ? false : connectedCapture.refreshRef(swarmId, ref, expectedOld, newTip)),
  };
  const manager = new PersistentReviewManager({ store, facts, rules, checks, reviewer, budget, sendBack: new SwarmSendBack(swarm.manager), merger: new GitMerger(() => process.env), repo, repositoryStopped: (swarmId) => void repositoryAlert(swarmId) });
  const inbox = new ReviewInbox(deps.inbox, store, facts);
  const cleanups: (() => void)[] = [manager.subscribe(inbox.onEvent), manager.subscribe((event) => ctx.events.emit(event))];

  // A run that ends frees budget, so queued reviews get their turn at once; a new day does the same.
  const settled = new Set(['accepted', 'awaiting_human', 'sent_back']);
  cleanups.push(
    manager.subscribe((event) => {
      if (event.type === 'review.changed' && settled.has(event.state)) void manager.releaseQueued().catch((error: unknown) => console.warn('review: queued reviews', error));
    }),
  );
  let stopMidnight: (() => void) | undefined;

  const capturing = new Map<string, Promise<void>>();
  const callerOf = (caller: Caller): ReviewCaller => reviewCallerOf(caller, (sessionId) => store.runBySession(sessionId)?.state === 'running');
  const handlers: ReviewCommandHandlers = {
    report_review: (input, caller) => manager.reportReview(input, callerOf(caller)),
    report_outcome: (input, caller) => manager.reportOutcome(input, callerOf(caller)),
    review_list: (input, caller) => ({ changesets: manager.list(input, callerOf(caller)) }),
    review_get: (input, caller) => detailForCaller(manager.get(input, callerOf(caller)), callerOf(caller)),
    review_accept: async (input, caller) => ({ changeset: await manager.accept(input, callerOf(caller)) }),
    review_reject: async (input, caller) => ({ changeset: await manager.reject(input, callerOf(caller)) }),
    review_send_back: async (input, caller) => ({ changeset: await manager.sendBack(input, callerOf(caller)) }),
    review_comment: (input, caller) => manager.comment(input, callerOf(caller)),
    review_escalate: async (input, caller) => ({ changeset: await manager.escalate(input, callerOf(caller)) }),
    review_request_escalation: async (input, caller) => ({ changeset: await manager.requestEscalation(input, callerOf(caller)) }),
    review_demote: (input, caller) => manager.demote(input, callerOf(caller)),
    review_seen: (input, caller) => manager.seen(input, callerOf(caller)),
    review_accept_repo_change: async (input, caller) => {
      if (caller.kind !== 'ui') throw new ReviewError('out_of_scope', 'agents never accept a repository change');
      if (connectedCapture === undefined) throw new ReviewError('failed', 'the review capture is not connected');
      try {
        await connectedCapture.acceptRepoChange(input.swarmId, input.expectedHash);
      } catch (error) {
        if (error instanceof ReviewError && error.code === 'refused') {
          const now = await repositoryAlert(input.swarmId);
          throw new ReviewError('refused', `the repository changed again since the alert: ${now}; the alert shows the new change`);
        }
        throw error;
      }
      inbox.resolve(repositoryAlertKey(input.swarmId), 'approved');
      return { accepted: true };
    },
  };
  cleanups.push(...registerReviewCommands(ctx.commands, handlers));
  cleanups.push(
    swarm.setMergeHandler(async (input, caller) => {
      try {
        return await manager.merge({ swarmId: input.swarmId, ...(input.target === undefined ? {} : { target: input.target }), exclude: input.exclude, dryRun: input.dryRun }, callerOf(caller));
      } catch (error) {
        if (error instanceof ReviewError) throw new CommandError(error.code, error.message, error.details);
        throw error;
      }
    }),
  );

  // The alert carries the hash of the change it shows, so the accept applies to that change only.
  const repositoryAlert = async (swarmId: SwarmId, reason?: Pick<Reason, 'id'>): Promise<string> => {
    let difference: string | undefined;
    let what = reason?.id === 'repo.ref_moved' ? 'a branch' : 'its configuration, hooks or attributes';
    try {
      const reasons = connectedCapture === undefined ? [] : await connectedCapture.compareRepo(swarmId);
      difference = repoDifferenceHash(reasons);
      what = describeRepoChange(reasons);
    } catch (error) {
      console.warn('review: repository comparison', error);
    }
    inbox.repositoryChanged(swarmId, what, difference);
    return what;
  };
  const isRepoReason = (reason: Reason): boolean => reason.id === 'repo.armed' || reason.id === 'repo.ref_moved';
  const alert = async (swarmId: SwarmId, result: Extract<CaptureResult, { kind: 'failed' }>): Promise<void> => {
    const repo = result.reasons?.find(isRepoReason);
    if (repo !== undefined) await repositoryAlert(swarmId, repo);
    else inbox.captureFailed(swarmId, result.subject.agent, result.error);
  };
  // Recovery and the queued-review timer wait for the pipeline: run before it, they would spend reviewer attempts on
  // the unconnected slots.
  let recovered = false;
  const service: ReviewModuleService = {
    manager,
    store,
    facts,
    inbox,
    connect: (services) => {
      if (services.rules !== undefined) rules.connect(services.rules);
      if (services.checks !== undefined) checks.connect(services.checks);
      if (services.reviewer !== undefined) reviewer.connect(services.reviewer);
      if (services.capture !== undefined) {
        const connected = services.capture;
        connectedCapture = connected;
        void connected
          .resumePending()
          .then((results) => service.ingest(results))
          .catch((error: unknown) => console.warn('review: pending captures', error));
      }
      if (!recovered && rules.connected && checks.connected && reviewer.connected) {
        recovered = true;
        stopMidnight = atEveryLocalMidnight(() => void manager.releaseQueued().catch((error: unknown) => console.warn('review: queued reviews', error)));
        void manager.recover().catch((error: unknown) => console.warn('review: recovery', error));
      }
    },
    ingest: async (results) => {
      for (const result of results) {
        if (result.kind === 'captured') {
          await manager.submit(result.changeset);
          const open = result.changeset.reasons.find((reason) => isRepoReason(reason) && (reason.evidence as { accepted?: unknown }).accepted !== true);
          if (open !== undefined) await repositoryAlert(result.changeset.subject.swarmId, open);
        } else if (result.kind === 'failed') {
          await alert(result.subject.swarmId, result);
          await manager.noNewCapture(result.subject.swarmId, result.subject.agent, `the capture after the send-back failed: ${result.error}`);
        }
      }
    },
  };

  if (options.connectPipeline !== false) service.connect(pipelineServices(ctx, deps, { store, facts, manager, settings }));
  cleanups.push(
    swarm.setBeforeFirstLaunch(async (swarmId) => {
      if (connectedCapture === undefined) return;
      try {
        return (await connectedCapture.prepare(swarmId)).policy.warnings;
      } catch (error) {
        inbox.captureFailed(swarmId, 'review', error instanceof Error ? error.message : String(error));
        throw error;
      }
    }),
    // Capture runs when a worktree agent's run ends: its turn is over and its worktree holds the work (0040 section 4.1).
    swarm.manager.subscribe((event) => {
      if (event.type === 'swarm.removed') {
        void rm(checkCacheDirectory(ctx.dataDir, event.swarmId), { recursive: true, force: true }).catch((error: unknown) => console.warn('review: check cache', error));
        return;
      }
      if (event.type !== 'swarm.agent_changed' || !ENDED_RUN_STATES.includes(event.state) || connectedCapture === undefined) return;
      const agent = facts.swarm(event.swarmId)?.agents.find((candidate) => candidate.name === event.agent);
      if (agent?.workspace !== 'worktree') return;
      const capture = connectedCapture;
      const key = `${event.swarmId}/${event.agent}`;
      const previous = capturing.get(key) ?? Promise.resolve();
      const next = previous
        .then(() => capture.capture({ kind: 'swarm-agent', swarmId: event.swarmId, agent: event.agent }, 'agent-ended'))
        .then(async (result) => {
          await service.ingest([result]);
          if (result.kind === 'no-change') await manager.noNewCapture(event.swarmId, event.agent, 'the agent ended without changing its work tree');
        })
        .catch((error: unknown) => console.warn('review: capture', error));
      capturing.set(key, next);
    }),
  );
  return {
    service,
    dispose: async () => {
      stopMidnight?.();
      await Promise.allSettled([...capturing.values()]);
      await manager.shutdown();
      await reviewer.dispose();
      for (const off of cleanups) off();
    },
  };
}

/**
 * The capture, rules, check and reviewer services of the app: the capture and the policy read git objects of the
 * swarm's repository, the check runs through the profile's provider, and reviewers run on the swarm's runtime in a
 * read-only checkout outside the profile data directory, reporting through `report_review`.
 */
function pipelineServices(
  ctx: ModuleContext,
  deps: { readonly profile: ProfileService; readonly swarm: SwarmModuleService },
  parts: { readonly store: ChangesetStore; readonly facts: ReviewSwarmFacts; readonly manager: PersistentReviewManager; readonly settings: () => ReturnType<typeof resolveReviewSettings> },
): Required<ReviewServices> {
  const { profile, swarm } = deps;
  const appRoot = ctx.profile?.root ?? ctx.dataDir;
  const paths = profilePaths(appRoot, profile.id);
  const launch = () => profileLaunchSpec(profile.settings(), paths, process.env);
  const claudeDir = () => launch().claudeConfigDir ?? join(homedir(), '.claude');
  const capture = new GitCaptureService({
    facts: parts.facts,
    store: parts.store,
    loader: new GitPolicyLoader(),
    state: new SqliteCaptureState(ctx.db),
    dataDir: ctx.dataDir,
    overlay: () => parts.settings().policy,
    userConfigPaths: () => userConfigPaths(claudeDir()),
  });
  const environment = async (): Promise<CheckEnvironment> => {
    const settings = profile.settings();
    const options = readIsolationOptions(settings.isolation.options);
    return resolveCheckEnvironment({
      provider: settings.isolation.provider,
      bashSandbox: permissionSettingsOf(settings, { isDefaultProfile: profile.id === DEFAULT_PROFILE_ID }).network.bashSandbox,
      profileEnv: Object.fromEntries(Object.entries(launch().env).filter((entry): entry is [string, string] => entry[1] !== undefined)),
      srt: { binary: options.srtBinary ?? process.env['AGIDE_SRT_BIN'] ?? 'srt', settingsDir: join(ctx.dataDir, 'isolation', 'srt-checks'), extraDenyRead: options.extraDenyRead },
    });
  };
  const checks = new ProcessCheckExecutor({
    environment,
    checkoutRoot: (swarmId, runId) => join(taskBaseDir(), 'review-checks', swarmId, runId),
    dataDir: ctx.dataDir,
    cacheDirectory: (swarmId) => checkCacheDirectory(ctx.dataDir, swarmId),
    store: parts.store,
    maxConcurrent: () => parts.settings().maxConcurrentChecks,
  });
  const reviewer = new StreamReviewerRuntime({
    runtime: swarm.runtime,
    tiers: () => resolveSwarmSettings(profile.settings().swarm).tiers,
    checkouts: new GitReviewerCheckouts(new Git(undefined, () => launch().env), join(taskBaseDir(), 'review-runs')),
    // The in-memory runtime has no MCP server: its report step stands in for the tool call.
    requireReportToolListed: !swarm.fakeRuntime,
    ...(swarm.fakeRuntime
      ? {
          onReportCall: async (sessionId: string, input: Record<string, unknown>) => {
            const parsed = reportReviewInputSchema.safeParse(input);
            if (parsed.success) await parts.manager.reportReview(parsed.data, { kind: 'reviewer', sessionId }).catch(() => undefined);
          },
        }
      : {}),
  });
  return { capture, rules: new DefaultRiskRules(), checks, reviewer };
}
