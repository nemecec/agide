// README: node p30_stream_agent.mjs  -- P30 stream-json agent under -p: several user turns on stdin, tool use, --permission-prompt-tool stdio with allow, deny, updatedInput and a delayed answer. Haiku, budget-capped, fresh directory.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startStream, userMsg, resultsOf, initOf, save, sleep, fresh, cleanup, dump, brief, answerPrompts, toolUses, toolResults } from './p_swarm_lib.mjs';

const cwd = fresh('p30-');
const report = { cwd: 'probes/work/(fresh)' };
const h = startStream(['--permission-mode', 'manual', '--permission-prompt-tool', 'stdio', '--strict-mcp-config', '--settings', '{"disableAllHooks":true}', '--tools', 'Write,Read,Bash'], { cwd });
let mode = 'allow';
let held = false;
const ans = answerPrompts(h, (req) => {
  if (mode === 'hold') { if (!held) held = true; return null; }
  if (mode === 'allow') return { behavior: 'allow', updatedInput: req.input };
  if (mode === 'deny') return { behavior: 'deny', message: 'The host refuses this write. Tell the user it was refused.' };
  if (mode === 'rewrite') return { behavior: 'allow', updatedInput: { ...req.input, content: 'REWRITTEN BY HOST\n' } };
});
const turn = async (n, text, ms = 90000) => { const before = h.events.length; h.send(userMsg(text)); const ok = await h.waitResult(n, ms); return { ok, from: before }; };
const read = (f) => (existsSync(join(cwd, f)) ? readFileSync(join(cwd, f), 'utf8') : null);

try {
  mode = 'allow';
  await turn(1, 'Use the Write tool to create a.txt with the content "one". Then reply: done-a');
  const afterT1 = h.events.length;
  mode = 'deny';
  await turn(2, 'Use the Write tool to create b.txt with the content "two". If the tool is refused, say exactly what the refusal message said. Reply starting with: done-b');
  const afterT2 = h.events.length;
  mode = 'rewrite';
  await turn(3, 'Use the Write tool to create c.txt with the content "three". Then use Read to read c.txt and tell me its exact content.');
  const afterT3 = h.events.length;
  // pending request: do not answer for 60 s
  mode = 'hold';
  const tHold = Date.now();
  h.send(userMsg('Use the Write tool to create d.txt with the content "four". Then reply: done-d'));
  const req = await h.waitFor((e) => e.type === 'control_request' && e.request?.tool_name === 'Write' && e.request?.input?.file_path?.endsWith('d.txt'), 60000);
  await sleep(60000);
  const stillPending = resultsOf(h.events).length === 3 && h.exit === null;
  const quietEvents = h.events.filter((e) => e._t > req._t && e.type !== 'control_request').map((e) => e.type + ':' + (e.subtype || e.event?.type || ''));
  mode = 'allow';
  const waited = Date.now() - tHold;
  await h.waitResult(4, 60000);
  await sleep(300);
  const rs = resultsOf(h.events);
  const firstReq = h.events.find((e) => e.type === 'control_request' && e.request?.subtype === 'can_use_tool');
  report.can_use_tool_payload = { envelope_keys: Object.keys(firstReq).filter((k) => k !== '_t'), request_keys: Object.keys(firstReq.request), tool_name: firstReq.request.tool_name, input_keys: Object.keys(firstReq.request.input), permission_suggestions: firstReq.request.permission_suggestions, decision_reason: firstReq.request.decision_reason, title: firstReq.request.title, display_name: firstReq.request.display_name, description: firstReq.request.description, blocked_path: firstReq.request.blocked_path, tool_use_id: firstReq.request.tool_use_id, agent_id: firstReq.request.agent_id };
  report.turns = rs.map(brief);
  report.same_session_all_turns = new Set(rs.map((r) => r.session_id)).size === 1;
  report.init_count = h.events.filter((e) => e.type === 'system' && e.subtype === 'init').length;
  report.files = { a: read('a.txt'), b: read('b.txt'), c: read('c.txt'), d: read('d.txt') };
  const deniedResult = toolResults(h.events.slice(afterT1, afterT2));
  report.deny = { tool_result_seen_by_agent: deniedResult, permission_denials_in_result: rs[1]?.permission_denials, agent_final_text: rs[1]?.result };
  report.updated_input = { c_txt: read('c.txt'), agent_read_back: rs[2]?.result };
  report.pending = { request_arrived_at_offset_ms: req._t - tHold, still_pending_after_60s_no_answer: stillPending, process_alive: h.exit === null, events_while_waiting: quietEvents, answered_after_ms: waited, turn4_result: brief(rs[3]), d_txt: read('d.txt') };
  report.answers = ans.seen.map((s) => ({ tool_name: s.tool_name, behavior: s.answer.behavior, latency_ms: s.answered_t - s.t }));
  report.tool_uses = toolUses(h.events).map((u) => u.name + ' ' + JSON.stringify(u.input).slice(0, 80));
} catch (e) { report.error = String(e?.stack || e); }
ans.stop(); h.kill('SIGTERM'); await Promise.race([h.closed, sleep(5000)]);
dump('p30_stream_agent', h);
report.stderr = h.stderr.slice(0, 300);
save('p30_report.json', report);
cleanup(cwd);
console.log(JSON.stringify(report, null, 1));
