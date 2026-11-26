# README: python3 p45_http_hook_pty.py [case ...]  -- P45 (PTY half): the `http` hook type in the interactive TUI. Runs p45_hook_server.mjs as a subprocess and one haiku session per case in an empty directory under /tmp/agide-r21-probes/pty45/. Cases: payloads (every event posts to its own path; the PermissionRequest answer is held 12 s, then allow; after Stop the case waits for the idle Notification), hold_no_key (held 20 s then allow, no key), hold_150 (held 150 s), esc_during_hold (Esc 5 s into a 30 s hold), enter_during_hold (Enter 5 s into a 30 s hold), timeout_hands_back (hook timeout 5 s, answer after 12 s; Enter pressed after the timeout). Records what the receiver saw (including whether the CLI closed the connection) and the transcript tool result. Report: probes/out/p45_pty_report[_<cases>].json.
import sys, re, atexit, subprocess, shutil, hashlib
from m2_lib import *

def start_pty2(args, cwd, log, raw=None, ready_event='SessionStart'):
    # The folder-trust dialog needs a settled screen before the keys: Down, check that the marker moved, then Enter.
    if raw: open(raw, 'wb').close()
    open(log, 'w').close()
    p = Pty(['--model', 'haiku', '--setting-sources', 'user'] + args, cwd=cwd, rawlog=raw)
    deadline = time.time() + 60; answered = False
    while time.time() < deadline and count(log, ready_event) == 0:
        p.pump(0.3)
        flat = p.text().replace(' ', '')
        if not answered and 'Entertoconfirm' in flat:
            p.pump(2.0); p.send(b'\x1b[B'); p.pump(1.0)
            if re.search(r'\u276f\s*Yes,\s*I\s*trust', p.text()[-400:].replace('\x00', '')): p.send(b'\r'); answered = True
            else: p.send(b'\x1b[B'); p.pump(1.0); p.send(b'\r'); answered = True
        if p.exited is not None: break
    time.sleep(2.0); p.pump(0.5)
    return p

ROOT = '/tmp/agide-r21-probes/pty45'
os.makedirs(ROOT, exist_ok=True)
REPORT = 'p45_pty_report' + (('_' + '_'.join(sys.argv[1:])) if len(sys.argv) > 1 else '') + '.json'
report_path = out(REPORT)
report = json.load(open(report_path)) if os.path.exists(report_path) else {}
EV = EVENTS + ['PostToolUseFailure', 'Notification']
CTX_WORD = 'p45ctx' + hashlib.sha256(b'p45-context-word').hexdigest()[:10]
PROMPT = 'Use the Bash tool to run exactly: echo p45pty > marker.txt . Then reply with one sentence saying whether the command ran or was refused, quoting any refusal text you received.'

def run_case(name, routes, hook_extra=None, key=None, key_at=None, wait_idle=False, after_key_key=None, after_key_at=None, max_wait=120, min_wait=0, prompt=PROMPT, permission_wait=True):
    cwd = os.path.join(ROOT, name); shutil.rmtree(cwd, ignore_errors=True); os.makedirs(cwd)
    slog = out(f'p45pty_{name}_server.jsonl'); open(slog, 'w').close(); log = out(f'p45pty_{name}_hooks.jsonl')
    cmd = ['node', os.path.join(HERE, 'p45_hook_server.mjs'), '--serve', '--log', slog]
    for path, spec in routes.items(): cmd += ['--route', f'{path}={spec}']
    srv = subprocess.Popen(cmd, stdout=subprocess.PIPE, text=True, env=clean_env())
    atexit.register(srv.terminate)
    base = json.loads(srv.stdout.readline())['base']
    hooks = {e: [{'hooks': [dict({'type': 'http', 'url': f'{base}/e/{e}'}, **((hook_extra or {}).get(e, {})))]}] for e in EV}
    # a command logger on SessionStart tells start_pty2 when the session is ready
    hooks['SessionStart'][0]['hooks'].append({'type': 'command', 'command': f'{LOGHOOK} {log}'})
    p = start_pty2(['--permission-mode', 'manual', '--strict-mcp-config', '--settings', json.dumps({'hooks': hooks})], cwd, log, raw=out(f'p45pty_{name}_raw.bin'))
    r = {'routes': routes, 'hook_extra': hook_extra, 'key': repr(key), 'key_at_s': key_at}
    submit(p, prompt)
    t_sub = time.time()
    first_perm = None
    while permission_wait and time.time() < t_sub + 60 and first_perm is None:
        p.pump(0.3)
        first_perm = next((e for e in read_jsonl(slog) if e.get('kind') == 'request' and e.get('url', '').endswith('/PermissionRequest')), None)
    t0 = first_perm['t'] / 1000 if first_perm else time.time()
    r['permission_request_seen'] = bool(first_perm)
    snaps = []; pressed = False; pressed2 = False
    end = t0 + max_wait
    last_event_t = time.time()
    while time.time() < end:
        p.pump(0.4); el = time.time() - t0
        if not snaps and el > 3: snaps.append({'at_s': round(el, 1), 'screen': p.text(600)})
        if key and not pressed and el >= key_at:
            p.send(key); pressed = True; r['key_sent_at_s'] = round(el, 1); p.pump(1.0)
            snaps.append({'at_s': round(time.time() - t0, 1), 'screen_after_key': p.text(500)})
        if after_key_key and not pressed2 and el >= after_key_at:
            snaps.append({'at_s': round(el, 1), 'screen_before_second_key': p.text(500)})
            p.send(after_key_key); pressed2 = True; r['second_key_sent_at_s'] = round(el, 1); p.pump(1.0)
        evs = read_jsonl(slog)
        stop = any(e.get('kind') == 'request' and e.get('url', '').endswith('/Stop') for e in evs)
        idle = any(e.get('kind') == 'request' and e.get('url', '').endswith('/Notification') and (e.get('body') or {}).get('notification_type') == 'idle_prompt' for e in evs)
        if stop and (not wait_idle or idle) and el >= min_wait: break
        if p.exited is not None: break
    p.pump(1.0)
    r['final_screen_tail'] = p.text(400)
    try: p.send('/exit\r')
    except OSError: pass
    p.pump(4.0)
    if p.exited is None: p.close()
    evs = read_jsonl(slog)
    r['server_events'] = [{'dt_s': round(e['t'] / 1000 - t0, 2), 'kind': e['kind'], 'url': e.get('url'), **({'status': e['status']} if e.get('status') is not None else {})} for e in evs]
    reqs = [e for e in evs if e['kind'] == 'request']
    r['payload_keys'] = {e['url'].rsplit('/', 1)[-1]: sorted((e.get('body') or {}).keys()) for e in reqs}
    r['payload_examples'] = {}
    for e in reqs:
        k = e['url'].rsplit('/', 1)[-1] + (':' + e['body'].get('notification_type', '') if k_is_notification(e) else '')
        r['payload_examples'].setdefault(k, e.get('body'))
    r['request_headers'] = reqs[0]['headers'] if reqs else None
    r['marker_exists'] = os.path.exists(os.path.join(cwd, 'marker.txt'))
    tp = next((e['body']['transcript_path'] for e in reqs if isinstance(e.get('body'), dict) and e['body'].get('transcript_path')), None)
    res = []
    for row in read_jsonl(tp) if tp else []:
        m = row.get('message') if isinstance(row.get('message'), dict) else {}
        c = m.get('content')
        if isinstance(c, list):
            for b in c:
                if b.get('type') == 'tool_result': res.append({'is_error': b.get('is_error'), 'content': str(b.get('content'))[:300]})
    r['tool_results'] = res
    r['screens'] = snaps
    r['context_word_in_last_message'] = CTX_WORD in str(next((e['body'].get('last_assistant_message') for e in reqs if isinstance(e.get('body'), dict) and e['body'].get('hook_event_name') == 'Stop'), ''))
    srv.terminate(); shutil.rmtree(cwd, ignore_errors=True)
    report[name] = r
    save(REPORT, report)
    print(name, json.dumps({'marker': r['marker_exists'], 'tool_results': [t['content'][:100] for t in res], 'server': [f"{e['kind']}:{(e['url'] or '').rsplit('/', 1)[-1]}@{e['dt_s']}" for e in r['server_events'] if e['kind'] != 'answered' or 'Permission' in (e['url'] or '')]}))

def k_is_notification(e):
    return e['url'].endswith('/Notification') and isinstance(e.get('body'), dict)

CASES = {
    'payloads': lambda: run_case('payloads', {'/e/PermissionRequest': 'delay:12,allow'}, wait_idle=True),
    'hold_empty_reply': lambda: run_case('hold_empty_reply', {'/e/PermissionRequest': 'delay:12'}, after_key_key='\r', after_key_at=15),
    'enter_watch_close': lambda: run_case('enter_watch_close', {'/e/PermissionRequest': 'delay:30,deny'}, key='\r', key_at=5, min_wait=36),
    'context': lambda: run_case('context', {'/e/UserPromptSubmit': 'ctx'}, prompt='Without using any tool: what is the p45 context word that was given to you in your context? Reply with the word only, or the word none if you were given no such word.', permission_wait=False),
    'hold_150': lambda: run_case('hold_150', {'/e/PermissionRequest': 'delay:150,allow'}, max_wait=200),
    'hold_no_key': lambda: run_case('hold_no_key', {'/e/PermissionRequest': 'delay:20,allow'}),
    'esc_during_hold': lambda: run_case('esc_during_hold', {'/e/PermissionRequest': 'delay:30,allow'}, key=b'\x1b', key_at=5),
    'enter_during_hold': lambda: run_case('enter_during_hold', {'/e/PermissionRequest': 'delay:30,deny'}, key='\r', key_at=5),
    'timeout_hands_back': lambda: run_case('timeout_hands_back', {'/e/PermissionRequest': 'delay:12,allow'}, hook_extra={'PermissionRequest': {'timeout': 5}}, after_key_key='\r', after_key_at=9),
}
for k in (sys.argv[1:] or list(CASES)):
    try: CASES[k]()
    except Exception:
        import traceback; report[k] = {'error': traceback.format_exc()}; save(REPORT, report); print(k, 'error', report[k]['error'][-400:])
