// README: node p9_setting_sources_p.mjs [config ...]  -- P9 in -p mode: a fixture checkout (project .mcp.json, project hook, CLAUDE.md) under --setting-sources user with and without --strict-mcp-config, plus a control with all sources. Records whether the project server starts, the project hook runs, CLAUDE.md is read, and which connectors are listed (init and mcp_status). One read-only connector call (atlassianUserInfo) on the non-strict runs; no returned data is stored. Haiku, budget cap per call.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HERE, startStream, userMsg, sleep, save, OUT, initOf } from './lib.mjs';

const CONFIGS = {
  user_only: ['--setting-sources', 'user'],
  user_strict: ['--setting-sources', 'user', '--strict-mcp-config'],
  all_sources: ['--setting-sources', 'user,project,local'],
};
const which = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(CONFIGS);
const report = existsSync(join(OUT, 'p9_p_report.json')) ? JSON.parse(readFileSync(join(OUT, 'p9_p_report.json'), 'utf8')) : {};
const PROMPT = 'What is the project codeword in your instructions? Reply with the codeword exactly as written, or NONE if you have no such instruction. No tools.';

async function one(name) {
  const checkout = execFileSync('python3', [join(HERE, 'make_checkout.py'), `p9p-${name}`], { encoding: 'utf8' }).trim();
  const markers = checkout + '-markers';
  const appHookLog = join(OUT, `p9_p_${name}_apphook.jsonl`); writeFileSync(appHookLog, '');
  const settings = JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: `python3 ${HERE}/hooks/log_hook.py ${appHookLog}` }] }] } });
  const log = (await import('node:fs')).createWriteStream(join(OUT, `p9_p_${name}.jsonl`));
  const h = startStream([...CONFIGS[name], '--permission-mode', 'manual', '--allowedTools', 'mcp__claude_ai_Atlassian__atlassianUserInfo', 'ToolSearch', '--settings', settings], { cwd: checkout, log });
  h.send(userMsg(PROMPT));
  await h.waitResult(1, 90000);
  const answer = (h.events.filter((e) => e.type === 'assistant').pop()?.message?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  await sleep(5000);
  h.send({ type: 'control_request', request_id: 'm1', request: { subtype: 'mcp_status' } });
  const cr = await h.waitFor((e) => e.type === 'control_response' && e.response?.request_id === 'm1', 20000);
  const servers = cr?.response?.response?.mcpServers ?? [];
  let connector = null;
  if (name !== 'user_strict') {
    h.send(userMsg('Use ToolSearch to find the tool atlassianUserInfo of the claude.ai Atlassian connector, call it once, and reply with exactly SUCCESS or FAILURE. Do not repeat any data from the result.'));
    await h.waitResult(2, 150000);
    const last = h.events.filter((e) => e.type === 'assistant').pop();
    connector = { reply: (last?.message?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').slice(0, 40) };
  }
  await h.end();
  const inits = h.events.filter((e) => e.type === 'system' && e.subtype === 'init');
  const fmt = (i) => i.mcp_servers.map((s) => `${s.name}:${s.status}`);
  const read = (f) => (existsSync(join(markers, f)) ? readFileSync(join(markers, f), 'utf8').trim().split('\n') : null);
  report[name] = {
    flags: CONFIGS[name],
    project_mcp_server_started: existsSync(join(markers, 'mcp_started.txt')),
    project_hook_ran: read('hook_ran.txt'),
    claude_md_answer: answer.slice(0, 80),
    init_first_servers: fmt(inits[0]), init_last_servers: fmt(inits[inits.length - 1]),
    init_last_tool_prefixes: [...new Set(inits[inits.length - 1].tools.filter((t) => t.startsWith('mcp__')).map((t) => t.split('__').slice(0, 2).join('__')))],
    init_count: inits.length,
    mcp_status: servers.map((s) => ({ name: s.name, status: s.status, scope: s.scope, tools: Array.isArray(s.tools) ? s.tools.length : undefined })),
    connector_call: connector,
    result_cost_usd: h.events.filter((e) => e.type === 'result').map((e) => e.total_cost_usd),
  };
  save('p9_p_report.json', report);
}
for (const n of which) { try { await one(n); } catch (e) { report[n] = { error: String(e?.stack || e) }; save('p9_p_report.json', report); } }
console.log(JSON.stringify(report, null, 1));
