// README: node p2_reuse.mjs [listing|skills|connector|bare|all]  -- P2 in -p mode: user skills, marketplace plugins, claude.ai Atlassian connector, --strict-mcp-config effect, --bare auth. Connector results are never stored, only success/failure, tool names and deprecation text.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startStream, userMsg, initOf, resultsOf, save, NOHOOKS, runOnce, BASE, WORK } from './lib.mjs';

const which = process.argv[2] || 'all';
const report = {};
const CFG = process.env.CLAUDE_CONFIG_DIR || join(process.env.HOME, '.claude');
const userSkillNames = () => readdirSync(join(process.env.HOME, '.claude', 'skills'), { withFileTypes: true }).filter((d) => d.isDirectory() || d.isSymbolicLink()).map((d) => d.name).sort();
const enabledPlugins = () => Object.entries(JSON.parse(readFileSync(join(process.env.HOME, '.claude', 'settings.json'), 'utf8')).enabledPlugins || {}).filter(([, v]) => v).map(([k]) => k).sort();
const sentencesWith = (s, rx) => String(s).split(/(?<=[.!?])\s+|\n/).filter((x) => rx.test(x)).map((x) => x.trim().slice(0, 400));

async function once(args, prompt, ms = 120000) {
  const h = startStream(args);
  h.send(userMsg(prompt));
  await h.waitResult(1, ms); await h.end();
  return h;
}
const mcpSummary = (i) => ({ mcp_servers: i.mcp_servers, mcp_server_errors: i.mcp_server_errors ?? '(absent)', claude_ai_tools: i.tools.filter((t) => t.startsWith('mcp__claude_ai_')), mcp_tools_total_listed: i.tools.filter((t) => t.startsWith('mcp__')).length });

async function listing() {
  const loose = await once(NOHOOKS, 'say ok');
  const strict = await once(['--strict-mcp-config', ...NOHOOKS], 'say ok');
  const strictWithApp = await once(['--strict-mcp-config', '--mcp-config', JSON.stringify({ mcpServers: {} }), ...NOHOOKS], 'say ok');
  const il = initOf(loose.events), is = initOf(strict.events);
  const names = new Set(il.skills);
  const dirs = userSkillNames();
  report.listing = {
    without_strict: mcpSummary(il), with_strict: mcpSummary(is), with_strict_and_empty_mcp_config: mcpSummary(initOf(strictWithApp.events)),
    strict_excludes_claude_ai_connectors: mcpSummary(is).mcp_servers.length === 0 || !mcpSummary(is).mcp_servers.some((s) => /claude/i.test(s.name)),
    user_skill_dirs: dirs, user_skill_dirs_missing_in_init_skills: dirs.filter((d) => !names.has(d)),
    skills_in_init_without_strict: il.skills.length, skills_in_init_with_strict: is.skills.length,
    enabled_plugins_in_settings: enabledPlugins(), plugins_in_init: il.plugins.map((p) => p.source), enabled_plugins_missing_in_init: enabledPlugins().filter((p) => !il.plugins.some((x) => x.source === p)),
    plugin_skill_names_sample: il.skills.filter((s) => s.includes(':')).slice(0, 12),
    no_strict_also_loaded_in_strict: il.skills.length === is.skills.length,
  };
}

async function skills() {
  const out = {};
  for (const [label, name] of [['user_skill', 'find-skills'], ['plugin_skill', 'plugin-dev:skill-development']]) {
    const h = await once(['--permission-mode', 'manual', '--strict-mcp-config', '--allowedTools', 'Skill', ...NOHOOKS], `Use the Skill tool to invoke the skill named "${name}" with no arguments. Do nothing else with it. Then reply with exactly: invoked`);
    const uses = [], results = [];
    for (const e of h.events) for (const b of e.message?.content || []) {
      if (b.type === 'tool_use' && b.name === 'Skill') uses.push(b.input);
      if (b.type === 'tool_result' && !JSON.stringify(b.content).includes('tool_reference')) results.push({ is_error: !!b.is_error, content_chars: JSON.stringify(b.content).length });
    }
    out[label] = { skill: name, skill_tool_uses: uses, tool_results: results.slice(0, 3), final: String(resultsOf(h.events)[0]?.result).slice(0, 80) };
  }
  report.skills = out;
}

async function connector() {
  const prompt = 'Find the tool named atlassianUserInfo from the claude.ai Atlassian connector (use ToolSearch to load it) and call it exactly once with no arguments. Do not call any other Atlassian tool. Reply with exactly two lines. Line 1: SUCCESS or FAILURE. Line 2: any deprecation notice about the Atlassian endpoint quoted verbatim from your instructions or the tool result, or NONE. Never include user, site or project data.';
  const h = await once(['--permission-mode', 'manual', '--allowedTools', 'mcp__claude_ai_Atlassian__atlassianUserInfo', 'ToolSearch', ...NOHOOKS], prompt, 180000);
  const i = initOf(h.events);
  const uses = [], results = [], notice = [];
  for (const e of h.events) for (const b of e.message?.content || []) {
    if (b.type === 'tool_use') uses.push(b.name);
    if (b.type === 'tool_result' && !JSON.stringify(b.content).includes('tool_reference')) {
      const s = JSON.stringify(b.content);
      results.push({ is_error: !!b.is_error, chars: s.length });
      notice.push(...sentencesWith(s.replace(/\\n/g, '\n').replace(/\\"/g, '"'), /deprecat|v1\/mcp|v2\/mcp/i));
    }
  }
  const final = String(resultsOf(h.events)[0]?.result);
  report.connector = {
    init: { ...mcpSummary(i), atlassian_server: i.mcp_servers.filter((s) => /atlassian/i.test(s.name)) },
    tool_uses: uses, tool_results: results,
    outcome: /^\s*SUCCESS/i.test(final) ? 'SUCCESS' : /^\s*FAILURE/i.test(final) ? 'FAILURE' : 'UNCLEAR',
    tool_result_is_error: results.map((r) => r.is_error),
    deprecation_text_in_tool_result: [...new Set(notice)],
    deprecation_text_in_model_reply: sentencesWith(final, /deprecat|v1\/mcp|v2\/mcp/i),
    subtype: resultsOf(h.events)[0]?.subtype, cost: resultsOf(h.events)[0]?.total_cost_usd,
  };
}

async function status() {
  // Are claude.ai connectors visible to the host later in the session (second init, mcp_status control request)?
  const h = startStream([...NOHOOKS]);
  h.send(userMsg('say ok'));
  await h.waitResult(1, 90000);
  await new Promise((r) => setTimeout(r, 4000));
  h.send({ type: 'control_request', request_id: 'm1', request: { subtype: 'mcp_status' } });
  const cr = await h.waitFor((e) => e.type === 'control_response' && e.response?.request_id === 'm1', 15000);
  h.send(userMsg('say ok again'));
  await h.waitResult(2, 90000); await h.end();
  const inits = h.events.filter((e) => e.type === 'system' && e.subtype === 'init');
  const servers = cr?.response?.response?.mcpServers ?? cr?.response?.response?.servers ?? cr?.response;
  report.status = {
    init_servers: inits.map((i) => i.mcp_servers.map((s) => `${s.name}:${s.status}`)),
    init_claude_ai_tools: inits.map((i) => i.tools.filter((t) => t.startsWith('mcp__claude_ai_')).length),
    mcp_status_response_subtype: cr?.response?.subtype,
    mcp_status_servers: Array.isArray(servers) ? servers.map((s) => ({ name: s.name, status: s.status, scope: s.scope, tools: Array.isArray(s.tools) ? s.tools.length : undefined })) : JSON.stringify(servers).slice(0, 600),
  };
}

async function bare() {
  const r = await runOnce(['--bare', '-p', 'say ok', ...BASE]);
  const r2 = await runOnce(['--bare', '-p', 'say ok', '--output-format', 'json', ...BASE]);
  report.bare = { exit_code: r.code, stdout: r.stdout.slice(0, 400), stderr: r.stderr.slice(0, 400), json_variant: { exit_code: r2.code, stdout: r2.stdout.slice(0, 400), stderr: r2.stderr.slice(0, 200) } };
}

const steps = { listing, skills, connector, status, bare };
for (const [k, f] of Object.entries(steps)) if (which === 'all' || which === k) { try { await f(); } catch (e) { report[k] = { error: String(e?.stack || e) }; } }
save(`p2_report_${which}.json`, report);
console.log(JSON.stringify(report, null, 1));
