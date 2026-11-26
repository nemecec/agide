// README: node p16_mcp_timeout.mjs [case ...]  -- P16 (stream-json half): how long `claude -p` keeps a call to an HTTP MCP tool open. Each case starts p16_slow_mcp.mjs in-process, runs one haiku session in an empty directory under /tmp/agide-r21-probes/p16/, and records what the server saw (call start, progress, answered or closed by the client) and what the model saw. Cases differ in the server entry `timeout`, the MCP_TOOL_TIMEOUT variable, the reply mode (json: silent until the answer; sse: stream opens at once, optional progress) and an interrupt. At most 3 sessions run at once. Report: probes/out/p16_mcp_report.json.
import { mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { startStream, userMsg, resultsOf, initOf, save, OUT, sleep } from './lib.mjs';
import { startSlowMcp } from './p16_slow_mcp.mjs';

const ROOT = '/tmp/agide-r21-probes/p16';
const ARGS = ['--permission-mode', 'manual', '--strict-mcp-config', '--allowedTools', 'mcp__slow__slow_wait', '--settings', '{"disableAllHooks":true}'];

// [name, entry extras, env, tool args, options]
const CASES = {
  baseline_20s_json: [{}, {}, { seconds: 20, mode: 'json' }],
  noentry_65s_json: [{}, {}, { seconds: 65, mode: 'json' }],
  entry600k_65s_json: [{ timeout: 600000 }, {}, { seconds: 65, mode: 'json' }],
  env600k_65s_json: [{}, { MCP_TOOL_TIMEOUT: '600000' }, { seconds: 65, mode: 'json' }],
  entry600k_130s_json: [{ timeout: 600000 }, {}, { seconds: 130, mode: 'json' }],
  entry600k_310s_json: [{ timeout: 600000 }, {}, { seconds: 310, mode: 'json' }],
  entry100k_130s_json: [{ timeout: 100000 }, {}, { seconds: 130, mode: 'json' }],
  noentry_130s_sse: [{}, {}, { seconds: 130, mode: 'sse', progress_every_s: 0 }],
  noentry_330s_sse_silent: [{}, {}, { seconds: 330, mode: 'sse', progress_every_s: 0 }],
  noentry_330s_sse_progress: [{}, {}, { seconds: 330, mode: 'sse', progress_every_s: 60 }],
  entry100k_130s_sse_progress: [{ timeout: 100000 }, {}, { seconds: 130, mode: 'sse', progress_every_s: 20 }],
  fast_idle_sse_silent: [{}, { CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT: '15000' }, { seconds: 60, mode: 'sse', progress_every_s: 0 }, { settleS: 20 }],
  fast_wall_sse_progress: [{ timeout: 15000 }, {}, { seconds: 60, mode: 'sse', progress_every_s: 5 }, { settleS: 20 }],
  fast_wall_json: [{ timeout: 15000 }, {}, { seconds: 60, mode: 'json' }, { settleS: 20 }],
  interrupt_sse_entry600k_120s: [{ timeout: 600000 }, {}, { seconds: 120, mode: 'sse', progress_every_s: 0 }, { interruptAfterCallS: 15, settleS: 20 }],
  interrupt_entry600k_120s_json: [{ timeout: 600000 }, {}, { seconds: 120, mode: 'json' }, { interruptAfterCallS: 15, settleS: 12 }],
};
const GROUPS = {
  quick: ['baseline_20s_json', 'noentry_65s_json', 'entry600k_65s_json', 'env600k_65s_json', 'interrupt_entry600k_120s_json'],
  fast: ['fast_idle_sse_silent', 'fast_wall_sse_progress', 'fast_wall_json', 'interrupt_sse_entry600k_120s'],
  long: ['entry600k_130s_json', 'entry100k_130s_json', 'noentry_130s_sse', 'entry100k_130s_sse_progress', 'entry600k_310s_json', 'noentry_330s_sse_silent', 'noentry_330s_sse_progress'],
};

const prompt = (a) => `Call the slow_wait tool exactly once with seconds=${a.seconds}, mode="${a.mode}"${a.progress_every_s !== undefined ? `, progress_every_s=${a.progress_every_s}` : ''}. When it returns, reply with one short sentence that quotes the exact tool result text or error text verbatim. Do not call any other tool.`;

async function runCase(name) {
  const [entry, env, args, opts = {}] = CASES[name];
  const cwd = join(ROOT, name); rmSync(cwd, { recursive: true, force: true }); mkdirSync(cwd, { recursive: true });
  const logFile = join(OUT, `p16_${name}_server.jsonl`); try { rmSync(logFile); } catch {}
  const srv = await startSlowMcp({ logFile });
  const h = startStream([...ARGS, '--mcp-config', JSON.stringify(srv.config(entry))], { cwd, env });
  const t0 = Date.now();
  h.send(userMsg(prompt(args)));
  let interrupted = null;
  if (opts.interruptAfterCallS) {
    const start = await waitServer(srv, (e) => e.kind === 'call-start', 60000);
    if (start) {
      await sleep(opts.interruptAfterCallS * 1000);
      interrupted = { after_call_start_s: opts.interruptAfterCallS };
      h.send({ type: 'control_request', request_id: 'p16-int', request: { subtype: 'interrupt' } });
    }
  }
  const done = await h.waitResult(1, (args.seconds + 150) * 1000);
  const tEnd = Date.now();
  if (!done) h.kill('SIGKILL');
  // let the server notice a late close
  await sleep((opts.settleS ?? 2) * 1000);
  const ev = h.events;
  save(`p16_${name}.jsonl`, ev.map((e) => JSON.stringify(e)).join('\n'));
  const use = ev.find((e) => (e.message?.content || []).some((b) => b.type === 'tool_use' && b.name === 'mcp__slow__slow_wait'));
  const useId = (use?.message?.content || []).find((b) => b.type === 'tool_use' && b.name === 'mcp__slow__slow_wait')?.id;
  const resEv = ev.find((e) => (e.message?.content || []).some((b) => b.type === 'tool_result' && b.tool_use_id === useId));
  const tr = (resEv?.message?.content || []).find((b) => b.type === 'tool_result' && b.tool_use_id === useId);
  const r = resultsOf(ev)[0];
  const server = srv.events.filter((e) => e.kind !== 'connection');
  const out = {
    name, entry, env, args, finished: done, exit: h.exit, interrupted,
    claude_seconds_from_tool_use_to_tool_result: use && resEv ? Math.round((resEv._t - use._t) / 100) / 10 : null,
    claude_total_s: Math.round((tEnd - t0) / 100) / 10,
    tool_result: tr ? { is_error: !!tr.is_error, content: JSON.stringify(tr.content).slice(0, 400) } : null,
    result_subtype: r?.subtype, result_text: String(r?.result).slice(0, 300), terminal_reason: r?.terminal_reason, cost: r?.total_cost_usd,
    mcp_status: initOf(ev)?.mcp_servers,
    server_calls: server.filter((e) => e.kind === 'call-start' || e.kind === 'call-end').map(({ at_s, kind, how, after_s, seconds, mode, every, progressToken, meta }) => ({ at_s, kind, how, after_s, seconds, mode, every, progressToken, meta })),
    server_progress_sent: server.filter((e) => e.kind === 'progress-sent').length,
    server_notifications: server.filter((e) => e.kind === 'notification').map((e) => ({ at_s: e.at_s, method: e.method, params: e.params })),
    stderr: h.stderr.slice(0, 300),
  };
  await srv.close();
  try { h.kill('SIGKILL'); } catch {}
  rmSync(cwd, { recursive: true, force: true });
  console.log(name, JSON.stringify({ tool_result: out.tool_result, from_use_s: out.claude_seconds_from_tool_use_to_tool_result, server: out.server_calls.map((c) => `${c.kind}${c.how ? ':' + c.how : ''}@${c.at_s}`), progress: out.server_progress_sent, notes: out.server_notifications.map((n) => n.method) }));
  return out;
}

function waitServer(srv, pred, ms) {
  return new Promise((res) => {
    const end = Date.now() + ms;
    const iv = setInterval(() => { const e = srv.events.find(pred); if (e || Date.now() > end) { clearInterval(iv); res(e || null); } }, 100);
  });
}

const wanted = process.argv.slice(2).flatMap((a) => GROUPS[a] || [a]);
const names = wanted.length ? wanted : Object.keys(CASES);
const reportPath = join(OUT, 'p16_mcp_report.json');
const queue = [...names];
await Promise.all([0, 1, 2].map(async () => {
  while (queue.length) {
    const n = queue.shift();
    if (!CASES[n]) { console.log('unknown case', n); continue; }
    let result;
    try { result = await runCase(n); } catch (e) { result = { error: String(e) }; }
    const latest = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) : {};
    save('p16_mcp_report.json', { ...latest, [n]: result });
  }
}));
