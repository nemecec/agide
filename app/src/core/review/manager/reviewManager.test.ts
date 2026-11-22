import { InMemoryAgentRuntime } from '../../swarm/runtime/InMemoryAgentRuntime';
import { FakeCheckExecutor, FakeMerger, FakeReviewBudget, FakeRiskRules, FakeSendBackChannel, InMemorySwarmFacts } from '../fakes/fakes';
import { InMemoryReviewerRuntime } from '../reviewer/InMemoryReviewerRuntime';
import { reportReviewInputSchema } from '../schemas';
import { InMemoryChangesetStore } from '../store/InMemoryChangesetStore';
import { sqliteHarness } from '../store/sqliteHarness';
import type { ChangesetStore, ReviewRunRequest } from '../types';
import { InMemoryReviewManager, type InMemoryReviewManagerDeps } from './InMemoryReviewManager';
import { PersistentReviewManager } from './PersistentReviewManager';
import { describeReviewDecisionContract } from './reviewDecisionContract';
import { describeReviewManagerContract, type ReviewManagerHarness } from './reviewManagerContract';

async function build(create: (store: ChangesetStore, deps: Omit<InMemoryReviewManagerDeps, 'store'>) => InMemoryReviewManager, makeStore: () => { store: ChangesetStore; close(): void }): Promise<ReviewManagerHarness> {
  const agents = new InMemoryAgentRuntime();
  const { store, close: closeStore } = makeStore();
  let script: (request: ReviewRunRequest) => string = () => '/text nothing';
  let manager: InMemoryReviewManager | undefined;
  const reviewer = new InMemoryReviewerRuntime({
    runtime: agents,
    script: (request) => script(request),
    onReportCall: async (sessionId, input) => {
      const parsed = reportReviewInputSchema.safeParse(input);
      if (parsed.success) await manager?.reportReview(parsed.data, { kind: 'reviewer', sessionId }).catch(() => undefined);
    },
  });
  const facts = new InMemorySwarmFacts();
  const checks = new FakeCheckExecutor();
  const rules = new FakeRiskRules();
  const budget = new FakeReviewBudget(10);
  const sendBack = new FakeSendBackChannel();
  const merger = new FakeMerger();
  manager = create(store, { facts, rules, checks, reviewer, budget, sendBack, merger });
  return {
    manager,
    facts,
    checks,
    rules,
    budget,
    sendBack,
    merger,
    agents,
    setReviewer: (next) => {
      script = next;
    },
    putPolicy: (snapshot) => store.putPolicy(snapshot),
    close: async () => {
      await reviewer.dispose();
      await agents.dispose();
      closeStore();
    },
  };
}

const inMemory = () => build((store, deps) => new InMemoryReviewManager({ store, ...deps }), () => ({ store: new InMemoryChangesetStore(), close: () => undefined }));
const persistent = () =>
  build(
    (store, deps) => new PersistentReviewManager({ store, ...deps }),
    () => {
      const { store, close } = sqliteHarness();
      return { store, close };
    },
  );

describeReviewManagerContract('in-memory review manager', inMemory);

// The persistent manager over the SQLite store: the same behaviour, with the rows as the only memory.
describeReviewManagerContract('persistent review manager', persistent);

describeReviewDecisionContract('in-memory review manager', inMemory);
describeReviewDecisionContract('persistent review manager', persistent);
