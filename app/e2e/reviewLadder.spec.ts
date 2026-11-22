import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { RendererApi } from '../src/shared/ipc';
import { connectAsSession, flag, recordedLaunches } from './sessionMcp';

// The review ladder in one app on the real module graph: a swarm with one worktree agent runs as stream-json
// processes of the fake CLI, the capture runs at its end, the rules give the reasons, the rung B reviewer runs on
// the swarm runtime and reports through report_review over MCP, the review item reaches the inbox, the user answers
// from the review pane and the inbox card, and swarm_merge refuses until the newest changeset is accepted.
const MAIN = join(import.meta.dirname, '..', 'out', 'main', 'index.js');
const FAKE = join(import.meta.dirname, 'fixtures', 'fake-claude-dispatch.mjs');
const IDENTITY = { GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test.invalid', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test.invalid' };

interface Summary {
  id: string;
  agent: string;
  seq: number;
  state: string;
  rung: string;
  contentHash: string;
}
interface Detail {
  changeset: Summary & { attempt: number };
  reasons: { id: string; minRung: string }[];
  report?: { verdict: string; findings: { title: string; line: number }[] };
}

let root: string;
let repo: string;
let app: ElectronApplication | undefined;
let client: Client | undefined;
let page: Page;

test.beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'agide-ladder-')));
  repo = join(root, 'repo');
  mkdirSync(repo);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, env: { ...process.env, ...IDENTITY }, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'README.md'), 'shop\n');
  writeFileSync(join(repo, 'price.ts'), 'export const price = (base: number): number => base;\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
});
test.afterEach(async () => {
  await client?.close();
  client = undefined;
  await app?.close();
  app = undefined;
  rmSync(root, { recursive: true, force: true });
});

async function invoke<T = unknown>(id: string, input: unknown = {}): Promise<T> {
  const result = await page.evaluate(([commandId, args]) => (globalThis as unknown as { api: RendererApi }).api.invoke(commandId as string, args), [id, input] as const);
  if (!result.ok) throw new Error(`${id}: ${result.error.message}`);
  return result.value as T;
}
async function attempt(id: string, input: unknown): Promise<{ ok: boolean; error?: { code: string; message: string; details?: unknown } }> {
  return page.evaluate(([commandId, args]) => (globalThis as unknown as { api: RendererApi }).api.invoke(commandId as string, args), [id, input] as const) as Promise<{ ok: boolean; error?: { code: string; message: string } }>;
}

function writeLayout(dataDir: string): void {
  const pane = (type: string, config: object = {}) => ({ type, version: '^1', configVersion: 1, config });
  const document = {
    schemaVersion: 1,
    revision: 1,
    id: 'ladder',
    title: 'ladder',
    instances: { tree: pane('agide/tree'), main: { ...pane('agide/surface-host', { emptyText: 'Open a session' }), bindings: { node: { context: 'node.current' } } }, inbox: pane('agide/inbox') },
    arrangement: { split: 'row', children: [{ size: 1, tabs: { panes: ['tree'], active: 'tree' } }, { size: 3, tabs: { panes: ['main', 'inbox'], active: 'main' } }] },
  };
  mkdirSync(join(dataDir, 'layouts'), { recursive: true });
  writeFileSync(join(dataDir, 'layouts', 'ladder.json'), JSON.stringify(document));
}

const report = (input: object): string => `/report ${JSON.stringify({ changesetId: '{{changesetId}}', ...input })}\n/text reported`;
const id = (testId: string) => page.getByTestId(testId);

test('a worktree agent is captured, reviewed at rung B, sent back, accepted from the card, and merged only when the newest changeset is accepted', async () => {
  test.setTimeout(120_000);
  const dataDir = join(root, 'data');
  const record = join(root, 'launches.jsonl');
  const reviewerSteps = join(root, 'reviewer-steps.txt');
  mkdirSync(join(root, 'cwd'));
  // The planted problem: the discount doubles the price.
  writeFileSync(
    reviewerSteps,
    report({ verdict: 'accept', claimCheck: 'contradicted', summary: 'The discount doubles the price.', findings: [{ path: 'discount.ts', line: 1, side: 'new', severity: 'major', title: 'The discount doubles the price', body: 'p * 2 is not a discount.' }] }),
  );
  app = await electron.launch({
    args: [MAIN],
    env: {
      ...process.env,
      AGIDE_HIDDEN: '1',
      AGIDE_USER_DATA: dataDir,
      AGIDE_CLAUDE_BIN: FAKE,
      AGIDE_SESSION_CWD: join(root, 'cwd'),
      AGIDE_TASK_BASE: join(root, 'agide'),
      FAKE_CLAUDE_STATE: join(root, 'fake-state'),
      FAKE_CLAUDE_RECORD: record,
      FAKE_CLAUDE_REVIEWER_STEPS: reviewerSteps,
      CLAUDE_CONFIG_DIR: join(root, 'claude-config'),
    },
  });
  page = await app.firstWindow();
  await expect(page.getByRole('tree', { name: 'Task tree' }), 'the window rendered').toBeVisible();
  writeLayout(dataDir);
  await page.waitForTimeout(500);
  await invoke('layout_switch', { layoutId: 'ladder' });

  const started = await invoke<{ swarmId: string }>('swarm_start', {
    definition: {
      version: 1,
      goal: 'Add a discount',
      repository: { path: repo, base: 'main' },
      budget: { usdTotal: 2 },
      agents: [{ name: 'worker', workspace: 'worktree', prompt: '/write discount.ts export const discount = (p: number): number => p * 2;\n/text added the discount' }],
    },
  });
  const swarmId = started.swarmId;
  const list = async () => (await invoke<{ changesets: Summary[] }>('review_list', { swarmId, limit: 50 })).changesets;
  const detail = (changesetId: string) => invoke<Detail>('review_get', { changesetId });
  const newest = async () => (await list())[0];

  // Capture at the agent's end, the rules, and the rung B reviewer that finds the planted problem.
  await expect.poll(async () => (await newest())?.state, { message: 'the first changeset waits for a person', timeout: 30_000 }).toBe('awaiting_human');
  const first = (await newest())!;
  const firstDetail = await detail(first.id);
  expect(firstDetail.reasons.map((reason) => reason.id), 'the rule and reviewer reasons').toEqual(expect.arrayContaining(['check.none', 'reviewer.findings', 'reviewer.claim_contradicted']));
  expect(firstDetail.report?.findings.map((finding) => [finding.title, finding.line]), 'the reviewer found the planted problem on its line').toEqual([['The discount doubles the price', 1]]);
  expect(first.rung, 'a major finding lifts the changeset to rung C').toBe('C');
  const reviewerLaunch = recordedLaunches(record).find((launch) => (flag(launch.args, '--allowedTools') ?? '').includes('report_review'));
  expect(reviewerLaunch?.args, 'the reviewer runs with read tools only').toEqual(expect.arrayContaining(['--tools', 'Read,Grep,Glob']));

  // The agent cannot report as its reviewer: its grant lists report_outcome, not report_review.
  const workerLaunch = recordedLaunches(record).find((launch) => launch.args.includes('--input-format') && (flag(launch.args, '--allowedTools') ?? '') === '');
  expect(workerLaunch, 'the worker launched on the stream-json path').toBeDefined();

  // The inbox card of the item, and the review pane it opens.
  await page.getByRole('tab', { name: 'Inbox' }).click();
  const row = id('inbox-row').first();
  await expect(row, 'the review item reached the inbox').toContainText('worker in Add a discount');
  await row.click();
  await expect(id('review-card-accept'), 'a major finding keeps Accept off the card').toHaveCount(0);
  await id('review-card-open').click();
  await expect(id('review-changeset'), 'the pane shows the changeset').toHaveAttribute('data-changeset', first.id);
  await expect(id('review-reason').first(), 'the reasons show').toBeVisible();
  await expect(page.getByTestId('review-reason').filter({ hasText: 'reviewer.findings' }), 'the finding reason shows').toHaveCount(1);
  await expect(id('review-report'), 'the reviewer summary shows').toContainText('The discount doubles the price.');

  // The merge is refused while the changeset waits.
  const refused = await attempt('swarm_merge', { swarmId, dryRun: true });
  expect(refused.error?.code, 'the gate is closed before any accept').toBe('refused');

  // Send back from the pane; the message carries the fix the fake agent writes.
  writeFileSync(reviewerSteps, report({ verdict: 'escalate', escalateTo: 'C', claimCheck: 'confirmed', summary: 'Fixed; a person should look at pricing.', findings: [] }));
  await id('review-send-back').click();
  await id('review-send-back-message').fill('Fix the discount.\n/write discount.ts export const discount = (p: number): number => p * 0.9;\n/text fixed the discount');
  await id('review-send-back-dialog-confirm').click();
  await expect(id('review-state'), 'the work is sent back').toHaveText('Sent back');
  await expect.poll(async () => (await newest())?.seq, { message: 'the agent worked again and a second changeset was captured', timeout: 30_000 }).toBe(2);
  await expect.poll(async () => (await newest())?.state, { message: 'the second changeset waits for a person', timeout: 30_000 }).toBe('awaiting_human');
  const second = (await newest())!;
  expect((await detail(second.id)).changeset.attempt, 'the send-back counts as an attempt').toBe(1);
  expect((await detail(first.id)).changeset.state, 'the first changeset is superseded').toBe('superseded');
  expect(readFileSync(join(repo, 'price.ts'), 'utf8'), 'nothing reached the main checkout yet').not.toContain('discount');

  // Accept from the inbox card.
  await page.getByRole('tab', { name: 'Inbox' }).click();
  await id('inbox-row').first().click();
  await expect(id('review-card-accept'), 'rung C without a major finding offers Accept on the card').toBeVisible();
  await id('review-card-accept').click();
  await expect.poll(async () => (await newest())?.state, { message: 'the card accepted the changeset' }).toBe('accepted');
  const preview = await invoke<{ merged: { agent: string }[] }>('swarm_merge', { swarmId, dryRun: true });
  expect(preview.merged.map((entry) => entry.agent), 'the gate opens once the newest changeset is accepted at its rung').toEqual(['worker']);

  // A content change lapses the accept: the agent changes its work while it runs, and cannot report as its reviewer.
  writeFileSync(reviewerSteps, report({ verdict: 'escalate', escalateTo: 'C', claimCheck: 'confirmed', summary: 'Rounded; a person decides.', findings: [] }));
  await invoke('swarm_send', { swarmId, agent: 'worker', message: '/write discount.ts export const discount = (p: number): number => Math.round(p * 0.9);\n/sleep 4000\n/text rounded' });
  await expect.poll(() => recordedLaunches(record).filter((launch) => launch.args.includes('--resume') && launch.args.includes('--input-format')).length, { message: 'the agent resumed' }).toBeGreaterThan(1);
  const resumed = recordedLaunches(record).filter((launch) => launch.args.includes('--resume') && launch.args.includes('--input-format')).at(-1)!;
  client = await connectAsSession(resumed);
  const tools = (await client.listTools()).tools.map((tool) => tool.name);
  expect(tools, 'the worker grant lists report_outcome').toContain('report_outcome');
  expect(tools, 'the worker grant does not list report_review').not.toContain('report_review');
  const forged = await client.callTool({ name: 'report_review', arguments: { changesetId: second.id, verdict: 'accept', claimCheck: 'confirmed', summary: 'all good', findings: [] } });
  expect(forged.isError, 'the agent cannot report as its reviewer').toBe(true);
  await expect.poll(async () => (await newest())?.seq, { message: 'the changed work was captured', timeout: 30_000 }).toBe(3);
  expect((await detail(second.id)).changeset.state, 'the accepted changeset lapsed').toBe('superseded');
  const stale = await attempt('review_accept', { changesetId: second.id, expectedHash: second.contentHash, expectedRung: second.rung, withoutReviewer: false });
  expect(stale.ok, 'the old accept does not apply to the new content').toBe(false);
  await expect.poll(async () => (await newest())?.state, { message: 'the third changeset waits for a person', timeout: 30_000 }).toBe('awaiting_human');
  const closed = await attempt('swarm_merge', { swarmId, dryRun: true });
  expect(closed.error?.code, 'the merge is refused until the newest changeset is accepted').toBe('refused');

  // Accept the newest in the pane and merge.
  const third = (await newest())!;
  await page.getByRole('tab', { name: 'Inbox' }).click();
  await id('inbox-row').first().click();
  await id('review-card-open').click();
  await expect(id('review-changeset'), 'the pane shows the newest changeset').toHaveAttribute('data-changeset', third.id);
  await id('review-accept').click();
  await expect(id('review-state'), 'accepted in the pane').toHaveText('Accepted');
  const merged = await invoke<{ target: string; merged: { agent: string; commit: string }[] }>('swarm_merge', { swarmId, dryRun: false });
  expect(merged.merged.map((entry) => entry.agent), 'the worker merged into main').toEqual(['worker']);
  const show = execFileSync('git', ['show', 'main:discount.ts'], { cwd: repo, encoding: 'utf8' });
  expect(show, 'main holds the accepted content').toContain('Math.round(p * 0.9)');
});
