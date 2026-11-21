// README: node p33_resume.mjs  -- P33 resume: --session-id and --resume with stream-json after the process is killed (SIGKILL after a finished turn and in the middle of a running tool), where the session file lives under CLAUDE_CONFIG_DIR, whether context continues, reuse of a live or finished session id, resume from another directory. Haiku, budget-capped, fresh directories.
import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { startStream, userMsg, resultsOf, initOf, save, sleep, fresh, cleanup, dump, brief, answerPrompts } from './p_swarm_lib.mjs';

const CFG = process.env.CLAUDE_CONFIG_DIR || join(process.env.HOME, '.claude');
const ARGS = ['--permission-mode', 'manual', '--permission-prompt-tool', 'stdio', '--strict-mcp-config', '--settings', '{"disableAllHooks":true}', '--tools', 'Bash,Write'];
const report = { config_dir_is_env: !!process.env.CLAUDE_CONFIG_DIR };
const findFile = (sid) => { const base = join(CFG, 'projects'); for (const d of readdirSync(base)) { const p = join(base, d, sid + '.jsonl'); if (existsSync(p)) return { dir: d, p }; } return null; };
const lines = (p) => readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return { type: '_bad' }; } });
const relDir = (d) => d.replace(/^-.*?probes-work-/, '<cwd encoded: ...-probes-work-').replace(/p33-[A-Za-z0-9]+/, 'p33-xxxxxx');

async function run(name, { sid, resume, cwd, prompt, mode = 'allow', extra = [], waitFor, killAfter, noMsgFirst }) {
  const a = [...ARGS, ...extra];
  if (sid) a.push('--session-id', sid);
  if (resume) a.push('--resume', resume);
  const h = startStream(a, { cwd });
  const ans = answerPrompts(h, (r) => ({ behavior: 'allow', updatedInput: r.input }));
  const t0 = Date.now();
  if (noMsgFirst) await sleep(noMsgFirst);
  const earlyEvents = h.events.map((e) => e.type + ':' + (e.subtype || ''));
  h.send(userMsg(prompt));
  let killed = null;
  if (waitFor) { await h.waitFor(waitFor, 60000); await sleep(1200); h.kill('SIGKILL'); killed = true; await Promise.race([h.closed, sleep(5000)]); }
  else { await h.waitResult(1, 60000); }
  const r = resultsOf(h.events)[0];
  if (killAfter) { h.kill('SIGKILL'); killed = true; }
  else if (!killed) { try { h.child.stdin.end(); } catch {} }
  await Promise.race([h.closed, sleep(8000)]);
  if (h.exit === null) h.kill('SIGKILL');
  ans.stop(); dump(`p33_${name}`, h);
  const init = initOf(h.events);
  return { name, killed, init_session_id: init?.session_id, result: brief(r), early_events_before_user_message: earlyEvents, ms_to_first_event: h.events[0] ? h.events[0]._t - t0 : null, stderr: h.stderr.slice(0, 300), exit: h.exit, events: h.events.map((e) => e.type + ':' + (e.subtype || '')).filter((v, i, arr) => arr.indexOf(v) === i).slice(0, 14) };
}

const cwd = fresh('p33-'); const cwd2 = fresh('p33-other-');
try {
  // 1 kill after a finished turn
  const sid = randomUUID();
  report.a_first = await run('a_first', { sid, cwd, prompt: 'Remember the codeword TANGERINE-7. Reply with just: stored', killAfter: true });
  const f = findFile(sid);
  const ls = f && lines(f.p);
  report.session_file = f && { relative: `<config dir>/projects/${relDir(f.dir)}/<session-id>.jsonl`, project_dir_name_rule: 'absolute cwd with each / and . replaced by -', exists_after_sigkill: true, entry_types: [...new Set(ls.map((l) => l.type))], line_count_nonzero: ls.length > 0, has_user_text: JSON.stringify(ls).includes('TANGERINE-7') };
  report.a_resume = await run('a_resume', { resume: sid, cwd, prompt: 'What was the codeword? Reply with just the codeword.' });
  report.a_resume.recalled = /TANGERINE-7/.test(report.a_resume.result?.result || '');
  report.a_resume.same_session_id = report.a_resume.init_session_id === sid;
  const ls2 = lines(findFile(sid).p);
  report.a_resume.file_grew = ls2.length > ls.length;
  // session id reuse by --session-id on an existing session (no --resume)
  report.reuse_session_id = await run('reuse', { sid, cwd, prompt: 'What was the codeword? If you do not know, reply: unknown' });
  report.reuse_session_id.recalled = /TANGERINE-7/.test(report.reuse_session_id.result?.result || '');
  // resume from another directory
  report.resume_other_cwd = await run('other_cwd', { resume: sid, cwd: cwd2, prompt: 'What was the codeword? If you do not know, reply: unknown' });
  report.resume_other_cwd.recalled = /TANGERINE-7/.test(report.resume_other_cwd.result?.result || '');
  // 2 kill in the middle of a running tool
  const sid2 = randomUUID();
  report.b_first = await run('b_first', { sid: sid2, cwd, prompt: 'Remember the codeword KUMQUAT-3. Then run this Bash command and wait: python3 -c "import time; time.sleep(60)"', waitFor: (e) => e.type === 'assistant' && (e.message?.content || []).some((b) => b.type === 'tool_use' && b.name === 'Bash') });
  const f2 = findFile(sid2); const l2 = f2 && lines(f2.p);
  report.b_file = f2 && { entry_types: [...new Set(l2.map((l) => l.type))], last_entry_type: l2.at(-1)?.type, has_codeword: JSON.stringify(l2).includes('KUMQUAT-3'), last_content_block_types: (l2.at(-1)?.message?.content || []).map?.((b) => b.type) };
  report.b_resume = await run('b_resume', { resume: sid2, cwd, prompt: 'What was the codeword, and did the Bash command finish? Answer briefly.' });
  report.b_resume.recalled = /KUMQUAT-3/.test(report.b_resume.result?.result || '');
  // 3 resume while another process still holds the session
  const sid3 = randomUUID();
  const live = startStream([...ARGS, '--session-id', sid3], { cwd });
  live.send(userMsg('Remember the codeword LYCHEE-9. Reply: stored')); await live.waitResult(1, 60000);
  const second = await run('live_resume', { resume: sid3, cwd, prompt: 'What was the codeword?' });
  report.resume_while_live = { second_init_session_id_same: second.init_session_id === sid3, second_result: second.result, recalled: /LYCHEE-9/.test(second.result?.result || ''), stderr: second.stderr };
  live.kill('SIGKILL'); await Promise.race([live.closed, sleep(3000)]); dump('p33_live_first', live);
} catch (e) { report.error = String(e?.stack || e); }
save('p33_report.json', report);
cleanup(cwd); cleanup(cwd2);
console.log(JSON.stringify(report, null, 1).replace(/"(in|out|cache_read|cache_create)": \d+,?\n/g, ''));
