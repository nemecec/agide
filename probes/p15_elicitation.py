# README: python3 p15_elicitation.py [case ...]  -- P15: the Elicitation hook for an MCP elicitation request, in the interactive TUI. Uses fixtures/elicit_mcp_server.mjs (stdio; the HTTP test host mcp_host.mjs has no server-initiated requests). Cases: "log_only" (hooks log, no decision; the dialog is answered with Esc), "accept" (the Elicitation hook answers accept with content). Records the hook payloads, Notification events, the screen, what the server received and what the model reported. Haiku, empty temp dirs, manual permission mode, tool allowed by a PermissionRequest hook.
import sys
from m2_lib import *

report = json.load(open(out('p15_report.json'))) if os.path.exists(out('p15_report.json')) else {}
PROMPT = 'Call the MCP tool ask_color (from the server elicit) and then reply with one sentence quoting exactly what the tool returned.'

def case(name, answer):
    cwd = tmpdir(); log = out(f'p15_{name}_hooks.jsonl'); sl = out(f'p15_{name}_server.jsonl'); open(sl, 'w').close()
    pol = out(f'p15_{name}_policy.json'); json.dump({'*': 'allow'}, open(pol, 'w'))
    extra = {'PermissionRequest': [f'python3 {HERE}/hooks/perm_policy.py {pol} {log}.perm']}
    if answer: extra['Elicitation'] = [f'python3 {HERE}/hooks/elicit_answer.py {out(f"p15_{name}_elicit.jsonl")}']
    settings = hook_settings(log, extra, EVENTS + ['Notification', 'Elicitation', 'ElicitationResult'])
    cfg = {'mcpServers': {'elicit': {'type': 'stdio', 'command': 'node', 'args': [os.path.join(HERE, 'fixtures', 'elicit_mcp_server.mjs'), sl]}}}
    p = start_pty2(['--permission-mode', 'manual', '--strict-mcp-config', '--mcp-config', json.dumps(cfg), '--settings', json.dumps(settings)], cwd, log, raw=out(f'p15_{name}_raw.bin'))
    open(log + '.perm', 'w').close()
    r = {'answer_from_hook': answer}
    time.sleep(3); p.pump(1.0)
    submit(p, PROMPT)
    deadline = time.time() + 60
    while time.time() < deadline and count(log, 'Elicitation') == 0 and count(log, 'Stop') == 0: p.pump(0.3)
    p.pump(8.0)
    r['screen_during'] = p.text(900)
    if not answer:
        p.send(b'\x1b'); p.pump(2.0)
    r['stopped'] = wait_stops(p, log, 1, 40)
    ev = events(log)
    r['hook_events'] = [{'event': e.get('hook_event_name'), 'notification_type': e.get('notification_type'), 'keys': sorted(k for k in e if k not in ('session_id', 'transcript_path', 'cwd', '_logged_at', 'scratchpad_dir', 'prompt_id', 'effort', 'permission_mode'))} for e in ev if e.get('hook_event_name') in ('Elicitation', 'ElicitationResult', 'Notification', 'PermissionRequest', 'PostToolUse', 'Stop')]
    r['elicitation_payloads'] = [{k: v for k, v in e.items() if k not in ('transcript_path', 'cwd', 'scratchpad_dir', 'session_id')} for e in ev if e.get('hook_event_name') in ('Elicitation', 'ElicitationResult')]
    r['notifications'] = [{k: e.get(k) for k in ('notification_type', 'message', 'title')} for e in ev if e.get('hook_event_name') == 'Notification']
    r['server_log'] = read_jsonl(sl)
    stop = next((e for e in ev if e.get('hook_event_name') == 'Stop'), {})
    r['last_assistant_message'] = stop.get('last_assistant_message')
    r['exit_code'] = exit_pty(p)
    report[name] = r

steps = {'log_only': lambda: case('log_only', None), 'accept': lambda: case('accept', {'action': 'accept', 'content': {'color': 'green'}})}
for k in (sys.argv[1:] or list(steps)):
    try: steps[k]()
    except Exception:
        import traceback; report[k] = {'error': traceback.format_exc()}
save('p15_report.json', report)
print('done', list(report))
