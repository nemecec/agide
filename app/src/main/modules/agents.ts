import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import {
  AgentsController,
  agentSettingsSchema,
  historyOf,
  RemovalScheduler,
  repairAfterRestart,
  resolveAgentSettings,
  SqliteAgentStore,
  toView,
  withoutPaths,
  type AgentNodeView,
  type AgentRecord,
  type AgentRef,
  type AgentsService,
  type AppStartedResult,
  type HistoryFilter,
} from '../../core/agents/index';
import { archiveTranscript, pruneArchive, readTranscript, safeTranscriptPath, transcriptMetaFinished } from '../../core/agents/transcriptFiles';
import { CommandError } from '../../core/commands/index';
import type { InboxService } from '../../core/inbox/index';
import type { ProfileService } from '../../core/profile/index';
import type { LaunchContributors, SessionService } from '../../core/session/index';
import type { TreeService } from '../../core/tree/index';
import { AlertEvaluator, alertActionSession, costOf, heatLevel, rollupFolders, SqliteUsageStore, statusLineCommand, topSessionId, UsageEngine, type AlertSpec, type UsageState } from '../../core/usage/index';
import type { ModuleContext, ModuleHandle } from '../context';

const TICK_MS = 1000;
const ALERT_EVERY_MS = 10_000;
const FLUSH_TOTALS_EVERY_MS = 30_000;
const EVENT_COALESCE_MS = 250;

/** What the agents module gives other code: the contract's store and usage plus the controller for app-started agents. */
export interface AgentsRuntime extends AgentsService {
  readonly controller: AgentsController;
  /** An app-started agent asks to start; refused at the cap with an inbox alert (0027 section 5). */
  beginAppStarted(sessionId: string, folderId: string | null, details?: { description?: string }): AppStartedResult;
}

const agentRef = z.object({ sessionId: z.string().min(1), agentKey: z.string().min(1) });

/**
 * Agents and usage module. Owner: w-agents.
 * Turns session hooks into agent records (`core/agents`), counts usage from the status line snapshot and the
 * transcripts (`core/usage`), keeps the removal timers of the tree nodes, raises usage alerts to the inbox and
 * registers the `agents_*` and `usage_*` commands the panes call. The launch contributor adds the status line
 * command to every session's settings.
 */
export function init(
  ctx: ModuleContext,
  deps: { tree: TreeService; sessions: SessionService; inbox: InboxService; profile: ProfileService; launch: LaunchContributors },
): ModuleHandle<AgentsRuntime> {
  const { tree, sessions, inbox, profile } = deps;
  const settings = () => resolveAgentSettings(profile.settings().agents);
  const now = () => Date.now();
  const iso = () => new Date(now()).toISOString();
  const eventsRoot = join(ctx.dataDir, 'session-events');
  const archiveRoot = join(ctx.dataDir, 'transcripts');

  const store = new SqliteAgentStore(ctx.db, (sessionId) => {
    const session = sessions.get(sessionId);
    return session ? { projectDir: session.cwd, folderId: session.folderId } : undefined;
  });
  const usageStore = new SqliteUsageStore(ctx.db);
  const usage = new UsageEngine({ now, windowMinutes: () => settings().usage.rateWindowMinutes }, usageStore);
  for (const window of usageStore.loadPlan()) usage.restorePlan(window);

  const changedRefs = new Map<string, AgentRef>();
  let coalesce: NodeJS.Timeout | undefined;
  const scheduleEvent = (): void => {
    if (coalesce) return;
    coalesce = setTimeout(() => {
      coalesce = undefined;
      const records = [...changedRefs.values()].flatMap((ref) => {
        const record = store.get(ref);
        return record ? [withoutPaths(record)] : [];
      });
      changedRefs.clear();
      ctx.events.emit({ type: 'agents.changed', records });
    }, EVENT_COALESCE_MS);
    coalesce.unref();
  };

  const scheduler = new RemovalScheduler({
    timers: { setTimeout: (work, ms) => unrefTimer(setTimeout(work, ms)), clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout) },
    delays: () => ({ doneSeconds: settings().removeDoneAfterSeconds, failedSeconds: settings().removeFailedAfterSeconds }),
    onHidden: (ref) => {
      changedRefs.set(`${ref.sessionId}:${ref.agentKey}`, ref);
      scheduleEvent();
    },
    onShown: (ref) => {
      changedRefs.set(`${ref.sessionId}:${ref.agentKey}`, ref);
      scheduleEvent();
    },
  });

  const claudeConfigDir = (): string => {
    const config = profile.settings().claudeConfig;
    return config.mode === 'directory' ? config.path : (process.env['CLAUDE_CONFIG_DIR'] ?? join(homedir(), '.claude'));
  };
  const transcriptRoots = (): string[] => [join(claudeConfigDir(), 'projects'), archiveRoot];
  const copyPath = (ref: AgentRef): string => join(archiveRoot, ref.sessionId, `${ref.agentKey}.jsonl.gz`);

  const archive = (record: AgentRecord): void => {
    if (settings().keepTranscriptsMb === 0 || record.transcriptPath === undefined) return;
    const source = safeTranscriptPath(record.transcriptPath, transcriptRoots());
    if (source === undefined) return;
    void archiveTranscript(source, copyPath(record.ref))
      .then(() => pruneArchive(archiveRoot, settings().keepTranscriptsMb))
      .catch((error: unknown) => console.warn('agents: transcript copy failed', error));
  };

  const controller = new AgentsController({
    store,
    usage,
    now,
    eventsDirOf: (sessionId) => join(eventsRoot, sessionId),
    maxAppStarted: () => settings().maxConcurrentAppStarted,
    launchPathOf: (sessionId) => sessions.get(sessionId)?.launchPath,
    onAgentEnded: archive,
    onSessionExited: (sessionId, transcript) => {
      const totals = usage.sessionTotals(sessionId);
      if (totals) usageStore.saveTotals(sessionId, totals, iso());
      if (transcript !== undefined && settings().keepTranscriptsMb > 0) {
        const source = safeTranscriptPath(transcript, transcriptRoots());
        if (source !== undefined) void archiveTranscript(source, join(archiveRoot, sessionId, 'main.jsonl.gz')).catch(() => undefined);
      }
    },
    debug: (message) => console.debug(`agents: ${message}`),
  });

  // Rows left running by an earlier run end now; finished rows never show in the tree.
  repairAfterRestart(store, iso(), (record) => record.transcriptPath !== undefined && transcriptMetaFinished(record.transcriptPath));
  for (const record of store.list()) if (record.state === 'done' || record.state === 'failed') scheduler.seedFinished(record);
  store.flush();

  const unsubscribers = [
    store.subscribe((records) => {
      for (const record of records) {
        scheduler.observe(record);
        changedRefs.set(`${record.ref.sessionId}:${record.ref.agentKey}`, record.ref);
      }
      scheduleEvent();
    }),
    sessions.subscribe((event) => controller.handleSession(event)),
  ];

  const unregisterLaunch = deps.launch.register({
    id: 'agents',
    contribute: (context) => ({ settings: { statusLine: { type: 'command', command: statusLineCommand(context.hookDir) } } }),
  });

  const folderOfSession = (sessionId: string): string | undefined => sessions.get(sessionId)?.folderId ?? store.sessionContext(sessionId)?.folderId ?? undefined;

  const viewOf = (record: AgentRecord): AgentNodeView => {
    const price = costOfRecord(usage, record);
    return toView(record, { hidden: scheduler.isHidden(record.ref), folderId: folderOfSession(record.ref.sessionId), costUsd: price });
  };

  const labelOfSubject = (subject: { kind: 'session'; sessionId: string } | { kind: 'agent'; ref: AgentRef }): string | undefined => {
    if (subject.kind === 'session') return sessions.get(subject.sessionId)?.title;
    const record = store.get(subject.ref);
    return record ? viewOf(record).label : undefined;
  };

  const usageState = (): UsageState => {
    const config = settings();
    const thresholds = { heatFloorUsdPerMinute: config.usage.heatFloorUsdPerMinute, alertUsdPerMinute: config.usage.alertUsdPerMinute };
    const ranked = usage.rankedSubjects();
    const profileRate = usage.profileRate();
    const heat = Object.fromEntries(
      ranked.map((entry) => [
        entry.subject.kind === 'session' ? `session:${entry.subject.sessionId}` : `agent:${entry.subject.ref.sessionId}:${entry.subject.ref.agentKey}`,
        { share: entry.share, ...(entry.costUsdPerMinute === undefined ? {} : { costUsdPerMinute: entry.costUsdPerMinute }), level: heatLevel(entry.share, entry.costUsdPerMinute, thresholds) },
      ]),
    );
    const folders = rollupFolders(
      ranked,
      { folderOf: folderOfSession, parentOf: (folderId) => tree.get(folderId)?.parentId ?? undefined },
      thresholds,
    );
    return {
      windowMinutes: config.usage.rateWindowMinutes,
      ...(profileRate.costUsdPerMinute === undefined ? {} : { profileCostUsdPerMinute: profileRate.costUsdPerMinute }),
      profileWeightedTokensPerMinute: profileRate.weightedTokensPerMinute,
      ranking: ranked.slice(0, config.usage.rankingSize).map((entry) => {
        const sessionId = entry.subject.kind === 'session' ? entry.subject.sessionId : entry.subject.ref.sessionId;
        const label = labelOfSubject(entry.subject);
        const folderId = folderOfSession(sessionId);
        const started = entry.subject.kind === 'agent' ? store.get(entry.subject.ref)?.startedAt : sessions.get(sessionId)?.createdAt;
        return {
          ...entry,
          ...(label === undefined ? {} : { label }),
          ...(folderId === undefined ? {} : { folderId }),
          elapsedSeconds: started === undefined ? 0 : Math.max(0, Math.round((now() - Date.parse(started)) / 1000)),
        };
      }),
      heat,
      folders,
      plan: usage.plan(),
      appStarted: { running: controller.appStartedRunning(), cap: config.maxConcurrentAppStarted },
      now: iso(),
    };
  };

  // Alerts to the inbox (0027 section 11): raised with actions the user clicks; cleared when the condition has been gone for a window.
  const alerts = new AlertEvaluator(() => ({ alertUsdPerMinute: settings().usage.alertUsdPerMinute, planThresholds: settings().usage.planThresholds, windowMinutes: settings().usage.rateWindowMinutes }));
  const postAlert = (spec: AlertSpec): void => {
    const sessionId = spec.subject === undefined ? undefined : spec.subject.kind === 'session' ? spec.subject.sessionId : spec.subject.ref.sessionId;
    inbox.post({
      folderId: sessionId === undefined ? null : (folderOfSession(sessionId) ?? null),
      kind: 'alert',
      urgency: spec.urgency,
      source: 'app',
      origin: 'usage',
      ...(sessionId === undefined ? {} : { sessionId }),
      message: spec.message,
      details: spec.details,
      textAuthor: 'app',
      payload: { actions: spec.actions, ...(spec.subject === undefined ? {} : { subject: spec.subject }), estimate: true },
      dedupeKey: spec.dedupeKey,
    });
  };
  const evaluateAlerts = (): void => {
    const result = alerts.evaluate({ now: now(), ranked: usage.rankedSubjects(), plan: usage.plan() });
    for (const spec of result.raise) postAlert(spec);
    for (const key of result.clear) inbox.resolveByDedupeKey(key, 'superseded');
  };

  let lastPlan = '';
  let lastAlert = 0;
  let lastTotals = 0;
  const timer = setInterval(() => {
    controller.tick();
    const plan = JSON.stringify(usage.plan());
    if (plan !== lastPlan) {
      lastPlan = plan;
      ctx.events.emit({ type: 'usage.changed', plan: usage.plan() });
    }
    const at = now();
    if (at - lastAlert >= ALERT_EVERY_MS) {
      lastAlert = at;
      evaluateAlerts();
    }
    if (at - lastTotals >= FLUSH_TOTALS_EVERY_MS) {
      lastTotals = at;
      for (const session of sessions.list()) {
        const totals = usage.sessionTotals(session.id);
        if (totals) usageStore.saveTotals(session.id, totals, iso());
      }
    }
  }, TICK_MS);
  timer.unref();

  const pause = (sessionId: string): void => {
    const session = sessions.get(sessionId);
    if (!session || session.status === 'exited') throw new CommandError('not_found', `session ${sessionId} is not running`);
    // Esc interrupts the turn and keeps the session (P10); background subagents may keep running.
    sessions.write(sessionId, '\x1b');
  };

  const unregister = [
    ctx.commands.register({
      id: 'agents_list',
      title: 'List agents',
      description: 'Lists the agents of every session with their state, tokens, estimated cost and whether the tree shows them.',
      input: z.object({}),
      ui: false,
      mcp: false,
      run: () => ({
        agents: store.list().map(viewOf),
        now: iso(),
        settings: { removeDoneAfterSeconds: settings().removeDoneAfterSeconds, removeFailedAfterSeconds: settings().removeFailedAfterSeconds, maxConcurrentAppStarted: settings().maxConcurrentAppStarted },
        waitingSessions: store.waitingSessions(),
      }),
    }),
    ctx.commands.register({
      id: 'agents_history',
      title: 'List finished agents',
      description: 'Lists finished agents, newest first, filtered by state, origin, folder, end time and text.',
      input: z.object({
        states: z.array(z.enum(['done', 'failed'])).optional(),
        origin: z.enum(['session-started', 'app-started']).optional(),
        folderIds: z.array(z.string()).optional(),
        endedSince: z.string().optional(),
        text: z.string().max(200).optional(),
      }),
      ui: false,
      mcp: false,
      run: (input) => ({ agents: historyOf(store.list().map(viewOf), input as HistoryFilter) }),
    }),
    ctx.commands.register({
      id: 'agents_dismiss',
      title: 'Dismiss agent node',
      description: 'Removes a finished agent node from the tree. The record stays in the history.',
      input: agentRef,
      ui: false,
      mcp: false,
      run: (ref) => {
        scheduler.dismiss(ref);
        return { dismissed: true };
      },
    }),
    ctx.commands.register({
      id: 'agents_hold',
      title: 'Hold agent node',
      description: 'Keeps a finished agent node in the tree while it is selected or its transcript is open; release restarts its removal timer.',
      input: agentRef.extend({ held: z.boolean() }),
      ui: false,
      mcp: false,
      run: ({ held, ...ref }) => {
        if (held) scheduler.hold(ref);
        else scheduler.release(ref);
        return { held };
      },
    }),
    ctx.commands.register({
      id: 'agents_transcript',
      title: 'Read agent transcript',
      description: 'Returns the transcript of an agent as plain text entries, read-only: the original file while it exists, else the copy the app kept.',
      input: agentRef,
      ui: false,
      mcp: false,
      run: (ref) => {
        const record = store.get(ref);
        const candidates: { path: string; compressed: boolean }[] = [];
        if (record?.transcriptPath !== undefined) candidates.push({ path: record.transcriptPath, compressed: false });
        candidates.push({ path: ref.agentKey === 'session' || ref.agentKey === 'main' ? join(archiveRoot, ref.sessionId, 'main.jsonl.gz') : copyPath(ref), compressed: true });
        for (const candidate of candidates) {
          const safe = safeTranscriptPath(candidate.path, transcriptRoots());
          if (safe === undefined) continue;
          try {
            return { available: true, ...readTranscript(safe, candidate.compressed) };
          } catch {
            continue;
          }
        }
        return { available: false, summary: record?.summary ?? null, entries: [], truncated: false };
      },
    }),
    ctx.commands.register({
      id: 'agents_settings_set',
      title: 'Set agent settings',
      description: 'Changes the removal delays of finished agent nodes, the app-started cap and the usage thresholds of this profile.',
      input: agentSettingsSchema,
      ui: false,
      mcp: false,
      run: (input) => {
        const merged = { ...profile.settings().agents, ...input, ...(input.usage === undefined ? {} : { usage: { ...profile.settings().agents?.usage, ...input.usage } }) };
        profile.store.updateSettings(profile.id, { agents: merged });
        return resolveAgentSettings(merged);
      },
    }),
    ctx.commands.register({
      id: 'usage_state',
      title: 'Usage state',
      description: 'Returns the usage ranking, heat levels, folder rollups and plan usage of this profile. Every dollar figure is an estimate at list price.',
      input: z.object({}),
      ui: false,
      mcp: false,
      run: usageState,
    }),
    ctx.commands.register({
      id: 'usage_pause',
      title: 'Pause session',
      description: 'Interrupts the running turn of a session (Esc). The session stays; background subagents may keep running.',
      input: z.object({ sessionId: z.string().min(1) }),
      ui: false,
      mcp: false,
      run: ({ sessionId }) => {
        pause(sessionId);
        return { paused: true };
      },
    }),
    ctx.commands.register({
      id: 'usage_stop',
      title: 'Stop session',
      description: 'Ends the session process and keeps the session as exited, so it can be resumed.',
      input: z.object({ sessionId: z.string().min(1) }),
      ui: false,
      mcp: false,
      run: async ({ sessionId }) => {
        if (!sessions.get(sessionId)) throw new CommandError('not_found', `no session ${sessionId}`);
        await sessions.stop(sessionId);
        return { stopped: true };
      },
    }),
    ctx.commands.register({
      id: 'usage_alert_action',
      title: 'Run usage alert action',
      description: 'Runs an action offered by a usage alert item (pause or stop of its subject, pause of the top subject) and resolves the item as acted. A click by the user is the only way to run it.',
      input: z.object({ itemId: z.string().min(1), action: z.enum(['pause', 'stop', 'pause-top']) }),
      ui: false,
      mcp: false,
      run: async ({ itemId, action }) => {
        const item = inbox.get(itemId);
        if (!item || item.origin !== 'usage') throw new CommandError('not_found', `no usage alert ${itemId}`);
        const sessionId = alertActionSession(item.payload, action, topSessionId(usage.rankedSubjects()));
        if (sessionId === undefined) throw new CommandError('not_found', 'the alert names no session');
        if (action === 'stop') await sessions.stop(sessionId);
        else pause(sessionId);
        inbox.resolve(itemId, 'acted');
        return { acted: true, sessionId };
      },
    }),
  ];

  const runtime: AgentsRuntime = {
    store,
    usage,
    controller,
    beginAppStarted: (sessionId, folderId, details) => {
      const result = controller.beginAppStarted(sessionId, details);
      if (!result.ok) {
        inbox.post({
          folderId,
          kind: 'alert',
          urgency: 'low',
          source: 'app',
          origin: 'usage',
          message: `An agent start was refused: ${result.running} of ${result.cap} app-started agents run`,
          textAuthor: 'app',
          dedupeKey: `swarm:cap:${folderId ?? 'top'}`,
        });
      }
      return result;
    },
  };

  return {
    service: runtime,
    dispose: () => {
      clearInterval(timer);
      if (coalesce) clearTimeout(coalesce);
      scheduler.dispose();
      for (const off of [...unregister, ...unsubscribers, unregisterLaunch]) off();
      store.dispose();
    },
  };
}

const unrefTimer = (handle: NodeJS.Timeout): NodeJS.Timeout => {
  handle.unref();
  return handle;
};

function costOfRecord(usage: UsageEngine, record: AgentRecord): number | undefined {
  // The row of an app-started process takes the cost the CLI reported in its result over the token estimate.
  if (record.origin === 'app-started' && record.ref.agentKey === 'session') {
    const reported = usage.sessionTotals(record.ref.sessionId)?.costUsd;
    if (reported !== undefined) return reported;
  }
  const tokens = usage.agentTokensOf(record.ref) ?? record.tokens;
  const total = tokens.input + tokens.output + tokens.cacheWrite5m + tokens.cacheWrite1h + tokens.cacheRead;
  if (total === 0) return undefined;
  // The model of a subagent is not in the hook payloads; the price table matches the family of the session's model when the transcript names it.
  return costOf(usage.modelOf(record.ref), tokens);
}
