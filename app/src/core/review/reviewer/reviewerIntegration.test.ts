import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CommandRegistry } from '../../commands/CommandRegistry';
import { HttpAppMcpServer } from '../../mcp/HttpAppMcpServer';
import { Git } from '../../swarm/workspace/git';
import { streamHarness, type StreamHarness } from '../../swarm/fixtures/streamHarness';
import { registerReviewCommands } from '../commands';
import { FakeReviewBudget, InMemorySwarmFacts } from '../fakes/fakes';
import { captureFixture, changesetRecord, policySnapshot } from '../fakes/fixtures';
import type { ReviewRunRecord } from '../schemas';
import { InMemoryChangesetStore } from '../store/InMemoryChangesetStore';
import type { ReviewerEvent } from '../types';
import { GitReviewerCheckouts } from './checkout';
import { reportHandlers, ReportDesk } from './reportDesk';
import { ReviewRunDriver, type ReviewRunTemplate } from './ReviewRunDriver';
import { StreamReviewerRuntime } from './StreamReviewerRuntime';
import { runRequest } from './reviewerRuntimeContract';

const POLICY = policySnapshot();
const FOLDER = 'folder-1';
const IDENTITY = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' };

let dir: string;
let store: InMemoryChangesetStore;
let facts: InMemorySwarmFacts;
let registry: CommandRegistry;
let server: HttpAppMcpServer;
let ids: { a: string; b: string };
const clients: Client[] = [];

const runRow = (id: string, changesetId: string, sessionId: string, attempt: 1 | 2 = 1): ReviewRunRecord => ({
  id,
  changesetId,
  attempt,
  sessionId,
  model: 'haiku',
  effort: 'low',
  promptVersion: 'v',
  state: 'running',
  failure: null,
  pid: 1,
  reservedUsd: 0.5,
  reportedUsd: 0,
  rejectedCalls: 0,
  queuedAt: '2026-11-21T10:00:00.000Z',
  startedAt: '2026-11-21T10:00:01.000Z',
  endedAt: null,
});

async function connect(sessionId: string, toolSet: 'default' | 'worker' | 'reviewer'): Promise<Client> {
  const grant = server.grant(sessionId, FOLDER, { toolSet });
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(grant.url), { requestInit: { headers: { Authorization: `Bearer ${grant.token}` } } }));
  clients.push(client);
  return client;
}

const textOf = (result: unknown): string => ((result as { content?: { type: string; text?: string }[] }).content ?? []).find((item) => item.type === 'text')?.text ?? '';
const finding = { path: 'src/a.ts', line: 2, severity: 'major', title: 'bug', body: '' };
const reportArgs = (changesetId: string) => ({ changesetId, verdict: 'revise', claimCheck: 'partly', summary: 'a bug', findings: [finding] });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'reviewer-integration-'));
  store = new InMemoryChangesetStore();
  store.putPolicy(POLICY);
  facts = new InMemorySwarmFacts();
  facts.addSwarm('sw1', { folderId: FOLDER });
  facts.addAgent('sw1', { name: 'worker', sessionId: 'worker-session' });
  const created: string[] = [];
  for (const agent of ['alpha', 'beta']) {
    const capture = captureFixture({ seed: agent, agent, policyHash: POLICY.hash });
    const { changeset, files, hunks } = changesetRecord(capture);
    store.insert(changeset, files, hunks);
    created.push(capture.id);
  }
  ids = { a: created[0]!, b: created[1]! };
  store.putRun(runRow('run_a', ids.a, 'reviewer-a'));
  store.putRun(runRow('run_b', ids.b, 'reviewer-b'));
  const desk = new ReportDesk({ store, facts });
  registry = new CommandRegistry();
  registerReviewCommands(registry, reportHandlers(desk));
  server = new HttpAppMcpServer(registry);
});
afterEach(async () => {
  await Promise.allSettled(clients.splice(0).map((client) => client.close()));
  await server.stop();
  rmSync(dir, { recursive: true, force: true });
});

describe('report tools over the app MCP server', () => {
  beforeEach(async () => {
    await server.start();
  });

  it('lists report_review for a reviewer grant and nothing else of the review tools', async () => {
    const client = await connect('reviewer-a', 'reviewer');
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names, 'the reviewer set is one tool').toEqual(['report_review']);
  });

  it('lists report_outcome for a worker grant, and neither report tool for a default grant', async () => {
    const worker = (await (await connect('worker-session', 'worker')).listTools()).tools.map((tool) => tool.name);
    expect(worker, 'a worker lists report_outcome and not report_review').toContain('report_outcome');
    expect(worker, 'a worker never lists report_review').not.toContain('report_review');
    const plain = (await (await connect('plain-session', 'default')).listTools()).tools.map((tool) => tool.name);
    expect(plain.filter((name) => name.startsWith('report_')), 'a default session lists no report tool').toEqual([]);
  });

  it('answers not_found when a worker session calls report_review', async () => {
    const client = await connect('worker-session', 'worker');
    const result = await client.callTool({ name: 'report_review', arguments: reportArgs(ids.a) });
    expect([result.isError, textOf(result)], 'the call is an error that names an unknown tool').toEqual([true, expect.stringMatching(/^not_found/)]);
    expect(store.reports(ids.a), 'nothing stored').toEqual([]);
  });

  it('answers out_of_scope when a reviewer reports for the changeset of another run', async () => {
    const client = await connect('reviewer-a', 'reviewer');
    const result = await client.callTool({ name: 'report_review', arguments: reportArgs(ids.b) });
    expect([result.isError, textOf(result)], 'a reviewer cannot report for another changeset').toEqual([true, expect.stringMatching(/^out_of_scope/)]);
    expect(store.reports(ids.b), 'the other changeset has no report').toEqual([]);
  });

  it('refuses a call that carries the token of another session', async () => {
    const mine = server.grant('reviewer-a', FOLDER, { toolSet: 'reviewer' });
    const theirs = server.grant('reviewer-b', FOLDER, { toolSet: 'reviewer' });
    const call = (url: string, token: string) =>
      fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'report_review', arguments: reportArgs(ids.b) } }),
      });
    expect((await call(theirs.url, mine.token)).status, 'the token of session a on the url of session b').toBe(401);
    expect(store.reports(ids.b), 'nothing stored for the other changeset').toEqual([]);
  });

  it('stores a valid report from the reviewer of the changeset and refuses a second call', async () => {
    const client = await connect('reviewer-a', 'reviewer');
    const first = await client.callTool({ name: 'report_review', arguments: reportArgs(ids.a) });
    expect([first.isError ?? false, JSON.parse(textOf(first))], 'stored with one finding').toEqual([false, { stored: true, findings: 1 }]);
    const second = await client.callTool({ name: 'report_review', arguments: reportArgs(ids.a) });
    expect([second.isError, textOf(second)], 'a report is final once stored').toEqual([true, expect.stringMatching(/^refused/)]);
  });

  it('gives the reviewer the anchoring problem as a tool error it can correct', async () => {
    const client = await connect('reviewer-a', 'reviewer');
    const result = await client.callTool({ name: 'report_review', arguments: { ...reportArgs(ids.a), findings: [{ ...finding, line: 500 }] } });
    expect([result.isError, textOf(result)], 'the unanchored finding is named').toEqual([true, expect.stringContaining('src/a.ts:500')]);
  });
});

describe('reviewer run with the fake CLI', () => {
  let harness: StreamHarness;
  let repo: string;
  let checkpoint: string;
  let configPath: string;
  let ended: ReviewerEvent[];
  let target: string;

  beforeEach(async () => {
    await server.start();
    const capture = captureFixture({ seed: 'gamma', agent: 'gamma', policyHash: POLICY.hash });
    const { changeset, files, hunks } = changesetRecord(capture);
    store.insert(changeset, files, hunks);
    target = capture.id;
    repo = join(dir, 'repo');
    execFileSync('git', ['init', '-q', '-b', 'main', repo]);
    writeFileSync(join(repo, 'a.txt'), 'hello\n');
    execFileSync('git', ['-C', repo, 'add', '-A']);
    execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'one'], { env: { ...process.env, ...IDENTITY } });
    checkpoint = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    configPath = join(dir, 'mcp.json');
    mkdirSync(join(dir, 'runs'));
    harness = await streamHarness({
      env: { FAKE_CLAUDE_MCP_CONFIG: configPath },
      runtime: {
        declareToolSet: (sessionId, toolSet) => {
          // The session module grants the session before the process starts; the test does the same.
          server.declareToolSet(sessionId, toolSet);
          server.grant(sessionId, FOLDER);
          writeFileSync(configPath, JSON.stringify(server.configFor(sessionId)));
        },
      },
    });
    ended = [];
  });
  afterEach(async () => {
    await harness.close();
  });

  const template = (task: string, changesetId: string): ReviewRunTemplate => {
    const { runId: _r, sessionId: _s, attempt: _a, reservationUsd: _u, ...rest } = runRequest({ changesetId, task, commonDir: join(repo, '.git'), checkpointCommit: checkpoint, folderId: FOLDER, timeoutMinutes: 1, tier: 'small' });
    return { ...rest, files: store.files(changesetId), hunks: store.hunks(changesetId) };
  };

  function drive(runIdPrefix: string): { driver: ReviewRunDriver; runner: StreamReviewerRuntime } {
    const runner = new StreamReviewerRuntime({ runtime: harness.runtime, checkouts: new GitReviewerCheckouts(new Git(), join(dir, 'runs')), requireReportToolListed: true });
    runner.subscribe((event) => ended.push(event));
    let n = 0;
    const driver = new ReviewRunDriver({
      runtime: runner,
      budget: new FakeReviewBudget(5),
      hasReport: (runId) => store.reports(target).some((report) => report.runId === runId),
      newRunId: () => `${runIdPrefix}${++n}`,
      // The CLI takes only a UUID as --session-id.
      newSessionId: () => randomUUID(),
      onRunStart: (request) => store.putRun(runRow(request.runId, request.changesetId, request.sessionId, request.attempt)),
      onRunEnd: (request) => {
        const row = store.run(request.runId);
        if (row !== undefined && row.state === 'running') store.putRun({ ...row, state: 'failed', failure: 'no-report', endedAt: '2026-11-21T10:05:00.000Z' });
      },
    });
    return { driver, runner };
  }

  it('lets the reviewer report through the MCP server of its grant, in a read-only checkout, with the restricted tool flags', async () => {
    const { driver, runner } = drive('ok');
    const task = `/report ${JSON.stringify(reportArgs(target))}\n/cost 0.02\n/text reviewed`;
    const outcome = await driver.run(template(task, target), 1);
    expect(outcome.kind, 'the review ended with a stored report').toBe('reported');
    expect(store.reports(target)[0]?.findings.length, 'the anchored finding was stored').toBe(1);
    const launches = readFileSync(harness.recordFile, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { args: string[]; cwd: string });
    const args = launches[0]!.args;
    const valueOf = (flag: string): string | undefined => args[args.indexOf(flag) + 1];
    expect([valueOf('--tools'), valueOf('--allowedTools')], 'only read tools and the report tool').toEqual(['Read,Grep,Glob', 'mcp__app__report_review']);
    expect(args, 'no connectors, user settings only').toEqual(expect.arrayContaining(['--strict-mcp-config', '--setting-sources']));
    expect(valueOf('--setting-sources'), 'project settings are not read').toBe('user');
    expect(launches[0]!.cwd, 'the process runs in the checkout of the run').toContain(join('runs', 'ok1', 'tree'));
    await runner.dispose();
  });

  it('counts a denied tool request without an event or an inbox item and still ends the run', async () => {
    const seen: string[] = [];
    harness.runtime.subscribe((event) => seen.push(event.type));
    const { driver, runner } = drive('deny');
    const task = `/tool Bash {"command":"touch x"}\n/report ${JSON.stringify(reportArgs(target))}`;
    await driver.run(template(task, target), 1);
    expect(seen, 'the runtime emitted no permission_request for an autoDeny session').not.toContain('permission_request');
    const end = ended.find((event): event is Extract<ReviewerEvent, { type: 'ended' }> => event.type === 'ended');
    expect(end?.deniedRequests, 'the denial is counted from the CLI result').toBe(1);
    await runner.dispose();
  });

  it('treats a run that never calls report_review as failed, whatever its result says, and retries once', async () => {
    const { driver, runner } = drive('none');
    const outcome = await driver.run(template('/text I reviewed it, it is fine', target), 1);
    expect(outcome, 'two runs ended without a report').toEqual({ kind: 'failed', failures: ['no-report', 'no-report'] });
    await runner.dispose();
  });
});
