// Starts one real Claude session through PtySessionService (model haiku, empty temporary directory), sends one
// short prompt, waits for the Stop hook event, reads usage and cost from the transcript and closes the session.
// Not part of `pnpm test`. Run: node scripts/smoke-real-claude.mjs
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runnerImport } from 'vite';

const TIMEOUT_MS = 120_000;
const PROMPT = 'Reply with just the word: pong';

const root = new URL('..', import.meta.url).pathname;
const { module } = await runnerImport(join(root, 'src/core/session/index.ts'));
const { PtySessionService } = module;

// A fixed empty directory: Claude records the answer to its trust prompt per path, so a new directory on every
// run would add a new entry to the user's Claude config each time.
const cwdPath = join(tmpdir(), 'agide-smoke-cwd');
mkdirSync(cwdPath, { recursive: true });
const cwd = realpathSync(cwdPath);
const dataDir = mkdtempSync(join(tmpdir(), 'smoke-claude-data-'));
const service = new PtySessionService({
  eventsDir: join(dataDir, 'events'),
  extraArgs: () => ['--model', 'haiku', '--max-budget-usd', '0.25', '--strict-mcp-config'],
});

const result = { prompt: PROMPT, ok: false };
const events = [];
let output = '';
let trustAnswered = false;
// The cursor-forward sequences replace spaces on screen, so the text is matched without spaces.
const plain = (text) => text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g, '').replace(/\s+/g, '');
service.subscribe((event) => {
  events.push(event);
  if (event.type !== 'session.output') return;
  output += event.data;
  // A directory Claude has not seen asks to be trusted before any hook fires. The cursor starts on "No, exit".
  if (!trustAnswered && /Yes,Itrustthisfolder/.test(plain(output))) {
    trustAnswered = true;
    result.trustPromptAnswered = true;
    setTimeout(() => service.write(event.sessionId, '\x1b[B'), 1500);
    setTimeout(() => service.write(event.sessionId, '\r'), 3000);
  }
});

const started = Date.now();
const waitFor = async (what, probe) => {
  while (!probe()) {
    if (Date.now() - started > TIMEOUT_MS) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

let session;
try {
  session = await service.create({ folderId: 'smoke-folder', cwd, prompt: PROMPT, permissionMode: 'default' });
  result.sessionId = session.id;
  await waitFor('Stop hook', () => events.some((e) => e.type === 'session.hook' && e.hookEvent === 'Stop'));
  result.secondsToStop = (Date.now() - started) / 1000;
  const hookEvents = events.filter((e) => e.type === 'session.hook');
  result.hookSequence = hookEvents.map((e) => e.hookEvent);
  result.statusSequence = events.filter((e) => e.type === 'session.status_changed').map((e) => e.session.status);
  const stop = hookEvents.find((e) => e.hookEvent === 'Stop');
  result.lastAssistantMessage = stop.payload.last_assistant_message;
  result.stopPayloadKeys = Object.keys(stop.payload).sort();
  result.permissionModeInHooks = [...new Set(hookEvents.map((e) => e.payload.permission_mode).filter(Boolean))];

  // The cost row reaches the transcript when the process ends, so the session closes before the transcript is read.
  await service.close(session.id);
  result.closedEvent = events.some((e) => e.type === 'session.closed');
  result.exitSignal = events.find((e) => e.type === 'session.exited')?.signal ?? null;
  session = undefined;
  const rows = readFileSync(stop.payload.transcript_path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const usage = rows.map((row) => row.message?.usage).filter(Boolean).at(-1);
  const cost = rows.filter((row) => row.type === 'cost-state').at(-1);
  result.transcriptUsage = usage && { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens, cache_read_input_tokens: usage.cache_read_input_tokens, cache_creation_input_tokens: usage.cache_creation_input_tokens };
  result.costState = cost && { totalCostUSD: cost.totalCostUSD, hasUnknownModelCost: cost.hasUnknownModelCost, modelUsage: cost.modelUsage };
  result.costFieldsInStopPayload = Object.keys(stop.payload).filter((key) => /cost/i.test(key));
  result.model = rows.map((row) => row.message?.model).filter(Boolean).at(-1);
  result.ok = /pong/i.test(String(result.lastAssistantMessage));
} catch (error) {
  result.error = String(error);
  result.screenTail = plain(output).slice(-800);
} finally {
  if (session) {
    await service.close(session.id);
    result.closedEvent = events.some((e) => e.type === 'session.closed');
    result.exitSignal = events.find((e) => e.type === 'session.exited')?.signal ?? null;
  }
  rmSync(dataDir, { recursive: true, force: true });
}
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
