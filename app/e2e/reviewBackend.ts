import { randomBytes } from 'node:crypto';
import type { Page } from '@playwright/test';
import { REVIEW_COMMAND_INPUTS, type ReviewCommandId } from '../src/core/review/commands';
import { captureFixture, policySnapshot, type FixtureFile } from '../src/core/review/fakes/fixtures';
import { catalogueReason, FakeCheckExecutor, FakeMerger, FakeReviewBudget, FakeRiskRules, FakeSendBackChannel, InMemorySwarmFacts } from '../src/core/review/fakes/fakes';
import { InMemoryReviewManager } from '../src/core/review/manager/InMemoryReviewManager';
import { reviewPolicySchema } from '../src/core/review/policy/schema';
import { InMemoryReviewerRuntime, REPORT_REVIEW_TOOL } from '../src/core/review/reviewer/InMemoryReviewerRuntime';
import { reportReviewInputSchema, type ChangesetRecord, type FileKind } from '../src/core/review/schemas';
import { InMemoryChangesetStore } from '../src/core/review/store/InMemoryChangesetStore';
import { ReviewError, REVIEW_ITEM_ORIGIN, type ReviewManager, type ReviewRunRequest } from '../src/core/review/types';
import { SWARM_COMMAND_INPUTS } from '../src/core/swarm/commands';
import { InMemoryAgentRuntime } from '../src/core/swarm/runtime/InMemoryAgentRuntime';

/**
 * The review manager of 0041 on its in-memory services, for the tests of the review screens: the real state
 * machine, seen marks, drafts, accept and merge rules with a scripted reviewer, and no git or Claude. A test
 * submits the captures an agent would make; `attachReviewBackend` routes the `review_*` commands and `swarm_merge`
 * of one window to it and adds the review items to the inbox list.
 */
export interface ReviewBackend {
  readonly manager: ReviewManager;
  readonly swarmId: string;
  readonly checks: FakeCheckExecutor;
  readonly rules: FakeRiskRules;
  readonly sendBack: FakeSendBackChannel;
  /** The reviewer's next report, as the fields of `report_review` without the changeset id. */
  setReport(report: Record<string, unknown>): void;
  /** What the agent captures next: files with one body per hunk. Resolves once the pipeline has stopped. */
  capture(seed: string, files: readonly FixtureFile[], options?: CaptureOptions): Promise<ChangesetRecord>;
  latest(agent?: string): ChangesetRecord;
  inboxItems(): unknown[];
  close(): Promise<void>;
}

const POLICY = policySnapshot(reviewPolicySchema.parse({ version: 1, check: { command: ['pnpm', 'test'] } }), 'e2e');
const SETTLED = ['awaiting_human', 'accepted', 'sent_back', 'rejected', 'queued_for_budget', 'superseded'];

export interface CaptureOptions {
  readonly agent?: string;
  /** Reason ids of the catalogue, or an id with the subject and evidence the rules would give it. Default: `size.large`. */
  readonly reasons?: readonly (string | { readonly id: string; readonly subject?: string; readonly evidence?: Record<string, unknown> })[];
  /** The kind of a file by index, such as `binary`; such a file keeps no hunks. */
  readonly kinds?: Readonly<Record<number, FileKind>>;
}

export async function createReviewBackend(options: { readonly goal?: string; readonly agents?: readonly string[] } = {}): Promise<ReviewBackend> {
  const swarmId = 'sw1';
  const agents = new InMemoryAgentRuntime();
  const store = new InMemoryChangesetStore();
  let report: Record<string, unknown> = { verdict: 'revise', claimCheck: 'partly', summary: 'The validation misses an empty name.', findings: [] };
  let manager: InMemoryReviewManager | undefined;
  const reviewer = new InMemoryReviewerRuntime({
    runtime: agents,
    script: (request: ReviewRunRequest) => `/tool ${REPORT_REVIEW_TOOL} ${JSON.stringify({ changesetId: request.changesetId, ...report })}\n/cost 0.05\n/text reported`,
    onReportCall: async (sessionId, input) => {
      const parsed = reportReviewInputSchema.safeParse(input);
      if (parsed.success) await manager?.reportReview(parsed.data, { kind: 'reviewer', sessionId }).catch(() => undefined);
    },
  });
  const facts = new InMemorySwarmFacts();
  facts.addFolder('folder-swarm');
  facts.addSwarm(swarmId, { folderId: 'folder-swarm', goal: options.goal ?? 'Add input validation to the signup form', defaultTarget: 'main' });
  for (const name of options.agents ?? ['worker']) facts.addAgent(swarmId, { name, sessionId: `session-${name}` });
  const checks = new FakeCheckExecutor();
  const rules = new FakeRiskRules();
  const sendBack = new FakeSendBackChannel();
  store.putPolicy(POLICY);
  manager = new InMemoryReviewManager({ store, facts, rules, checks, reviewer, budget: new FakeReviewBudget(10), sendBack, merger: new FakeMerger() });
  const live = manager;

  const waitSettled = async (id: string): Promise<ChangesetRecord> => {
    const deadline = Date.now() + 5_000;
    for (;;) {
      const found = store.get(id)!;
      if (SETTLED.includes(found.state)) return found;
      if (Date.now() > deadline) throw new Error(`the changeset stayed ${found.state}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };

  return {
    manager: live,
    swarmId,
    checks,
    rules,
    sendBack,
    setReport: (next) => {
      report = next;
    },
    capture: async (seed, files, extra = {}) => {
      const agent = extra.agent ?? 'worker';
      rules.set(
        agent,
        (extra.reasons ?? ['size.large']).map((reason) => {
          const spec = typeof reason === 'string' ? { id: reason } : reason;
          return catalogueReason(spec.id as Parameters<typeof catalogueReason>[0], { ...('subject' in spec && spec.subject !== undefined ? { subject: spec.subject } : {}), ...('evidence' in spec && spec.evidence !== undefined ? { evidence: spec.evidence } : {}) });
        }),
      );
      const base = captureFixture({ seed, agent, sessionId: `session-${agent}`, policyHash: POLICY.hash, files, claim: { source: 'report_outcome', summary: `Done: ${seed}`, confidence: 'medium', testsRun: ['pnpm test'], unverified: ['browser behaviour'] } });
      const kinds = extra.kinds ?? {};
      const withKinds = {
        ...base,
        files: base.files.map((file) => (kinds[file.idx] === undefined ? file : { ...file, kind: kinds[file.idx]! })),
        hunks: base.hunks.filter((hunk) => kinds[hunk.fileIdx] === undefined),
      };
      const submitted = await live.submit(withKinds);
      return waitSettled(submitted.id);
    },
    latest: (agent = 'worker') => store.latest(swarmId, agent)!,
    inboxItems: () =>
      (options.agents ?? ['worker']).flatMap((agent) => {
        const latest = store.latest(swarmId, agent);
        if (latest === undefined || (latest.state !== 'awaiting_human' && latest.state !== 'queued_for_budget')) return [];
        const reasons = store.reasons(latest.id).map((reason) => reason.id);
        const worst = store.reports(latest.id).at(-1)?.findings.some((finding) => finding.severity === 'blocker' || finding.severity === 'major') ?? false;
        return [
          {
            id: `review-${agent}`,
            folderId: null,
            folderRemoved: false,
            kind: 'review',
            state: 'new',
            urgency: 'normal',
            source: 'app',
            origin: REVIEW_ITEM_ORIGIN,
            message: `${agent} in ${options.goal ?? 'Add input validation to the signup form'}: rung ${latest.rung}, ${reasons.slice(0, 3).join(', ')}`,
            textAuthor: 'app',
            payload: { swarmId, agent, changesetId: latest.id, rung: latest.rung, contentHash: latest.contentHash, state: latest.state, cardAccept: !worst && ['A', 'B', 'C'].includes(latest.rung), hasReport: store.reports(latest.id).length > 0 },
            linkAnchor: { changesetId: latest.id },
            occurrences: 1,
            createdAt: latest.createdAt,
            updatedAt: latest.updatedAt,
          },
        ];
      }),
    close: async () => {
      await live.shutdown();
      await reviewer.dispose();
      await agents.dispose();
    },
  };
}

/** What `window.api.invoke` answers for a command, as `CommandResult`. */
async function answer(backend: ReviewBackend, id: string, input: unknown): Promise<unknown> {
  const { manager } = backend;
  const ui = { kind: 'ui' } as const;
  try {
    if (id === 'swarm_merge') {
      const { target, ...rest } = SWARM_COMMAND_INPUTS.swarm_merge.parse(input);
      return { ok: true, value: await manager.merge({ ...rest, ...(target === undefined ? {} : { target }) }, ui) };
    }
    const schema = REVIEW_COMMAND_INPUTS[id as ReviewCommandId];
    const parsed = schema.parse(input) as never;
    const value = await {
      // The result shapes of main/modules/review.ts, which the window receives from the real module.
      review_list: () => ({ changesets: manager.list(parsed, ui) }),
      review_get: () => manager.get(parsed, ui),
      review_accept: async () => ({ changeset: await manager.accept(parsed, ui) }),
      review_reject: async () => ({ changeset: await manager.reject(parsed, ui) }),
      review_send_back: async () => ({ changeset: await manager.sendBack(parsed, ui) }),
      review_comment: () => manager.comment(parsed, ui),
      review_escalate: async () => ({ changeset: await manager.escalate(parsed, ui) }),
      review_demote: () => manager.demote(parsed, ui),
      review_seen: () => manager.seen(parsed, ui),
    }[id as 'review_list']();
    return { ok: true, value };
  } catch (error) {
    if (error instanceof ReviewError) return { ok: false, error: { code: error.code, message: error.message, ...(error.details === undefined ? {} : { details: error.details }) } };
    return { ok: false, error: { code: 'failed', message: error instanceof Error ? error.message : String(error) } };
  }
}

/**
 * Sets the `__agideApi` seam of the page (see `renderer/api.ts`) to a wrapper of `window.api`: the `review_*` commands and `swarm_merge` go to the backend,
 * `inbox_list` gets the review items added, and every other command and event passes through. Review events and
 * the inbox change reach the window's subscribers.
 */
export async function attachReviewBackend(page: Page, backend: ReviewBackend): Promise<void> {
  const id = randomBytes(4).toString('hex');
  await page.exposeFunction(`__agideReview${id}`, (command: string, input: unknown) => answer(backend, command, input));
  await page.exposeFunction(`__agideInbox${id}`, () => backend.inboxItems());
  await page.evaluate((suffix: string) => {
    const scope = globalThis as unknown as Record<string, any>;
    const original = scope['api'];
    const listeners = new Set<(event: unknown) => void>();
    const review = (command: string, input: unknown): Promise<unknown> => scope[`__agideReview${suffix}`](command, input);
    const wrapped = {
      invoke: async (command: string, input?: unknown) => {
        if (command.startsWith('review_') || command === 'swarm_merge') return review(command, input);
        const result = await original.invoke(command, input);
        if (command !== 'inbox_list' || !result.ok) return result;
        const extra = (await scope[`__agideInbox${suffix}`]()) as unknown[];
        const wanted: string[] = (input as { states?: string[] } | undefined)?.states ?? [];
        if (!wanted.includes('new')) return result;
        return { ok: true, value: { ...result.value, items: [...extra, ...result.value.items], unread: result.value.unread + extra.length } };
      },
      listCommands: () => original.listCommands(),
      subscribe: (listener: (event: unknown) => void) => {
        listeners.add(listener);
        const off = original.subscribe(listener);
        return () => {
          listeners.delete(listener);
          off();
        };
      },
    };
    scope['__agideApi'] = wrapped;
    scope['__agideEmit'] = (event: unknown) => listeners.forEach((listener) => listener(event));
  }, id);
  backend.manager.subscribe((event) => {
    const emit = (payload: unknown): void => void page.evaluate((value) => (globalThis as unknown as { __agideEmit(event: unknown): void }).__agideEmit(value), payload).catch(() => undefined);
    emit(event);
    if (event.type === 'review.changed') emit({ type: 'inbox.item_changed', item: { id: 'review', kind: 'review' }, change: 'updated' });
  });
}
