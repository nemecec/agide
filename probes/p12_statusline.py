# README: python3 p12_statusline.py [case ...]  -- P12: status line command through --settings in the interactive TUI. Cases: "basic" (payload at start and after a turn, fire timing, refreshInterval absent), "refresh" (refreshInterval 3), "precedence" (a project statusLine next to the --settings one, under --setting-sources user and under user,project), "atomic" (200 parallel invocations of the capture script on one session id while a reader parses the file). No user-level statusLine exists on this machine, so replacement of a user statusLine is not run. Haiku, empty temp dirs, manual permission mode.
import sys, threading
from m2_lib import *

CAP = f'python3 {HERE}/hooks/statusline_capture.py'
report = json.load(open(out('p12_report.json'))) if os.path.exists(out('p12_report.json')) else {}

def fires(d):
    return read_jsonl(os.path.join(d, 'fires.jsonl'))

def run(name, extra_settings=None, prep=None, sources='user', idle=12, prompt='Use the Bash tool to run exactly: echo probe12 > m.txt . Then reply with the word: done'):
    cwd = tmpdir(); cap = os.path.join(out(f'p12_{name}_cap')); os.makedirs(cap, exist_ok=True)
    for f in os.listdir(cap): os.remove(os.path.join(cap, f))
    log = out(f'p12_{name}_hooks.jsonl')
    sl = {'type': 'command', 'command': f'{CAP} {cap} settings'}
    sl.update((extra_settings or {}).get('statusLine', {}))
    settings = hook_settings(log); settings['statusLine'] = sl
    if prep: prep(cwd)
    p = Pty(['--model', 'haiku', '--setting-sources', sources, '--permission-mode', 'manual', '--strict-mcp-config', '--settings', json.dumps(settings)], cwd=cwd, rawlog=out(f'p12_{name}_raw.bin'))
    open(out(f'p12_{name}_raw.bin'), 'wb').close(); open(log, 'w').close()
    t0 = time.time(); trusted = False
    deadline = time.time() + 40
    while time.time() < deadline and count(log, 'SessionStart') == 0:
        p.pump(0.3)
        if not trusted and 'Quicksafetycheck' in p.text().replace(' ', ''):
            p.send(b'\x1b[B'); p.pump(0.5); p.send('\r'); trusted = True
    p.pump(idle)
    n_idle = len(fires(cap)); t_prompt = time.time()
    r = {'fires_during_idle_after_start': n_idle, 'idle_s': idle}
    perm = out(f'p12_{name}_policy.json'); json.dump({'*': 'allow'}, open(perm, 'w'))
    # allow-all through the dialog: answer by Enter when it appears
    submit(p, prompt)
    end = time.time() + 75
    while time.time() < end and count(log, 'Stop') == 0:
        p.pump(0.4)
        if count(log, 'PermissionRequest') and count(log, 'PostToolUse') == 0 and 'Doyouwant' in p.text(1500).replace(' ', ''): p.send('\r'); p.pump(0.5)
    p.pump(2.5)
    fs = fires(cap)
    r['stopped'] = count(log, 'Stop') > 0
    r['fires_total'] = len(fs)
    r['fire_times_rel_s'] = [round(f['t'] - t0, 2) for f in fs]
    r['prompt_at_rel_s'] = round(t_prompt - t0, 2)
    r['intervals_s'] = [round(b['t'] - a['t'], 2) for a, b in zip(fs, fs[1:])]
    r['labels'] = sorted({f['label'] for f in fs})
    r['first_payload'] = fs[0]['data'] if fs else None
    r['last_payload'] = fs[-1]['data'] if fs else None
    r['key_paths_first'] = keypaths(fs[0]['data']) if fs else []
    r['key_paths_last'] = keypaths(fs[-1]['data']) if fs else []
    r['hook_sessions'] = sorted({e.get('session_id') for e in events(log) if e.get('session_id')})
    r['per_session_files'] = sorted(x for x in os.listdir(cap) if x.endswith('.json'))
    r['screen_tail'] = p.text(600)
    r['exit_code'] = exit_pty(p)
    report[name] = r

def keypaths(d, pre=''):
    o = []
    if isinstance(d, dict):
        for k, v in d.items():
            o.append(pre + k + ('' if not isinstance(v, (dict, list)) else ''))
            o += keypaths(v, pre + k + '.')
    return o

def prep_project(cwd):
    os.makedirs(os.path.join(cwd, '.claude'), exist_ok=True)
    json.dump({'statusLine': {'type': 'command', 'command': f'{CAP} {out("p12_precedence_cap")} project'}}, open(os.path.join(cwd, '.claude', 'settings.json'), 'w'))

def atomic():
    d = out('p12_atomic_cap'); os.makedirs(d, exist_ok=True)
    payload = json.dumps({'session_id': 'atomic-test', 'cost': {'total_cost_usd': 1.5}, 'pad': 'x' * 20000})
    stop = threading.Event(); bad = []; reads = [0]
    path = os.path.join(d, 'atomic-test.json')
    open(path, 'w').write(payload)
    def reader():
        while not stop.is_set():
            try:
                s = open(path).read(); reads[0] += 1
                json.loads(s)
            except Exception as e: bad.append(repr(e)[:80])
    t = threading.Thread(target=reader); t.start()
    procs = [subprocess.Popen(['python3', f'{HERE}/hooks/statusline_capture.py', d, f'w{i}'], stdin=subprocess.PIPE, stdout=subprocess.DEVNULL) for i in range(200)]
    for pr in procs: pr.stdin.write(payload.encode()); pr.stdin.close()
    for pr in procs: pr.wait()
    stop.set(); t.join()
    left = [x for x in os.listdir(d) if x.endswith('.tmp')]
    report['atomic'] = {'writers': 200, 'reads': reads[0], 'reader_parse_failures': len(bad), 'sample_failures': bad[:3], 'leftover_tmp_files': left}

steps = {
 'basic': lambda: run('basic'),
 'refresh': lambda: run('refresh', {'statusLine': {'refreshInterval': 3}}),
 'precedence_user': lambda: run('precedence_user', prep=prep_project, sources='user'),
 'precedence_project': lambda: run('precedence_project', prep=prep_project, sources='user,project'),
 'atomic': atomic,
}
for k in (sys.argv[1:] or list(steps)):
    try: steps[k]()
    except Exception:
        import traceback; report[k] = {'error': traceback.format_exc()}
save('p12_report.json', report)
print(json.dumps({k: {x: v.get(x) for x in ('stopped', 'fires_during_idle_after_start', 'fires_total', 'fire_times_rel_s', 'labels', 'per_session_files', 'reader_parse_failures', 'leftover_tmp_files', 'error')} for k, v in report.items()}, indent=1))
