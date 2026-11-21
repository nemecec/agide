#!/usr/bin/env node
// A stand-in for `claude -p --input-format stream-json --output-format stream-json` in tests (0037 section 14).
// It reads NDJSON from stdin and writes stream-json lines shaped like the ones of probes P30 to P35.
//
// - Records its arguments, working directory and selected variables as one JSON line to $FAKE_CLAUDE_RECORD.
// - Keeps the session ids it created under $FAKE_CLAUDE_STATE (default: <tmpdir>/fake-claude-stream): a
//   --session-id that exists fails at start, a --resume of an unknown id fails at start (P33).
// - Writes nothing before the first user message (P33); each user message is one turn that starts with
//   system/init carrying the requested --permission-mode (manual reads as default, P30), or $FAKE_CLAUDE_MODE.
// - User messages are read in the step language of src/core/swarm/runtime/fakeScript.ts:
//   /text <words>, /tool <name> <json>, /cost <usd>, /sleep <ms>, /fail <terminal reason>, /exit <code>,
//   /write <file> <text>. A message without steps gets the reply "echo: <message>".
// - Answers the control requests interrupt (ends the turn with error_during_execution and cancels an open
//   can_use_tool request with control_cancel_request), initialize (a models list) and any other subtype
//   (an empty success).
// - Stops model work after the result that reaches --max-budget-usd and answers every later message with
//   error_max_budget_usd (P35).
// - Closing stdin ends the process after the running and queued turns, with code 0.
// - Answers set_permission_mode: the next system/init reports the new mode.
// - $FAKE_CLAUDE_NOISE=1 adds a line of an unknown event type and a line that is not JSON before each assistant message.
// - $FAKE_CLAUDE_STUBBORN=1 ignores SIGTERM and does not end when stdin closes, so only SIGKILL stops it.
// - $FAKE_CLAUDE_IGNORE_STDIN_CLOSE=1 stays alive when stdin closes, but ends on SIGTERM.
// - $FAKE_CLAUDE_CHILD_PID_FILE=<file> starts a child process in the same process group and writes its pid there.
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';

const args = process.argv.slice(2);
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const resumed = args.includes('--resume');
const sessionId = resumed ? flag('--resume') : flag('--session-id');
// The CLI takes `manual` and reports it as `default` in system/init (P30).
const cliMode = process.env.FAKE_CLAUDE_MODE ?? flag('--permission-mode') ?? 'manual';
let requestedMode = cliMode === 'manual' ? 'default' : cliMode;
const noisy = process.env.FAKE_CLAUDE_NOISE === '1';
const stubborn = process.env.FAKE_CLAUDE_STUBBORN === '1';
const ignoreStdinClose = stubborn || process.env.FAKE_CLAUDE_IGNORE_STDIN_CLOSE === '1';
const alias = flag('--model') ?? 'default';
const model = ['haiku', 'sonnet', 'opus', 'fable'].includes(alias) ? `claude-${alias}-5-5` : alias === 'default' ? 'claude-opus-5-5' : alias;
const maxBudget = flag('--max-budget-usd') === undefined ? Infinity : Number(flag('--max-budget-usd'));
const COST_PER_MESSAGE = 0.001;

if (process.env.FAKE_CLAUDE_RECORD) {
  appendFileSync(
    process.env.FAKE_CLAUDE_RECORD,
    JSON.stringify({
      args,
      cwd: process.cwd(),
      env: {
        CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
        CLAUDECODE: process.env.CLAUDECODE,
        CLAUDE_CODE_ENTRYPOINT: process.env.CLAUDE_CODE_ENTRYPOINT,
        CLAUDE_CODE_SUBAGENT_MODEL: process.env.CLAUDE_CODE_SUBAGENT_MODEL,
        CLAUDE_CODE_SUBAGENT_MODEL_FORCE: process.env.CLAUDE_CODE_SUBAGENT_MODEL_FORCE,
      },
    }) + '\n',
  );
}

const stateDir = process.env.FAKE_CLAUDE_STATE ?? join(tmpdir(), 'fake-claude-stream');
mkdirSync(stateDir, { recursive: true });
const marker = join(stateDir, `${sessionId}.session`);
if (!sessionId) {
  process.stderr.write('Error: --session-id or --resume is required by the fake\n');
  process.exit(1);
}
if (!resumed && existsSync(marker)) {
  process.stderr.write(`Error: Session ID ${sessionId} is already in use.\n`);
  process.exit(1);
}
if (resumed && !existsSync(marker)) {
  process.stderr.write(`No conversation found with session ID: ${sessionId}\n`);
  process.exit(1);
}
writeFileSync(marker, '');

if (stubborn) process.on('SIGTERM', () => undefined);
if (ignoreStdinClose) setInterval(() => undefined, 1000);
if (process.env.FAKE_CLAUDE_CHILD_PID_FILE) {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore',
  });
  writeFileSync(process.env.FAKE_CLAUDE_CHILD_PID_FILE, String(child.pid));
}

const out = (message) => process.stdout.write(JSON.stringify(message) + '\n');
// stdout to a pipe is asynchronous on macOS, so exits wait for the writes to drain.
const exitAfterFlush = (code) => process.stdout.write('', () => process.exit(code));
const uuid = () => randomUUID();

let costUsd = 0;
let exhausted = false;
let rateLimitSent = false;
let busy = false;
let stdinClosed = false;
const queue = [];
let abort = null;
const pendingAnswers = new Map();
const pendingWaits = new Set();

function parseSteps(text) {
  const steps = [];
  for (const line of text.split('\n')) {
    const match = /^\/(\w+)(?:\s+(.*))?$/.exec(line.trim());
    if (!match) continue;
    const [, name, rest = ''] = match;
    const space = rest.indexOf(' ');
    const head = space < 0 ? rest : rest.slice(0, space);
    const tail = space < 0 ? '' : rest.slice(space + 1);
    if (name === 'text') steps.push({ kind: 'text', text: rest });
    else if (name === 'tool')
      steps.push({
        kind: 'tool',
        name: head,
        input: tail ? JSON.parse(tail) : {},
      });
    else if (name === 'cost') steps.push({ kind: 'cost', usd: Number(rest) });
    else if (name === 'sleep') steps.push({ kind: 'sleep', ms: Number(rest) });
    else if (name === 'fail') steps.push({ kind: 'fail', reason: rest || 'api_error' });
    else if (name === 'exit') steps.push({ kind: 'exit', code: Number(rest || '0') });
    else if (name === 'write') steps.push({ kind: 'write', file: head, text: tail });
  }
  if (steps.length === 0) steps.push({ kind: 'text', text: `echo: ${text}` });
  return steps;
}

const usage = () => ({
  input_tokens: 10,
  cache_creation_input_tokens: 100,
  cache_read_input_tokens: 200,
  cache_creation: {
    ephemeral_5m_input_tokens: 0,
    ephemeral_1h_input_tokens: 100,
  },
  output_tokens: 5,
  service_tier: 'standard',
});

function assistant(content) {
  if (noisy) {
    out({
      type: 'future_event',
      detail: { nested: [1, 2, 3] },
      session_id: sessionId,
    });
    process.stdout.write('this line is not json\n');
  }
  const id = `msg_fake_${uuid().slice(0, 8)}`;
  costUsd += COST_PER_MESSAGE;
  out({
    type: 'assistant',
    message: {
      model,
      id,
      type: 'message',
      role: 'assistant',
      content,
      stop_reason: null,
      usage: usage(),
    },
    parent_tool_use_id: null,
    session_id: sessionId,
    uuid: uuid(),
  });
  if (!rateLimitSent) {
    rateLimitSent = true;
    const resetsAt = Math.floor(Date.now() / 1000) + 3600;
    out({
      type: 'rate_limit_event',
      rate_limit_info: {
        status: 'allowed',
        resetsAt,
        rateLimitType: 'five_hour',
        isUsingOverage: false,
        unifiedWindows: {
          five_hour: { utilization: 0.03, resetsAt, status: 'allowed' },
          seven_day: {
            utilization: 0.08,
            resetsAt: resetsAt + 86400,
            status: 'allowed',
          },
        },
      },
      uuid: uuid(),
      session_id: sessionId,
    });
  }
}

function result({ subtype, isError, terminalReason, text, errors, denials, turns }) {
  out({
    type: 'result',
    subtype,
    is_error: isError,
    duration_ms: 12,
    duration_api_ms: 10,
    num_turns: turns,
    result: text ?? null,
    stop_reason: 'end_turn',
    session_id: sessionId,
    total_cost_usd: costUsd,
    usage: {
      input_tokens: 10 * turns,
      output_tokens: 5 * turns,
      cache_creation_input_tokens: 100,
      cache_read_input_tokens: 200,
    },
    modelUsage: {
      [model]: {
        inputTokens: 10 * turns,
        outputTokens: 5 * turns,
        cacheReadInputTokens: 200,
        cacheCreationInputTokens: 100,
        costUSD: costUsd,
        costBasis: 'list',
      },
    },
    permission_denials: denials,
    terminal_reason: terminalReason,
    ...(errors.length > 0 ? { errors } : {}),
    uuid: uuid(),
  });
}

const wait = (ms) =>
  new Promise((done) => {
    const entry = {
      done: () => (clearTimeout(timer), pendingWaits.delete(entry), done()),
    };
    const timer = setTimeout(entry.done, ms);
    pendingWaits.add(entry);
  });

async function turn(text) {
  abort = { aborted: false };
  const state = abort;
  out({
    type: 'system',
    subtype: 'init',
    cwd: process.cwd(),
    session_id: sessionId,
    tools: ['Bash', 'Read', 'Write', 'Edit'],
    mcp_servers: [],
    model,
    permissionMode: requestedMode,
    apiKeySource: 'none',
    output_style: 'default',
    uuid: uuid(),
  });
  if (exhausted) {
    result({
      subtype: 'error_max_budget_usd',
      isError: true,
      terminalReason: 'budget_exhausted',
      errors: [`Reached maximum budget ($${maxBudget})`],
      denials: [],
      turns: 1,
    });
    return;
  }
  let resultText;
  let costSet;
  let turns = 0;
  let pendingTool = false;
  const denials = [];
  for (const step of parseSteps(text)) {
    if (state.aborted) break;
    if (step.kind === 'text') {
      turns += 1;
      resultText = step.text;
      assistant([{ type: 'text', text: step.text }]);
    } else if (step.kind === 'tool') {
      turns += 1;
      const toolUseId = `toolu_${uuid().slice(0, 12)}`;
      assistant([{ type: 'tool_use', id: toolUseId, name: step.name, input: step.input }]);
      const requestId = uuid();
      const answered = new Promise((done) => pendingAnswers.set(requestId, done));
      out({
        type: 'control_request',
        request_id: requestId,
        request: {
          subtype: 'can_use_tool',
          tool_name: step.name,
          display_name: step.name,
          input: step.input,
          description: step.name,
          permission_suggestions: [
            {
              type: 'addRules',
              rules: [{ toolName: step.name }],
              behavior: 'allow',
              destination: 'session',
            },
          ],
          tool_use_id: toolUseId,
        },
      });
      pendingTool = true;
      const answer = await answered;
      if (answer === undefined) {
        out({ type: 'control_cancel_request', request_id: requestId });
        break;
      }
      pendingTool = false;
      if (answer.behavior === 'allow') {
        out({
          type: 'user',
          message: {
            role: 'user',
            content: [
              {
                tool_use_id: toolUseId,
                type: 'tool_result',
                content: `ok ${JSON.stringify(answer.updatedInput ?? step.input)}`,
              },
            ],
          },
          parent_tool_use_id: null,
          session_id: sessionId,
          uuid: uuid(),
        });
      } else {
        denials.push({
          tool_name: step.name,
          tool_use_id: toolUseId,
          tool_input: step.input,
        });
        out({
          type: 'user',
          message: {
            role: 'user',
            content: [
              {
                tool_use_id: toolUseId,
                type: 'tool_result',
                content: answer.message ?? 'denied',
                is_error: true,
              },
            ],
          },
          parent_tool_use_id: null,
          session_id: sessionId,
          uuid: uuid(),
        });
      }
    } else if (step.kind === 'cost') {
      costSet = step.usd;
    } else if (step.kind === 'sleep') {
      await wait(step.ms);
    } else if (step.kind === 'fail') {
      if (costSet !== undefined) costUsd = costSet;
      result({
        subtype: 'error_during_execution',
        isError: true,
        terminalReason: step.reason,
        errors: [`fake failure: ${step.reason}`, '[ede_diagnostic] fake'],
        denials,
        turns,
      });
      return;
    } else if (step.kind === 'exit') {
      exitAfterFlush(step.code);
      await new Promise(() => undefined);
    } else if (step.kind === 'write') {
      writeFileSync(resolve(process.cwd(), step.file), step.text);
    }
  }
  if (state.aborted) {
    if (costSet !== undefined) costUsd = costSet;
    result({
      subtype: 'error_during_execution',
      isError: true,
      terminalReason: pendingTool ? 'aborted_tools' : 'aborted_streaming',
      errors: ['[ede_diagnostic] result_type=user'],
      denials,
      turns,
    });
    return;
  }
  if (costSet !== undefined) costUsd = costSet;
  if (costUsd >= maxBudget) {
    exhausted = true;
    result({
      subtype: 'error_max_budget_usd',
      isError: true,
      terminalReason: 'budget_exhausted',
      errors: [`Reached maximum budget ($${maxBudget})`],
      denials,
      turns,
    });
    return;
  }
  result({
    subtype: 'success',
    isError: false,
    terminalReason: 'completed',
    text: resultText,
    errors: [],
    denials,
    turns,
  });
}

async function drain() {
  if (busy) return;
  busy = true;
  while (queue.length > 0) await turn(queue.shift());
  busy = false;
  abort = null;
  if (stdinClosed && !ignoreStdinClose) exitAfterFlush(0);
}

function interrupt() {
  if (abort) abort.aborted = true;
  for (const entry of [...pendingWaits]) entry.done();
  for (const [requestId, done] of [...pendingAnswers]) {
    pendingAnswers.delete(requestId);
    done(undefined);
  }
}

function control(message) {
  const request = message.request ?? {};
  const respond = (response) =>
    out({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: message.request_id,
        response,
      },
    });
  if (request.subtype === 'interrupt') {
    interrupt();
    respond({});
  } else if (request.subtype === 'set_permission_mode') {
    requestedMode = request.mode === 'manual' ? 'default' : String(request.mode);
    respond({ mode: requestedMode });
  } else if (request.subtype === 'initialize') {
    respond({
      commands: [],
      models: ['default', 'fable', 'opus', 'sonnet', 'haiku'].map((value) => ({
        value,
        displayName: value,
      })),
      account: {},
    });
  } else {
    respond({});
  }
}

function userText(message) {
  const content = message.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content))
    return content
      .filter((part) => part?.type === 'text')
      .map((part) => part.text)
      .join('\n');
  return '';
}

const lines = createInterface({ input: process.stdin });
lines.on('line', (line) => {
  if (line.trim() === '') return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    process.stderr.write(`fake: cannot parse ${line.slice(0, 80)}\n`);
    return;
  }
  if (message.type === 'user') {
    queue.push(userText(message));
    void drain();
  } else if (message.type === 'control_request') {
    control(message);
  } else if (message.type === 'control_response') {
    const response = message.response ?? {};
    const done = pendingAnswers.get(response.request_id);
    if (done) {
      pendingAnswers.delete(response.request_id);
      done(response.response ?? { behavior: 'deny', message: 'no answer' });
    }
  }
});
lines.on('close', () => {
  stdinClosed = true;
  if (!busy && !ignoreStdinClose) exitAfterFlush(0);
});
