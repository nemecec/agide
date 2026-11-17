# README: python3 p14_waiting_permission_hook.py [case ...]  -- P14: a PermissionRequest hook that waits before answering, in the interactive TUI. Cases: "nokey" (allow after 8 s, no input), "esc_vs_allow" (hook allows after 12 s, Esc pressed at 4 s), "enter_vs_deny" (hook denies after 12 s, Enter pressed at 4 s), "timeout" (hook timeout 5 s, hook would allow after 12 s). Records the screen during the wait, the Notification events, whether the call ran, the hook's own log (a killed hook leaves no decide line) and the tool result the model saw. Haiku, empty temp dirs, manual permission mode.
import sys
from m2_lib import *

report = json.load(open(out('p14_report.json'))) if os.path.exists(out('p14_report.json')) else {}
PROMPT = 'Use the Bash tool to run exactly: echo probe14 > marker.txt . Then reply with one sentence saying whether the command ran or was refused, quoting any refusal text you received.'

def case(name, mode, wait, key=None, key_at=4.0, hook_timeout=None):
    cwd = tmpdir(); log = out(f'p14_{name}_hooks.jsonl'); hl = out(f'p14_{name}_hookwait.jsonl'); open(hl, 'w').close()
    hk = {'type': 'command', 'command': f'python3 {HERE}/hooks/perm_wait.py {mode} {wait} {hl}'}
    if hook_timeout: hk['timeout'] = hook_timeout
    settings = hook_settings(log, {}, EVENTS + ['Notification']); settings['hooks']['PermissionRequest'].append({'hooks': [hk]})
    p = start_pty2(['--permission-mode', 'manual', '--strict-mcp-config', '--settings', json.dumps(settings)], cwd, log, raw=out(f'p14_{name}_raw.bin'))
    r = {'hook_mode': mode, 'hook_wait_s': wait, 'key': repr(key), 'key_at_s': key_at if key else None, 'hook_timeout_s': hook_timeout}
    submit(p, PROMPT)
    deadline = time.time() + 60
    while time.time() < deadline and not read_jsonl(hl): p.pump(0.2)
    t_start = read_jsonl(hl)[0]['t'] if read_jsonl(hl) else None
    r['hook_called'] = t_start is not None
    snaps = []; pressed = False
    while t_start and time.time() < t_start + wait + 4:
        p.pump(0.25); el = time.time() - t_start
        if not snaps and el > 2.5: snaps.append({'at_s': round(el, 1), 'screen': p.text(700)})
        if key and not pressed and el >= key_at:
            p.send(key); pressed = True; r['key_sent_at_s'] = round(el, 1)
            p.pump(1.0); snaps.append({'at_s': round(time.time() - t_start, 1), 'screen_after_key': p.text(500)})
    r['screens'] = snaps
    r['stopped'] = wait_stops(p, log, 1, 60)
    r['marker_exists'] = os.path.exists(os.path.join(cwd, 'marker.txt'))
    r['hook_lines'] = [{'phase': h['phase'], 'dt_s': round(h['t'] - t_start, 2)} for h in read_jsonl(hl)]
    ev = events(log)
    r['sequence'] = [{'event': e['hook_event_name'], 'dt_s': round(e['_logged_at'] - t_start, 2), 'notification_type': e.get('notification_type')} for e in ev if e.get('hook_event_name') in ('PermissionRequest', 'Notification', 'PostToolUse', 'Stop', 'PreToolUse')]
    stop = next((e for e in ev if e.get('hook_event_name') == 'Stop'), {})
    r['last_assistant_message'] = stop.get('last_assistant_message')
    tp = transcript_of(log); res = []
    for row in read_jsonl(tp) if tp else []:
        c = (row.get('message') or {}).get('content') if isinstance(row.get('message'), dict) else None
        if isinstance(c, list):
            for b in c:
                if b.get('type') == 'tool_result': res.append({'is_error': b.get('is_error'), 'content': str(b.get('content'))[:300]})
    r['tool_results'] = res
    r['final_screen_tail'] = p.text(400)
    r['exit_code'] = exit_pty(p)
    report[name] = r

steps = {
 'nokey': lambda: case('nokey', 'allow', 8),
 'esc_vs_allow': lambda: case('esc_vs_allow', 'allow', 12, key=b'\x1b'),
 'enter_vs_deny': lambda: case('enter_vs_deny', 'deny', 12, key='\r'),
 'timeout': lambda: case('timeout', 'allow', 12, hook_timeout=5),
}
for k in (sys.argv[1:] or list(steps)):
    try: steps[k]()
    except Exception:
        import traceback; report[k] = {'error': traceback.format_exc()}
save('p14_report.json', report)
print(json.dumps({k: {x: v.get(x) for x in ('hook_called', 'stopped', 'marker_exists', 'hook_lines', 'sequence', 'tool_results', 'last_assistant_message', 'error')} for k, v in report.items()}, indent=1))
