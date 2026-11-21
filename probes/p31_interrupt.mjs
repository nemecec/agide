// README: node p31_interrupt.mjs  -- P31 interrupt: the interrupt control_request in the middle of text generation, during a running Bash tool and during a pending can_use_tool request, whether the next user message works afterwards, and SIGINT for comparison. Haiku, budget-capped, fresh directories.
import { startStream, userMsg, resultsOf, save, sleep, fresh, cleanup, dump, brief, control, answerPrompts, toolResults } from './p_swarm_lib.mjs';

const LONG = 'Write the numbers from 1 to 600, one per line, each followed by a distinct short English sentence about that number. Do not stop early.';
const ARGS = ['--permission-mode', 'manual', '--permission-prompt-tool', 'stdio', '--strict-mcp-config', '--settings', '{"disableAllHooks":true}', '--tools', 'Bash,Write'];
const report = {};
const tail = (h, n = 6) => h.events.slice(-n).map((e) => e.type + ':' + (e.subtype || e.event?.type || ''));

async function scenario(name, { prompt, waitFor, allow = true, via = 'control' }) {
  const cwd = fresh('p31-');
  const h = startStream(ARGS, { cwd });
  const ans = answerPrompts(h, (r) => (allow ? { behavior: 'allow', updatedInput: r.input } : null));
  h.send(userMsg(prompt));
  await h.waitFor(waitFor, 60000);
  await sleep(1500);
  const t0 = Date.now();
  let ctl = null;
  if (via === 'control') ctl = await control(h, { subtype: 'interrupt' }, 15000);
  else h.kill('SIGINT');
  await h.waitResult(1, 30000);
  const r1 = resultsOf(h.events)[0];
  const msToResult = r1 ? r1._t - t0 : null;
  let second = null;
  if (h.exit === null) {
    // a pending request that survived the interrupt is answered so the next turn can run
    ans.stop(); const ans2 = answerPrompts(h, (r) => ({ behavior: 'allow', updatedInput: r.input }));
    h.send(userMsg('Reply with just: alive'));
    await h.waitResult(2, 45000);
    second = brief(resultsOf(h.events)[1]); ans2.stop();
  }
  ans.stop();
  const exitedByItself = h.exit !== null;
  if (h.exit === null) h.kill('SIGTERM');
  await Promise.race([h.closed, sleep(5000)]);
  dump(`p31_${name}`, h);
  report[name] = { via, control_response: ctl && { ms: ctl.ms, response: ctl.response }, ms_from_interrupt_to_result: msToResult, first_result: brief(r1), exited_after_interrupt: via === 'sigint' ? exitedByItself : null, second_turn_result: second, next_turn_works: /alive/i.test(second?.result || ''), tool_results: toolResults(h.events), events_tail: tail(h), stderr: h.stderr.slice(0, 200), exit: h.exit };
  cleanup(cwd);
}

const only = process.argv[2];
const isDelta = (e) => e.type === 'stream_event' && e.event?.type === 'content_block_delta';
const isBashRunning = (e) => e.type === 'assistant' && (e.message?.content || []).some((b) => b.type === 'tool_use' && b.name === 'Bash');
try {
  if (!only || only === 'mid_text_control') await scenario('mid_text_control', { prompt: LONG, waitFor: isDelta });
  if (!only || only === 'mid_bash_control') await scenario('mid_bash_control', { prompt: 'Run this exact Bash command and wait for it: python3 -c "import time; time.sleep(40); print(1)"', waitFor: isBashRunning });
  if (!only || only === 'pending_permission_control') await scenario('pending_permission_control', { prompt: 'Use the Write tool to create a.txt with the content "one".', waitFor: (e) => e.type === 'control_request' && e.request?.subtype === 'can_use_tool', allow: false });
  if (!only || only === 'mid_text_sigint') await scenario('mid_text_sigint', { prompt: LONG, waitFor: isDelta, via: 'sigint' });
} catch (e) { report.error = String(e?.stack || e); }
save(`p31_report${only ? '_' + only : ''}.json`, report);
console.log(JSON.stringify(report, null, 1));
