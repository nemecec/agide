# README: python3 p10_pty_interrupt.py [case ...]  -- P10: interrupting a running turn in the interactive TUI. Cases: Esc and Ctrl-C during a long Bash tool call (a Python sleep, because the shell guard refuses a foreground sleep) and during text generation, SIGINT to the process during a tool call, and double Ctrl-C at idle. Records the hook events that follow, the transcript marker, the screen text, process state, and whether the session answers a follow-up prompt. Haiku, manual mode with an allow-all PermissionRequest hook.
import sys, signal
from stage2_lib import *

EV = EVENTS + ['PostToolUseFailure', 'StopFailure', 'Notification']
TOOL = 'Use the Bash tool to run exactly: python3 -c "import time; time.sleep(45); print(\'finished\')" . Then reply with the word: finished'
GEN = 'Write a 600 word story about a lighthouse keeper. Output only the story.'
report = json.load(open(out('p10_report.json'))) if os.path.exists(out('p10_report.json')) else {}

def case(name, prompt, action, wait_for, idle=False):
    cwd = tmpdir(); log = out(f'p10_{name}_hooks.jsonl'); pol = out(f'p10_{name}_policy.json')
    json.dump({'*': 'allow'}, open(pol, 'w'))
    settings = hook_settings(log, {'PermissionRequest': [f'python3 {HERE}/hooks/perm_policy.py {pol} {log}.perm']}, EV)
    p = start_pty(['--permission-mode', 'manual', '--strict-mcp-config', '--settings', json.dumps(settings)], cwd, log, raw=out(f'p10_{name}_raw.bin'))
    open(log + '.perm', 'w').close()
    r = {'action': action}
    if not idle:
        submit(p, prompt)
        deadline = time.time() + 40
        while time.time() < deadline and count(log, wait_for) == 0: p.pump(0.3)
        r['reached_wait_event'] = count(log, wait_for) > 0
        p.pump(2.0 if wait_for == 'PreToolUse' else 1.5)
    n_before = len(events(log)); t_act = time.time(); mark = p.mark()
    if action == 'esc': p.send(b'\x1b')
    elif action == 'ctrlc': p.send(b'\x03')
    elif action == 'sigint': os.kill(p.pid, signal.SIGINT)
    elif action == 'double_ctrlc': p.send(b'\x03'); p.pump(0.5); p.send(b'\x03')
    p.pump(5.0); p._reap()
    after = events(log)[n_before:]
    r['hooks_after_action'] = [{'event': e.get('hook_event_name'), 'tool': e.get('tool_name'), 'dt_s': round(e['_logged_at'] - t_act, 2), 'keys': sorted(k for k in e if k not in ('session_id', 'transcript_path', 'cwd', '_logged_at', 'scratchpad_dir', 'prompt_id', 'effort', 'permission_mode', 'hook_event_name'))} for e in after]
    r['stop_payload_after_action'] = next(({k: v for k, v in e.items() if k in ('stop_hook_active', 'last_assistant_message', 'background_tasks', 'reason', 'error')} for e in after if e.get('hook_event_name') in ('Stop', 'StopFailure')), None)
    r['screen_after_action'] = p.text()[mark:][-600:]
    r['process_exited'] = p.exited
    r['tool_process_still_running'] = subprocess.run(['pgrep', '-f', 'time.sleep.45'], capture_output=True, text=True).stdout.strip() != ''
    tp = transcript_of(log)
    rows = read_jsonl(tp) if tp else []
    r['transcript_interrupt_lines'] = [json.dumps(x)[:300] for x in rows if 'interrupted' in json.dumps(x).lower()][:3]
    if not idle and p.exited is None:
        n = count(log, 'Stop')
        submit(p, 'Reply with just: alive')
        r['follow_up_answered'] = wait_stops(p, log, n + 1, 60) or count(log, 'Stop') > n
        stops = [e for e in events(log) if e.get('hook_event_name') == 'Stop']
        r['follow_up_reply'] = (stops[-1].get('last_assistant_message') or '')[:60] if stops and r['follow_up_answered'] else None
    r['exit_code'] = exit_pty(p)
    r['events_total'] = [e.get('hook_event_name') for e in events(log)]
    subprocess.run(['pkill', '-f', 'time.sleep.45'])
    report[name] = r; save('p10_report.json', report)

import subprocess
CASES = {
 'tool_esc': lambda: case('tool_esc', TOOL, 'esc', 'PreToolUse'),
 'tool_ctrlc': lambda: case('tool_ctrlc', TOOL, 'ctrlc', 'PreToolUse'),
 'tool_sigint': lambda: case('tool_sigint', TOOL, 'sigint', 'PreToolUse'),
 'gen_esc': lambda: case('gen_esc', GEN, 'esc', 'UserPromptSubmit'),
 'gen_ctrlc': lambda: case('gen_ctrlc', GEN, 'ctrlc', 'UserPromptSubmit'),
 'idle_double_ctrlc': lambda: case('idle_double_ctrlc', None, 'double_ctrlc', None, idle=True),
}
for k in (sys.argv[1:] or CASES):
    try: CASES[k]()
    except Exception:
        import traceback; report[k] = {'error': traceback.format_exc()}; save('p10_report.json', report)
for k, v in report.items(): print(k, {x: v.get(x) for x in ('reached_wait_event', 'process_exited', 'tool_process_still_running', 'follow_up_answered', 'follow_up_reply', 'error')}, [(h['event'], h['dt_s']) for h in v.get('hooks_after_action', [])], v.get('stop_payload_after_action'))
