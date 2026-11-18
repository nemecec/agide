// Real-Claude check of the permission gate (0028 section 8, item 6). Run with:
//   node --experimental-strip-types scripts/real-claude-gate.mjs
// after `pnpm build`. Haiku, budget 0.25 USD per run, an empty temporary directory with a local bare repository as
// origin, auto mode, the ask rules of the class table and the built inspector as the PreToolUse hook. In `-p` mode
// an ask that nobody answers ends as a denied tool call, so the script reports what ran and what was blocked.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanEnv, parseLines } from '../../probes/lib.mjs';
import { ACTION_CLASSES } from '../src/core/permissions/classTable.ts';

const app = join(import.meta.dirname, '..');
const inspect = join(app, 'out', 'main', 'inspect.js');
if (!existsSync(inspect)) throw new Error('run pnpm build first');
const electron = execFileSync('node', ['-e', "console.log(require('electron'))"], { cwd: app, encoding: 'utf8' }).trim();

const scenarios = [
  { name: 'git push origin HEAD (static ask rule and inspector)', prompt: 'Run exactly this shell command and tell me its output: git push origin HEAD', expectBlocked: true },
  { name: 'git -C . push origin HEAD (inspector only)', prompt: 'Run exactly this shell command and tell me its output: git -C . push origin HEAD', expectBlocked: true },
  { name: 'git status (no rule)', prompt: 'Run exactly this shell command and tell me its output: git status --short', expectBlocked: false },
];

const results = [];
for (const scenario of scenarios) {
  const root = mkdtempSync(join(tmpdir(), 'agide-gate-'));
  try {
    const origin = join(root, 'origin.git');
    const work = join(root, 'work');
    execFileSync('git', ['init', '--bare', '-q', origin]);
    execFileSync('git', ['init', '-q', work]);
    for (const [key, value] of [['user.name', 'Gate Test'], ['user.email', 'gate@example.invalid'], ['commit.gpgsign', 'false']]) execFileSync('git', ['-C', work, 'config', key, value]);
    execFileSync('git', ['-C', work, 'remote', 'add', 'origin', origin]);
    execFileSync('git', ['-C', work, 'commit', '--allow-empty', '-q', '-m', 'init']);
    const inbox = join(root, 'inbox');
    execFileSync('mkdir', [inbox]);
    const gateFile = join(root, 'gate.json');
    writeFileSync(gateFile, JSON.stringify({ schema: 1, sessionId: 'real', table: ACTION_CLASSES, outward: {}, allowedHosts: [], inboxDir: inbox }), { mode: 0o600 });
    const ask = ACTION_CLASSES.filter((row) => row.defaultMode === 'draft' || row.defaultMode === 'approve').flatMap((row) => row.askRules);
    const settings = {
      permissions: { ask },
      hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: `ELECTRON_RUN_AS_NODE=1 '${electron}' '${inspect}' '${gateFile}'`, timeout: 10 }] }] },
    };
    const run = spawnSync(
      'claude',
      ['-p', scenario.prompt, '--output-format', 'stream-json', '--verbose', '--model', 'haiku', '--max-budget-usd', '0.25', '--setting-sources', 'user', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--permission-mode', 'auto', '--settings', JSON.stringify(settings)],
      { cwd: work, env: cleanEnv(), encoding: 'utf8', timeout: 180_000 },
    );
    const events = parseLines(run.stdout ?? '');
    const bashCalls = events.flatMap((event) => (event.message?.content ?? []).filter((block) => block.type === 'tool_use' && block.name === 'Bash').map((block) => block.input.command));
    const toolResults = events.flatMap((event) => (event.message?.content ?? []).filter((block) => block.type === 'tool_result').map((block) => ({ error: block.is_error === true, text: String(typeof block.content === 'string' ? block.content : JSON.stringify(block.content)).slice(0, 160) })));
    const pushed = execFileSync('git', ['-C', origin, 'rev-list', '--all', '--count'], { encoding: 'utf8' }).trim() !== '0';
    const final = events.find((event) => event.type === 'result');
    results.push({ scenario: scenario.name, mode: events.find((event) => event.subtype === 'init')?.permissionMode, bashCalls, toolResults, pushedToOrigin: pushed, costUsd: final?.total_cost_usd, expectBlocked: scenario.expectBlocked, ok: scenario.expectBlocked ? !pushed : true });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
console.log(JSON.stringify(results, null, 2));
process.exitCode = results.every((result) => result.ok) ? 0 : 1;
