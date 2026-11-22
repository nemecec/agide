import type { Database } from '../../store/Store';
import { InMemoryAgentRuntime } from '../../swarm/runtime/InMemoryAgentRuntime';
import { FakeCheckExecutor, FakeMerger, FakeReviewBudget, FakeRiskRules, FakeSendBackChannel, InMemorySwarmFacts } from '../fakes/fakes';
import { InMemoryReviewerRuntime } from '../reviewer/InMemoryReviewerRuntime';
import { reportReviewInputSchema } from '../schemas';
import { sqliteHarness } from '../store/sqliteHarness';
import type { ReviewBudget, ReviewRunRequest } from '../types';
import type { InMemoryReviewManagerDeps } from './InMemoryReviewManager';
import { PersistentReviewManager } from './PersistentReviewManager';

export interface PersistentRig {
  readonly manager: PersistentReviewManager;
  readonly store: ReturnType<typeof sqliteHarness>['store'];
  readonly facts: InMemorySwarmFacts;
  readonly checks: FakeCheckExecutor;
  readonly rules: FakeRiskRules;
  readonly sendBack: FakeSendBackChannel;
  readonly merger: FakeMerger;
  readonly agents: InMemoryAgentRuntime;
  setReviewer(script: (request: ReviewRunRequest) => string): void;
  /** A clean quit: the manager cancels its runs and checks, then the runtimes end. The database stays. */
  stop(): Promise<void>;
  /** A crash: the runtimes end and the manager writes nothing. */
  crash(): Promise<void>;
}

/**
 * A persistent manager over a SQLite database the caller owns, with the fakes of `fakes/` behind it. Opening a second
 * rig on the same database is a restart: nothing but the rows carries over.
 */
export function persistentRig(db: Database, options: { readonly budget?: ReviewBudget; readonly clock?: () => string; readonly folderId?: string; readonly repo?: InMemoryReviewManagerDeps['repo'] } = {}): PersistentRig {
  const agents = new InMemoryAgentRuntime();
  const { store } = sqliteHarness(db);
  let script: (request: ReviewRunRequest) => string = () => '/text nothing';
  let manager: PersistentReviewManager | undefined;
  const reviewer = new InMemoryReviewerRuntime({
    runtime: agents,
    script: (request) => script(request),
    onReportCall: async (sessionId, input) => {
      const parsed = reportReviewInputSchema.safeParse(input);
      if (parsed.success) await manager?.reportReview(parsed.data, { kind: 'reviewer', sessionId }).catch(() => undefined);
    },
  });
  const facts = new InMemorySwarmFacts();
  const folderId = options.folderId ?? 'folder-user';
  facts.addFolder(folderId);
  facts.addSwarm('sw1', { folderId, callerSessionId: 'session-starter', defaultTarget: 'main' });
  facts.addAgent('sw1', { name: 'worker', sessionId: 'session-worker' });
  facts.addAgent('sw1', { name: 'helper', sessionId: 'session-helper' });
  const checks = new FakeCheckExecutor();
  const rules = new FakeRiskRules();
  const sendBack = new FakeSendBackChannel();
  const merger = new FakeMerger();
  manager = new PersistentReviewManager({ store, facts, rules, checks, reviewer, budget: options.budget ?? new FakeReviewBudget(10), sendBack, merger, ...(options.clock === undefined ? {} : { clock: options.clock }), ...(options.repo === undefined ? {} : { repo: options.repo }) });
  return {
    manager,
    store,
    facts,
    checks,
    rules,
    sendBack,
    merger,
    agents,
    setReviewer: (next) => {
      script = next;
    },
    crash: async () => {
      await reviewer.dispose();
      await agents.dispose();
    },
    stop: async () => {
      await manager!.shutdown();
      await reviewer.dispose();
      await agents.dispose();
    },
  };
}
