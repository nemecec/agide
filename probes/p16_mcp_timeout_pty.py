# README: python3 p16_mcp_timeout_pty.py [case ...]  -- P16 (PTY half): how long the interactive TUI keeps a call to an HTTP MCP tool open. Runs p16_slow_mcp.mjs as a subprocess and one haiku TUI session per case in an empty directory under /tmp/agide-r21-probes/pty/. Cases: noentry_65s_json (no server timeout, silent for 65 s), entry600k_150s_json (crosses the 2 minute move to a background task), esc_entry600k_90s_json (Esc 15 s into the call), noentry_330s_sse_silent (stream open, no progress), bg0_entry600k_150s_json (CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS=0 keeps the call in the foreground), multiline (a prompt with a line break typed as keys and as a bracketed paste). Hook events come from the logging command hook; the transcript gives the tool result. Report: probes/out/p16_pty_report[_<cases>].json.
import sys, re, atexit, subprocess, shutil
from m2_lib import *

def start_pty2(args, cwd, log, raw=None, ready_event='SessionStart', env=None):
    # The folder-trust dialog needs a settled screen before the keys: Down, check that the marker moved, then Enter.
    if raw: open(raw, 'wb').close()
    open(log, 'w').close()
    p = Pty(['--model', 'haiku', '--setting-sources', 'user'] + args, cwd=cwd, rawlog=raw, env=env)
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

ROOT = '/tmp/agide-r21-probes/pty'
os.makedirs(ROOT, exist_ok=True)
REPORT = 'p16_pty_report' + (('_' + '_'.join(sys.argv[1:])) if len(sys.argv) > 1 else '') + '.json'
report_path = out(REPORT)
report = json.load(open(report_path)) if os.path.exists(report_path) else {}
EV = EVENTS + ['PostToolUseFailure', 'Notification']

def prompt_for(seconds, mode, every=0):
    return f'Call the slow_wait tool exactly once with seconds={seconds}, mode="{mode}", progress_every_s={every}. When it returns, reply with one short sentence that quotes the exact tool result text or error text verbatim. Do not call any other tool.'

def transcript_rows(path):
    rows = []
    for row in read_jsonl(path) if path else []:
        m = row.get('message') if isinstance(row.get('message'), dict) else {}
        c = m.get('content')
        if isinstance(c, str): rows.append({'role': m.get('role'), 'text': c[:300]})
        elif isinstance(c, list):
            for b in c:
                if b.get('type') == 'tool_result': rows.append({'role': 'tool_result', 'is_error': b.get('is_error'), 'text': str(b.get('content'))[:300]})
                elif b.get('type') == 'tool_use': rows.append({'role': 'tool_use', 'text': f"{b.get('name')} {json.dumps(b.get('input'))[:100]}"})
                elif b.get('type') == 'text': rows.append({'role': m.get('role'), 'text': b.get('text', '')[:300]})
    return rows

def run_case(name, entry, seconds, mode, every=0, key=None, key_at=None, max_wait=None, extra_env=None):
    cwd = os.path.join(ROOT, name); shutil.rmtree(cwd, ignore_errors=True); os.makedirs(cwd)
    log = out(f'p16pty_{name}_hooks.jsonl'); slog = out(f'p16pty_{name}_server.jsonl'); open(slog, 'w').close()
    srv = subprocess.Popen(['node', os.path.join(HERE, 'p16_slow_mcp.mjs'), '--serve', '--log', slog, '--extra', json.dumps(entry)], stdout=subprocess.PIPE, text=True, env=clean_env())
    atexit.register(srv.terminate)
    info = json.loads(srv.stdout.readline())
    settings = hook_settings(log, {}, EV)
    args = ['--permission-mode', 'manual', '--strict-mcp-config', '--mcp-config', json.dumps(info['config']), '--allowedTools', 'mcp__slow__slow_wait', '--settings', json.dumps(settings)]
    p = start_pty2(args, cwd, log, raw=out(f'p16pty_{name}_raw.bin'), env=extra_env)
    r = {'entry': entry, 'seconds': seconds, 'mode': mode, 'every': every, 'key': repr(key), 'key_at_s': key_at}
    submit(p, prompt_for(seconds, mode, every))
    t_sub = time.time()
    # wait for the call to start at the server
    start = None
    while time.time() < t_sub + 60 and start is None:
        p.pump(0.3)
        start = next((e for e in read_jsonl(slog) if e.get('kind') == 'call-start'), None)
    r['call_started'] = bool(start)
    t_call = time.time()
    snaps = []; pressed = False
    deadline = t_call + (max_wait or seconds + 90)
    stops_seen = 0
    while time.time() < deadline:
        p.pump(0.4); el = time.time() - t_call
        if key and not pressed and el >= key_at:
            p.send(key); pressed = True; r['key_sent_at_s'] = round(el, 1); p.pump(1.0)
            snaps.append({'at_s': round(time.time() - t_call, 1), 'screen_after_key': p.text(500)})
        if not any(s.get('at_s') == 'mid' for s in snaps) and el > 125 and seconds > 125:
            snaps.append({'at_s': 'mid', 'real_at_s': round(el, 1), 'screen': p.text(700)})
        evs = read_jsonl(slog)
        ended = any(e.get('kind') == 'call-end' for e in evs)
        stops = count(log, 'Stop')
        if stops >= 1 and (ended or key) and time.time() > t_call + 5 and (stops >= 2 or el > seconds + 40 or (key and el > key_at + 20)):
            break
        if p.exited is not None: break
    p.pump(1.0)
    r['server_events'] = [e for e in read_jsonl(slog) if e.get('kind') != 'connection']
    ev = events(log)
    r['hook_sequence'] = [{'event': e['hook_event_name'], 'dt_s': round(e['_logged_at'] - t_call, 1), **({'tool': e.get('tool_name')} if e.get('tool_name') else {}), **({'notification_type': e.get('notification_type')} if e.get('notification_type') else {})} for e in ev if e.get('hook_event_name') not in ('SessionStart', 'UserPromptSubmit')]
    r['transcript'] = transcript_rows(transcript_of(log))
    r['screens'] = snaps
    r['final_screen_tail'] = p.text(500)
    r['exit_code'] = exit_pty(p)
    srv.terminate(); shutil.rmtree(cwd, ignore_errors=True)
    report[name] = r
    save(REPORT, report)
    print(name, json.dumps({'server': [f"{e['kind']}:{e.get('how', e.get('method', ''))}@{e['at_s']}" for e in r['server_events']], 'hooks': [f"{h['event']}@{h['dt_s']}" for h in r['hook_sequence']], 'transcript': [t['role'] + ':' + t['text'][:90] for t in r['transcript'][-5:]]}))

def multiline():
    cwd = os.path.join(ROOT, 'multiline'); shutil.rmtree(cwd, ignore_errors=True); os.makedirs(cwd)
    res = {}
    for label in ('typed_newline', 'bracketed_paste'):
        log = out(f'p16pty_ml_{label}_hooks.jsonl')
        p = start_pty2(['--permission-mode', 'manual', '--strict-mcp-config', '--settings', json.dumps(hook_settings(log, {}, EV))], cwd, log, raw=out(f'p16pty_ml_{label}_raw.bin'))
        text = 'first line ALPHA\nsecond line BETA'
        tail = ' Reply with the single word OK-' + label[:2] + ' and nothing else.'
        if label == 'typed_newline':
            p.type(text + tail); time.sleep(0.8)
        else:
            p.send(b'\x1b[200~' + text.encode() + b'\x1b[201~'); time.sleep(0.5); p.type(tail); time.sleep(0.8)
        p.pump(1.0)
        before_stops = count(log, 'Stop'); before_prompts = count(log, 'UserPromptSubmit')
        screen_before_enter = p.text(500)
        p.send('\r')
        wait_stops(p, log, 1, 60)
        ups = [e.get('prompt') for e in events(log) if e.get('hook_event_name') == 'UserPromptSubmit']
        res[label] = {'prompts_submitted_before_enter': before_prompts, 'user_prompt_submit_payloads': ups, 'screen_before_enter': screen_before_enter[-300:], 'exit_code': exit_pty(p)}
        print('multiline', label, json.dumps({'submitted_before_enter': before_prompts, 'prompts': ups}))
    shutil.rmtree(cwd, ignore_errors=True)
    report['multiline'] = res
    save(REPORT, report)

CASES = {
    'noentry_65s_json': lambda: run_case('noentry_65s_json', {}, 65, 'json'),
    'entry600k_150s_json': lambda: run_case('entry600k_150s_json', {'timeout': 600000}, 150, 'json', max_wait=300),
    'esc_entry600k_90s_json': lambda: run_case('esc_entry600k_90s_json', {'timeout': 600000}, 90, 'json', key=b'\x1b', key_at=15),
    'noentry_330s_sse_silent': lambda: run_case('noentry_330s_sse_silent', {}, 330, 'sse', 0, max_wait=420),
    'bg0_entry600k_150s_json': lambda: run_case('bg0_entry600k_150s_json', {'timeout': 600000}, 150, 'json', max_wait=300, extra_env={'CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS': '0'}),
    'multiline': multiline,
}
for k in (sys.argv[1:] or [c for c in CASES if c != 'noentry_330s_sse_silent']):
    try: CASES[k]()
    except Exception:
        import traceback; report[k] = {'error': traceback.format_exc()}; save(REPORT, report); print(k, 'error', report[k]['error'][-300:])
