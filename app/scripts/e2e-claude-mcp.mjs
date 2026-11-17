// Real-Claude check of the app MCP server: claude -p gets the generated --mcp-config and must create a folder
// through the app's tools. Costs a few cents (model haiku, budget cap). Not part of `pnpm test`.
// Usage: pnpm e2e:claude-mcp        (CLAUDE_BIN overrides the claude executable)
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadTs } from './lib/loadTs.mjs';

const CLAUDE = process.env.CLAUDE_BIN || 'claude';
const FOLDER_TITLE = 'from-agent';
const PROMPT = `Use the app's ui_create_folder tool to create a folder titled "${FOLDER_TITLE}". Then reply with just: done`;

// Variables that an enclosing Claude Code session injects are removed; CLAUDE_CONFIG_DIR stays: it selects the login.
function cleanEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(CLAUDECODE|CLAUDE_CODE_.*|CLAUDE_JOB_DIR|CLAUDE_PID|CLAUDE_AGENTS_.*|CLAUDE_EFFORT|AI_AGENT)$/.test(key)) delete env[key];
  }
  return env;
}

function runClaude(args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(CLAUDE, args, { cwd, env: cleanEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 180_000);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.stdin.end(PROMPT);
  });
}

const parseLines = (text) =>
  text.split('\n').filter(Boolean).map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return { type: '_unparsed', line };
    }
  });

const { modules, close } = await loadTs(['/src/core/mcp/testHarness.ts']);
const [{ startHarness }] = modules;
const harness = await startHarness();
const cwd = mkdtempSync(join(tmpdir(), 'agide-e2e-'));
let failed = false;
const check = (condition, message) => {
  console.log(`${condition ? 'PASS' : 'FAIL'} ${message}`);
  if (!condition) failed = true;
};

try {
  harness.server.grant('e2e-session', harness.mine.id);
  const config = harness.server.configFor('e2e-session');
  const args = [
    '-p', '--output-format', 'stream-json', '--verbose',
    '--model', 'haiku', '--max-budget-usd', '0.25',
    '--setting-sources', 'user', '--strict-mcp-config',
    '--mcp-config', JSON.stringify(config),
    '--allowedTools', 'mcp__app__*',
    '--settings', '{"disableAllHooks":true}',
  ];
  const { code, stdout, stderr } = await runClaude(args, cwd);
  const events = parseLines(stdout);
  const init = events.find((e) => e.type === 'system' && e.subtype === 'init');
  const result = events.find((e) => e.type === 'result');
  const toolUses = events.flatMap((e) => (e.message?.content ?? []).filter((b) => b.type === 'tool_use').map((b) => b.name));

  console.log(JSON.stringify({ exitCode: code, mcpServers: init?.mcp_servers, toolUses, result: String(result?.result).slice(0, 120), costUsd: result?.total_cost_usd }));
  if (code !== 0) console.log(stderr.slice(0, 500));

  check(init?.mcp_servers?.some((s) => s.name === 'app' && s.status === 'connected'), 'claude connected to the app MCP server');
  check(toolUses.includes('mcp__app__ui_create_folder'), 'the agent called ui_create_folder');
  const created = harness.tree.children(harness.mine.id).find((node) => node.title === FOLDER_TITLE);
  check(created?.kind === 'folder', `folder "${FOLDER_TITLE}" exists in the tree under the session folder`);
  check(harness.tree.list().filter((node) => node.title === FOLDER_TITLE).length === 1, 'exactly one such folder exists');
} finally {
  rmSync(cwd, { recursive: true, force: true });
  await harness.close();
  await close();
}
process.exitCode = failed ? 1 : 0;
