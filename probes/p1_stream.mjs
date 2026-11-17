// README: node p1_stream.mjs [multi|session|image|init|interrupt|all]  -- P1 stream-json probes against the real claude CLI (haiku, budget-capped, hooks disabled).
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { startStream, userMsg, initOf, resultsOf, text, save, sleep, NOHOOKS, WORK, CLAUDE, runOnce, parseLines, BASE } from './lib.mjs';

const which = process.argv[2] || 'all';
const report = {};
const brief = (r) => r && ({ subtype: r.subtype, is_error: r.is_error, result: String(r.result ?? '').slice(0, 120), session_id: r.session_id, cost: r.total_cost_usd, num_turns: r.num_turns, usage: { in: r.usage?.input_tokens, out: r.usage?.output_tokens, cache_read: r.usage?.cache_read_input_tokens, cache_create: r.usage?.cache_creation_input_tokens }, terminal_reason: r.terminal_reason, duration_ms: r.duration_ms, stop_reason: r.stop_reason });
const dump = (n, h) => save(n + '.jsonl', h.events.map((e) => JSON.stringify(e)).join('\n'));
const transcriptPath = (sid) => {
  const base = join(process.env.CLAUDE_CONFIG_DIR || join(process.env.HOME, '.claude'), 'projects');
  for (const d of readdirSync(base)) { const p = join(base, d, sid + '.jsonl'); if (existsSync(p)) return p; }
  return null;
};

async function multi() {
  const h = startStream(['--strict-mcp-config', ...NOHOOKS]);
  h.send(userMsg('Remember the number 7421. Reply with just: stored'));
  await h.waitResult(1);
  h.send(userMsg('Which number did I ask you to remember? Reply with digits only.'));
  await h.waitResult(2);
  await h.end(); dump('p1_multi', h);
  const rs = resultsOf(h.events);
  report.multi = { turns_results: rs.map(brief), same_session: new Set(rs.map((r) => r.session_id)).size === 1, answer_has_7421: String(rs[1]?.result).includes('7421'), init_count: h.events.filter((e) => e.subtype === 'init').length, cost_cumulative: rs.map((r) => r.total_cost_usd), stderr: h.stderr.slice(0, 300), exit: h.exit };
}

async function session() {
  const sid = randomUUID();
  const a = startStream(['--strict-mcp-config', '--session-id', sid, ...NOHOOKS]);
  a.send(userMsg('Remember the word PELICAN. Reply with just: stored'));
  await a.waitResult(1); await a.end(); dump('p1_session_a', a);
  const ia = initOf(a.events);
  const tp = transcriptPath(sid);
  // resume, text answer
  const b = startStream(['--strict-mcp-config', '--resume', sid, ...NOHOOKS]);
  b.send(userMsg('Which word did I ask you to remember? One word.'));
  await b.waitResult(1); await b.end(); dump('p1_session_b', b);
  const ib = initOf(b.events);
  // resume with fork
  const c = startStream(['--strict-mcp-config', '--resume', sid, '--fork-session', ...NOHOOKS]);
  c.send(userMsg('Which word did I ask you to remember? One word.'));
  await c.waitResult(1); await c.end(); dump('p1_session_c', c);
  const ic = initOf(c.events);
  // unknown session id
  const d = startStream(['--strict-mcp-config', '--resume', randomUUID(), ...NOHOOKS]);
  d.send(userMsg('hi'));
  await d.waitResult(1, 20000); await d.end(); dump('p1_session_d', d);
  report.session = {
    requested_id: sid, init_session_id_matches: ia?.session_id === sid, transcript_file: tp && tp.replace(process.env.HOME, '~'),
    resume: { init_session_id_same: ib?.session_id === sid, result: brief(resultsOf(b.events)[0]), recalled: /pelican/i.test(resultsOf(b.events)[0]?.result || '') },
    fork: { new_id: ic?.session_id !== sid, result: brief(resultsOf(c.events)[0]), recalled: /pelican/i.test(resultsOf(c.events)[0]?.result || '') },
    resume_unknown: { events: d.events.map((e) => e.type + ':' + (e.subtype || '')), stderr: d.stderr.slice(0, 300), exit: d.exit, result: brief(resultsOf(d.events)[0]) },
  };
}

async function image() {
  const data = readFileSync(new URL('./fixtures/halves.png', import.meta.url)).toString('base64');
  const h = startStream(['--strict-mcp-config', ...NOHOOKS]);
  h.send({ type: 'user', message: { role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data } }, { type: 'text', text: 'What colour is the left half and what colour is the right half of this image? Answer as: left=<colour>, right=<colour>.' }] } });
  await h.waitResult(1); await h.end(); dump('p1_image', h);
  const r = resultsOf(h.events)[0];
  report.image = { result: brief(r), correct: /left=blue/i.test(r?.result || '') && /right=red/i.test(r?.result || ''), stderr: h.stderr.slice(0, 300) };
}

async function init() {
  const h = startStream(['--strict-mcp-config', ...NOHOOKS]);
  h.send(userMsg('say ok'));
  await h.waitResult(1); await h.end();
  const i = initOf(h.events);
  report.init = { keys: Object.keys(i).filter((k) => k !== '_t'), tools: i.tools, mcp_servers: i.mcp_servers, mcp_server_errors: i.mcp_server_errors ?? '(absent)', permissionMode: i.permissionMode, apiKeySource: i.apiKeySource, plugins: i.plugins?.map((p) => p.source), skills_n_listed: i.skills?.length, skills_sample: i.skills?.slice(0, 8), capabilities: i.capabilities, memory_paths: i.memory_paths, messaging_socket_path: i.messaging_socket_path ? '(present)' : null };
}

async function interrupt() {
  const long = 'Write the numbers from 1 to 600, one per line, each followed by a distinct short English sentence about that number. Do not stop early.';
  // (a) control_request interrupt
  const h = startStream(['--strict-mcp-config', ...NOHOOKS]);
  h.send(userMsg(long));
  await h.waitFor((e) => e.type === 'stream_event' && e.event?.type === 'content_block_delta');
  await sleep(1500);
  const tI = Date.now();
  h.send({ type: 'control_request', request_id: 'int-1', request: { subtype: 'interrupt' } });
  const cr = await h.waitFor((e) => e.type === 'control_response', 15000);
  await h.waitResult(1, 30000);
  const r1 = resultsOf(h.events)[0];
  const tAfter = r1 ? r1._t - tI : null;
  h.send(userMsg('Reply with just: alive'));
  await h.waitResult(2, 60000);
  await h.end(); dump('p1_interrupt_ctl', h);
  const rs = resultsOf(h.events);
  report.interrupt_control = { control_response: cr && { response: cr.response }, first_result: brief(r1), ms_from_interrupt_to_result: tAfter, second_result: brief(rs[1]), process_alive_for_second_turn: /alive/i.test(rs[1]?.result || ''), stderr: h.stderr.slice(0, 300) };
  // (b) SIGINT
  const g = startStream(['--strict-mcp-config', ...NOHOOKS]);
  g.send(userMsg(long));
  await g.waitFor((e) => e.type === 'stream_event' && e.event?.type === 'content_block_delta');
  await sleep(1500);
  const t0 = Date.now();
  g.kill('SIGINT');
  const ended = await Promise.race([g.closed, sleep(15000).then(() => 'still-running')]);
  const beforeKill = g.events.filter((e) => e.type === 'result').length;
  if (ended === 'still-running') { g.send(userMsg('Reply with just: alive')); await g.waitResult(beforeKill + 1, 30000); }
  const stillAlive = g.exit === null;
  if (stillAlive) g.kill('SIGTERM');
  await Promise.race([g.closed, sleep(5000)]);
  dump('p1_interrupt_sigint', g);
  report.interrupt_sigint = { exit_after_sigint: ended === 'still-running' ? null : ended, ms_to_exit: ended === 'still-running' ? null : Date.now() - t0, results_after_sigint: resultsOf(g.events).map(brief), events_tail: g.events.slice(-4).map((e) => e.type + ':' + (e.subtype || '')), stderr: g.stderr.slice(0, 300), alive_after_sigint: ended === 'still-running' };
}

const steps = { multi, session, image, init, interrupt };
for (const [k, f] of Object.entries(steps)) if (which === 'all' || which === k) { try { await f(); } catch (e) { report[k] = { error: String(e?.stack || e) }; } }
save(`p1_report_${which}.json`, report);
console.log(JSON.stringify(report, null, 1));
