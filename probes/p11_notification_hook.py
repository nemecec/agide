# README: python3 p11_notification_hook.py  -- P11: which Notification hook events fire in the interactive TUI. Phase A leaves a permission dialog unanswered and records the Notification payload, its timing against PermissionRequest, then answers the dialog with Enter. Phase B waits at the idle prompt after the turn ends (about 80 s) and records any idle Notification. Haiku, empty temp dir, manual permission mode, no PermissionRequest decision from the hook.
import sys
from m2_lib import *

EV = EVENTS + ['Notification']
cwd = tmpdir(); log = out('p11_hooks.jsonl')
args = ['--permission-mode', 'manual', '--strict-mcp-config', '--settings', json.dumps(hook_settings(log, events=EV))]
p = start_pty2(args, cwd, log, raw=out('p11_raw.bin'))
t0 = time.time()
r = {}
submit(p, 'Use the Bash tool to run exactly: echo probe11 > marker.txt . Then reply with the word: done')
deadline = time.time() + 60
while time.time() < deadline and count(log, 'PermissionRequest') == 0: p.pump(0.3)
r['permission_request_seen'] = count(log, 'PermissionRequest') > 0
p.pump(8.0)
r['screen_at_dialog'] = p.text(900)
r['notifications_before_answer'] = [e for e in events(log) if e.get('hook_event_name') == 'Notification']
t_answer = time.time()
p.send('\r'); p.pump(1.0)
r['answered_with'] = 'Enter (first option of the dialog)'
r['stopped'] = wait_stops(p, log, 1, 60)
r['marker_exists'] = os.path.exists(os.path.join(cwd, 'marker.txt'))
t_stop = time.time()
r['phase_a_events'] = [{'event': e.get('hook_event_name'), 't_rel_s': round(e['_logged_at'] - t0, 2), 'notification_type': e.get('notification_type'), 'message': e.get('message'), 'title': e.get('title')} for e in events(log)]
# Phase B: idle at the prompt
n_before = len(events(log))
idle_deadline = time.time() + 85
while time.time() < idle_deadline: p.pump(1.0)
idle = events(log)[n_before:]
r['idle_events'] = [{'event': e.get('hook_event_name'), 'dt_after_stop_s': round(e['_logged_at'] - t_stop, 2), 'notification_type': e.get('notification_type'), 'message': e.get('message'), 'payload_keys': sorted(e)} for e in idle]
r['all_notifications'] = [e for e in events(log) if e.get('hook_event_name') == 'Notification']
r['notification_payload_keys'] = sorted({k for e in r['all_notifications'] for k in e})
r['exit_code'] = exit_pty(p)
save('p11_report.json', r)
print(json.dumps({k: r[k] for k in ('permission_request_seen', 'stopped', 'marker_exists', 'phase_a_events', 'idle_events', 'notification_payload_keys')}, indent=1))
