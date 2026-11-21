// README: node p34_concurrency.mjs  -- P34 concurrency: three concurrent haiku agents with two tiny turns each on the subscription login; per-agent success, latencies, errors, rate_limit_event payloads and usage and cost fields. Haiku, budget-capped, fresh directories.
import { startStream, userMsg, resultsOf, initOf, save, sleep, fresh, cleanup, dump, brief } from './p_swarm_lib.mjs';

const N = 3;
const report = { agents: [] };
const t0 = Date.now();
async function agent(i) {
  const cwd = fresh(`p34-${i}-`);
  const ts = { start: Date.now() };
  const h = startStream(['--strict-mcp-config', '--settings', '{"disableAllHooks":true}'], { cwd });
  h.send(userMsg(`You are agent ${i}. Remember the number ${i}${i}${i}. Reply with just: stored`));
  await h.waitFor((e) => e.type === 'system' && e.subtype === 'init', 30000); ts.init = Date.now();
  await h.waitResult(1, 90000); ts.turn1 = Date.now();
  h.send(userMsg('Which number did I tell you? Reply with digits only.'));
  await h.waitResult(2, 90000); ts.turn2 = Date.now();
  await h.end(); dump(`p34_agent${i}`, h);
  const rs = resultsOf(h.events);
  const rl = h.events.filter((e) => e.type === 'rate_limit_event');
  cleanup(cwd);
  return { agent: i, spawn_to_init_ms: ts.init - ts.start, turn1_ms: ts.turn1 - ts.start, turn2_ms: ts.turn2 - ts.turn1, wall_ms: ts.turn2 - ts.start, exit: h.exit, stderr: h.stderr.slice(0, 200), results: rs.map(brief), recalled: new RegExp(`${i}${i}${i}`).test(rs[1]?.result || ''), rate_limit_events: rl.map((e) => ({ keys: Object.keys(e).filter((k) => k !== '_t'), info: e.rate_limit_info, uuid: e.uuid ? '(present)' : null })), error_events: h.events.filter((e) => e.type === 'system' && /error|retry/.test(e.subtype || '')).map((e) => ({ subtype: e.subtype, error: e.error, error_status: e.error_status, attempt: e.attempt })), api_retry_n: h.events.filter((e) => e.subtype === 'api_retry').length, session_id: rs[0]?.session_id };
}
report.agents = await Promise.all(Array.from({ length: N }, (_, i) => agent(i + 1)));
report.total_wall_ms = Date.now() - t0;
report.distinct_sessions = new Set(report.agents.map((a) => a.session_id)).size;
report.cost_sum_usd = report.agents.flatMap((a) => a.results.map((r) => r.cost)).reduce((s, c) => s + (c || 0), 0);
save('p34_report.json', report);
console.log(JSON.stringify(report, null, 1).replace(/"(in|out|cache_read|cache_create)": \d+,?\n/g, ''));
