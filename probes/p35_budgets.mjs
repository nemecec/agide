// README: node p35_budgets.mjs  -- P35 budgets: what the host receives when --max-budget-usd or --max-turns is reached under -p (stream-json and plain json): result subtype, errors, exit code, whether the process accepts the next user message, whether the limit is per turn or per process. Haiku, tiny caps, fresh directories.
import { startStream, userMsg, resultsOf, save, sleep, fresh, cleanup, dump, brief, answerPrompts, toolUses } from './p_swarm_lib.mjs';
import { runOnce, parseLines } from './lib.mjs';

const report = {};
const SAFE = ['--strict-mcp-config', '--settings', '{"disableAllHooks":true}', '--tools', 'Bash,Write', '--permission-mode', 'acceptEdits'];

async function stream(name, args, prompts, { closeStdin = true, waitEach = 60000 } = {}) {
  const cwd = fresh('p35-');
  const h = startStream([...SAFE, ...args], { cwd });
  const ans = answerPrompts(h, (r) => ({ behavior: 'allow', updatedInput: r.input }));
  const out = [];
  for (let i = 0; i < prompts.length; i++) {
    if (h.exit) { out.push({ turn: i + 1, skipped: 'process already exited' }); continue; }
    const t = Date.now();
    h.send(userMsg(prompts[i]));
    const ok = await h.waitResult(i + 1, waitEach);
    out.push({ turn: i + 1, got_result: ok, ms: Date.now() - t, result: brief(resultsOf(h.events)[i]) });
  }
  if (closeStdin) await Promise.race([h.end(), sleep(8000)]);
  await sleep(500);
  const alive = h.exit === null;
  if (alive) h.kill('SIGTERM');
  await Promise.race([h.closed, sleep(5000)]);
  ans.stop(); dump(`p35_${name}`, h);
  report[name] = { args, turns: out, process_alive_after_turns: alive, exit: h.exit, stderr: h.stderr.slice(0, 300), tool_calls: toolUses(h.events).length, tail_events: h.events.slice(-3).map((e) => e.type + ':' + (e.subtype || '')) };
  cleanup(cwd);
}

const only = process.argv[2];
try {
  if (only === 'after_budget') {
    await stream('budget_then_next_message', ['--max-budget-usd', '0.00025'], ['Reply with just: a', 'Reply with just: b', 'Reply with just: c'], { closeStdin: false });
    save('p35_report_after_budget.json', report); console.log(JSON.stringify(report, null, 1).slice(0, 3000)); process.exit(0);
  }
  const task = 'Use the Bash tool to run "echo one", then run "echo two", then run "echo three", then reply with a one-line summary.';
  await stream('max_turns_1_stream', ['--max-turns', '1'], [task, 'Reply with just: after-limit']);
  await stream('max_turns_2_stream', ['--max-turns', '2'], [task]);
  await stream('max_turns_per_turn_or_process', ['--max-turns', '2'], ['Reply with just: a', 'Reply with just: b', 'Reply with just: c']);
  // a budget lower than one request costs; the CLI's estimate is checked after each API response
  await stream('budget_tiny_stream', ['--max-budget-usd', '0.0005'], [task, 'Reply with just: after-limit']);
  await stream('budget_second_turn', ['--max-budget-usd', '0.004'], ['Reply with just: a', 'Reply with just: b', 'Reply with just: c', 'Reply with just: d']);
  // plain json, exit code seen by a wrapper
  const cwd = fresh('p35-json-');
  const r = await runOnce(['-p', task, '--output-format', 'json', '--model', 'haiku', '--max-turns', '1', '--setting-sources', 'user', '--strict-mcp-config', ...SAFE.slice(1)], { cwd, timeoutMs: 90000 });
  const j = (() => { try { return JSON.parse(r.stdout); } catch { return null; } })();
  report.max_turns_1_plain_json = { exit_code: r.code, sig: r.sig, subtype: j?.subtype, is_error: j?.is_error, errors: j?.errors, num_turns: j?.num_turns, terminal_reason: j?.terminal_reason, stderr: r.stderr.slice(0, 300), stdout_first: r.stdout.slice(0, 200) };
  const r2 = await runOnce(['-p', task, '--output-format', 'json', '--model', 'haiku', '--max-budget-usd', '0.0005', '--setting-sources', 'user', ...SAFE], { cwd, timeoutMs: 90000 });
  const j2 = (() => { try { return JSON.parse(r2.stdout); } catch { return null; } })();
  report.budget_tiny_plain_json = { exit_code: r2.code, subtype: j2?.subtype, is_error: j2?.is_error, errors: j2?.errors, total_cost_usd: j2?.total_cost_usd, terminal_reason: j2?.terminal_reason, stderr: r2.stderr.slice(0, 300) };
  cleanup(cwd);
} catch (e) { report.error = String(e?.stack || e); }
save('p35_report.json', report);
console.log(JSON.stringify(report, null, 1).replace(/"(usage|modelUsage)": \{[^}]*(\{[^}]*\}[^}]*)?\},?\n/g, '').replace(/"(in|out|cache_read|cache_create)": \d+,?\n/g, ''));
