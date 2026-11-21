// Real-Claude check of the stream-json agent runtime (0037 section 2, 0038): one Haiku agent in an empty temporary
// directory, started through the session service, the local provider and the runtime, in the manual permission mode.
// The agent is asked to write two files with the Write tool. The first call is approved through the control channel,
// the second is denied; the script checks that the first file exists, the second does not, and that the result lists
// the denied call. It also reads the init event (mode, key source), the cost and the rate limit event.
// Costs a few cents (model haiku, --max-budget-usd 0.25). Not part of `pnpm test` or `pnpm e2e`.
// Usage: node scripts/e2e-real-swarm-runtime.mjs
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadTs } from './lib/loadTs.mjs';

const ALLOWED = 'allowed.txt';
const DENIED = 'denied.txt';
const PROMPT = `Use the Write tool to create a file named ${ALLOWED} that contains the word ok. Then use the Write tool to create a file named ${DENIED} that contains the word no. If a tool call is refused, do not try another way to write that file. Finish with the single word done.`;
const TIMEOUT_MS = 120_000;
const MAX_BUDGET_USD = 0.25;

const { modules, close } = await loadTs(['/src/core/session/PtySessionService.ts', '/src/core/session/streamSpawner.ts', '/src/core/swarm/runtime/StreamAgentRuntime.ts']);
const [{ PtySessionService }, { StreamSpawners }, { StreamAgentRuntime }] = modules;

const root = realpathSync(mkdtempSync(join(tmpdir(), 'agide-real-runtime-')));
const cwd = join(root, 'work');
mkdirSync(cwd);

const events = [];
const decisions = [];
const result = { ok: false, prompt: PROMPT, decisions, checks: {} };
let runtime;
let sessions;
let sessionId;

const slot = new StreamSpawners();
sessions = new PtySessionService({ eventsDir: join(root, 'events'), streamSpawner: slot, contributors: () => [runtime.contributor], killTimeoutMs: 2000 });
runtime = new StreamAgentRuntime({ sessions });
slot.set(runtime);
runtime.subscribe((event) => events.push(event));

const timer = setTimeout(() => {
  result.error = `no result within ${TIMEOUT_MS} ms`;
  void finish(2);
}, TIMEOUT_MS);

runtime.subscribe((event) => {
  if (event.type !== 'permission_request') return;
  const file = String(event.request.input.file_path ?? '');
  const allow = file.endsWith(ALLOWED);
  decisions.push({ tool: event.request.tool_name, file: file.split('/').at(-1), decision: allow ? 'allow' : 'deny' });
  runtime.answer(event.sessionId, event.requestId, allow ? { behavior: 'allow', updatedInput: event.request.input } : { behavior: 'deny', message: 'The user denied this call in Agide.' });
});

async function finish(code) {
  clearTimeout(timer);
  try {
    if (runtime.isLive(sessionId ?? '')) await runtime.stop(sessionId);
    await sessions.shutdown();
  } finally {
    rmSync(root, { recursive: true, force: true });
    await close();
    console.log(JSON.stringify(result, null, 2));
    process.exit(code);
  }
}

try {
  sessionId = crypto.randomUUID();
  const spec = {
    sessionId,
    folderId: 'real-runtime-check',
    title: 'real runtime check',
    cwd,
    model: 'haiku',
    effort: 'low',
    permissionMode: 'default',
    maxBudgetUsd: MAX_BUDGET_USD,
    maxTurnsPerMessage: 8,
    connectors: false,
    tools: ['Write', 'Read'],
    denyRules: [],
    addDirs: [],
    firstMessage: PROMPT,
  };
  await runtime.launch(spec);
  const deadline = Date.now() + TIMEOUT_MS;
  while (!events.some((event) => event.type === 'result')) {
    if (Date.now() > deadline || events.some((event) => event.type === 'exited')) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const turn = events.find((event) => event.type === 'result')?.result;
  const init = events.find((event) => event.type === 'init');
  const limit = events.find((event) => event.type === 'rate_limit');
  await runtime.end(sessionId);
  const exited = events.find((event) => event.type === 'exited');

  result.init = init && { permissionMode: init.permissionMode, model: init.model, apiKeySource: init.apiKeySource, tools: init.tools };
  result.turn = turn && { subtype: turn.subtype, isError: turn.isError, terminalReason: turn.terminalReason, text: turn.text, totalCostUsd: turn.totalCostUsd, numTurns: turn.numTurns, denials: turn.permissionDenials.map((denial) => ({ tool: denial.tool_name, file: String(denial.tool_input?.file_path ?? '').split('/').at(-1) })) };
  result.rateLimit = limit && { status: limit.info.status, type: limit.info.rateLimitType, windows: Object.keys(limit.info.unifiedWindows ?? {}) };
  result.exit = exited && { code: exited.code, signal: exited.signal, byApp: exited.byApp };
  result.assistantTexts = events.filter((event) => event.type === 'assistant').map((event) => ({ tools: event.toolNames, text: event.text?.slice(0, 80) }));

  const checks = result.checks;
  checks.initInManualMode = init?.permissionMode === 'default';
  checks.firstCallAsked = decisions[0]?.file === ALLOWED && decisions[0]?.decision === 'allow';
  checks.secondCallAsked = decisions.some((decision) => decision.file === DENIED && decision.decision === 'deny');
  checks.allowedFileWritten = existsSync(join(cwd, ALLOWED)) && readFileSync(join(cwd, ALLOWED), 'utf8').trim().toLowerCase().includes('ok');
  checks.deniedFileMissing = !existsSync(join(cwd, DENIED));
  checks.denialInResult = (turn?.permissionDenials ?? []).some((denial) => String(denial.tool_input?.file_path ?? '').endsWith(DENIED));
  checks.turnSucceeded = turn?.subtype === 'success' && turn.isError === false;
  checks.costWithinBudget = typeof turn?.totalCostUsd === 'number' && turn.totalCostUsd <= MAX_BUDGET_USD;
  checks.cleanExitByApp = exited?.code === 0 && exited.byApp === true;
  result.ok = Object.values(checks).every(Boolean);
  await finish(result.ok ? 0 : 1);
} catch (error) {
  result.error = error instanceof Error ? error.message : String(error);
  await finish(1);
}
