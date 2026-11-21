// README: node p37_bare.mjs  -- P37 --bare: whether -p loads user hooks, skills and connectors by default in this version, what --bare skips, and whether --bare -p still authenticates with the subscription login (ANTHROPIC_API_KEY is removed from the child environment). Also records the --bare help text. Haiku, budget-capped, fresh directory.
import { runOnce, parseLines, BASE } from './lib.mjs';
import { fresh, cleanup, save, initOf, resultsOf, brief } from './p_swarm_lib.mjs';

const cwd = fresh('p37-');
const report = { env_had_anthropic_api_key: !!process.env.ANTHROPIC_API_KEY };
const NOKEY = { ANTHROPIC_API_KEY: undefined, ANTHROPIC_AUTH_TOKEN: undefined };
const envFor = () => { const e = {}; return e; };
async function run(name, extra, { input } = {}) {
  const args = ['-p', input ?? 'Reply with just: ok', '--output-format', 'stream-json', '--verbose', ...BASE, ...extra];
  const prev = { k: process.env.ANTHROPIC_API_KEY, t: process.env.ANTHROPIC_AUTH_TOKEN };
  delete process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_AUTH_TOKEN;
  const r = await runOnce(args, { cwd, timeoutMs: 90000 });
  if (prev.k) process.env.ANTHROPIC_API_KEY = prev.k; if (prev.t) process.env.ANTHROPIC_AUTH_TOKEN = prev.t;
  const ev = parseLines(r.stdout);
  save(`p37_${name}.jsonl`, r.stdout);
  const i = initOf(ev); const res = resultsOf(ev)[0];
  report[name] = { exit_code: r.code, apiKeySource: i?.apiKeySource, permissionMode: i?.permissionMode, n_tools: i?.tools?.length, tools_has_Agent: i?.tools?.includes('Agent'), n_skills: i?.skills?.length, n_mcp_servers: i?.mcp_servers?.length, mcp_server_names: (i?.mcp_servers || []).map((s) => s.name), n_plugins: i?.plugins?.length, n_agents: i?.agents?.length, slash_commands_n: i?.slash_commands?.length, memory_paths: i?.memory_paths ? Object.keys(i.memory_paths) : null, result: brief(res), non_json_stdout: ev.filter((e) => e.type === '_unparsed').slice(0, 2), stderr: r.stderr.slice(0, 300), api_retry: ev.filter((e) => e.subtype === 'api_retry').map((e) => ({ error: e.error, status: e.error_status })), assistant_text: ev.filter((e) => e.type === 'assistant').map((e) => (e.message?.content || []).map((b) => b.text).join('')).join('|').slice(0, 200) };
}
try {
  await run('default_p', ['--setting-sources', 'user']);
  await run('bare_p', ['--bare']);
  await run('bare_p_user_settings', ['--bare', '--setting-sources', 'user']);
  const help = await runOnce(['--help'], { cwd });
  report.help_bare_line = help.stdout.split('\n').filter((l) => /--bare/.test(l)).join(' ').slice(0, 200);
  const hv = await runOnce(['--version'], { cwd });
  report.version = hv.stdout.trim();
  const st = await runOnce(['auth', 'status'], { cwd, timeoutMs: 20000 });
  report.auth_status_method = (() => { try { const j = JSON.parse(st.stdout); return { loggedIn: j.loggedIn, authMethod: j.authMethod, apiProvider: j.apiProvider, subscriptionType: j.subscriptionType }; } catch { return { raw: st.stdout.slice(0, 120).replace(/\S+@\S+/g, '<email>') }; } })();
} catch (e) { report.error = String(e?.stack || e); }
save('p37_report.json', report);
cleanup(cwd);
console.log(JSON.stringify(report, null, 1).replace(/"(in|out|cache_read|cache_create)": \d+,?\n/g, ''));
