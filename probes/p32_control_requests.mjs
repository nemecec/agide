// README: node p32_control_requests.mjs  -- P32 control requests the CLI accepts on stdin under -p stream-json: a list of subtypes taken from the CLI binary and the SDK reference, each sent with the smallest plausible payload; reports answered, success or error text. Also stop_task on a real background Bash task. Haiku, budget-capped, fresh directory.
import { startStream, userMsg, resultsOf, save, sleep, fresh, cleanup, dump, brief, control, answerPrompts } from './p_swarm_lib.mjs';

const cwd = fresh('p32-');
const h = startStream(['--permission-mode', 'manual', '--permission-prompt-tool', 'stdio', '--strict-mcp-config', '--settings', '{"disableAllHooks":true}', '--tools', 'Bash,Read'], { cwd });
const ans = answerPrompts(h, (r) => ({ behavior: 'allow', updatedInput: r.input }));
const report = { requests: {} };
const short = (r) => ({ answered: r.answered, ms: r.ms, subtype: r.response?.subtype, error: r.response?.error, keys: r.response?.response ? Object.keys(r.response.response) : undefined, sample: r.response?.response ? JSON.stringify(r.response.response).slice(0, 260) : undefined });
const ask = async (name, request) => { report.requests[name] = short(await control(h, request)); };

try {
  // before any user message
  await ask('initialize_before_turn', { subtype: 'initialize' });
  await ask('mcp_status_before_turn', { subtype: 'mcp_status' });
  h.send(userMsg('Start this command with the Bash tool using run_in_background true: python3 -c "import time; time.sleep(90)". Then reply: started'));
  const ts = await h.waitFor((e) => e.type === 'system' && e.subtype === 'task_started', 60000);
  await h.waitResult(1, 60000);
  report.task_started = ts && { keys: Object.keys(ts).filter((k) => k !== '_t'), task_type: ts.task_type, task_id_shape: typeof ts.task_id };
  const taskId = ts?.task_id;
  await ask('get_task_output', { subtype: 'get_task_output', task_id: taskId });
  await ask('stop_task_unknown_id', { subtype: 'stop_task', task_id: 'does-not-exist' });
  await ask('stop_task_real', { subtype: 'stop_task', task_id: taskId });
  await sleep(1500);
  report.after_stop_task = h.events.filter((e) => e.type === 'system' && /task|background/.test(e.subtype || '')).slice(-4).map((e) => ({ subtype: e.subtype, status: e.status || e.patch?.status, task_id: e.task_id }));
  await ask('set_permission_mode_acceptEdits', { subtype: 'set_permission_mode', mode: 'acceptEdits' });
  await ask('set_permission_mode_invalid', { subtype: 'set_permission_mode', mode: 'nonsense' });
  await ask('set_model_sonnet', { subtype: 'set_model', model: 'sonnet' });
  await ask('set_model_invalid', { subtype: 'set_model', model: 'not-a-model' });
  await ask('set_model_back_to_haiku', { subtype: 'set_model', model: 'haiku' });
  await ask('set_max_thinking_tokens', { subtype: 'set_max_thinking_tokens', max_thinking_tokens: 0 });
  await ask('mcp_status', { subtype: 'mcp_status' });
  await ask('mcp_set_servers_empty', { subtype: 'mcp_set_servers', servers: {} });
  await ask('mcp_toggle_unknown', { subtype: 'mcp_toggle', serverName: 'nope', enabled: false });
  await ask('mcp_reconnect_unknown', { subtype: 'mcp_reconnect', serverName: 'nope' });
  await ask('get_context_usage', { subtype: 'get_context_usage' });
  await ask('get_session_cost', { subtype: 'get_session_cost' });
  await ask('get_usage', { subtype: 'get_usage' });
  await ask('get_status', { subtype: 'get_status' });
  await ask('get_settings', { subtype: 'get_settings' });
  await ask('list_models', { subtype: 'list_models' });
  await ask('list_permission_rules', { subtype: 'list_permission_rules' });
  await ask('get_hooks_listing', { subtype: 'get_hooks_listing' });
  await ask('get_workspace_diff', { subtype: 'get_workspace_diff' });
  await ask('get_plan', { subtype: 'get_plan' });
  await ask('apply_flag_settings', { subtype: 'apply_flag_settings', settings: {} });
  await ask('reload_plugins', { subtype: 'reload_plugins' });
  await ask('reload_skills', { subtype: 'reload_skills' });
  await ask('rewind_files_unknown_message', { subtype: 'rewind_files', user_message_id: 'unknown', dry_run: true });
  await ask('cancel_async_message_unknown', { subtype: 'cancel_async_message', message_uuid: 'unknown' });
  await ask('side_question', { subtype: 'side_question', question: 'Reply with the word: pong' });
  await ask('generate_session_title', { subtype: 'generate_session_title', description: 'a probe' });
  await ask('rename_session', { subtype: 'rename_session', title: 'probe' });
  await ask('seed_read_state', { subtype: 'seed_read_state', path: 'a.txt', mtime: 0 });
  await ask('set_cwd', { subtype: 'set_cwd', cwd });
  await ask('bogus_subtype', { subtype: 'definitely_not_a_request' });
  // effect checks: does the changed mode and model show up in the next turn?
  h.send(userMsg('Reply with just: ok'));
  await h.waitResult(2, 60000);
  const init2 = h.events.filter((e) => e.type === 'system' && e.subtype === 'init').at(-1);
  report.next_init_after_changes = { permissionMode: init2?.permissionMode, model: init2?.model };
  report.results = resultsOf(h.events).map(brief);
  await ask('end_session', { subtype: 'end_session' });
  await Promise.race([h.closed, sleep(5000)]);
  report.exit_after_end_session = h.exit;
} catch (e) { report.error = String(e?.stack || e); }
ans.stop();
if (h.exit === null) h.kill('SIGTERM');
await Promise.race([h.closed, sleep(5000)]);
dump('p32_control_requests', h);
report.stderr = h.stderr.slice(0, 300);
save('p32_report.json', report);
cleanup(cwd);
for (const [k, v] of Object.entries(report.requests)) console.log(k.padEnd(34), v.answered ? (v.subtype + ' ' + (v.error || v.sample || '')).slice(0, 170) : 'NO ANSWER');
console.log(JSON.stringify({ ...report, requests: undefined }, null, 1).slice(0, 2500));
