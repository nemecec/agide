# README: shared helpers for the stage 2 probes P6 to P10 (Python 3 standard library, builds on pty_lib.py). Not run directly.
import json, os, subprocess, tempfile, time
from pty_lib import *

LOGHOOK = f'python3 {HERE}/hooks/log_hook.py'
EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest', 'Stop', 'SessionEnd']

def tmpdir(prefix='p-stage2-'):
    return os.path.realpath(tempfile.mkdtemp(prefix=prefix, dir=WORK))

def out(name): return os.path.join(OUT, name)

def hook_settings(log, extra_hooks=None, events=EVENTS):
    hooks = {e: [{'hooks': [{'type': 'command', 'command': f'{LOGHOOK} {log}'}]}] for e in events}
    for ev, cmds in (extra_hooks or {}).items():
        hooks.setdefault(ev, []).extend({'hooks': [{'type': 'command', 'command': c}]} for c in cmds)
    return {'hooks': hooks}

def events(log): return read_jsonl(log)
def count(log, name): return sum(1 for e in events(log) if e.get('hook_event_name') == name)

def start_pty(args, cwd, log, raw=None, wait_ready=True):
    if raw: open(raw, 'wb').close()
    open(log, 'w').close()
    p = Pty(['--model', 'haiku', '--setting-sources', 'user'] + args, cwd=cwd, rawlog=raw)
    if wait_ready:
        deadline = time.time() + 30
        while time.time() < deadline and count(log, 'SessionStart') == 0:
            p.pump(0.3)
        time.sleep(2.0); p.pump(0.5)
    return p

def submit(p, prompt):
    p.type(prompt); time.sleep(0.6); p.send('\r')

def wait_stops(p, log, n, timeout=90):
    deadline = time.time() + timeout
    while time.time() < deadline:
        p.pump(0.4)
        if count(log, 'Stop') >= n: p.pump(1.0); return True
        if p.exited is not None: return False
    return False

def exit_pty(p):
    try: p.send('/exit\r')
    except OSError: pass
    p.pump(2.0)
    if p.exited is None: p.close()
    return p.exited

def transcript_of(log):
    return next((e['transcript_path'] for e in events(log) if e.get('transcript_path')), None)

def transcript_text(path):
    return open(path).read() if path and os.path.exists(path) else ''

def start_host(name):
    log = out(f'{name}_host.jsonl'); st = out(f'{name}_state.json')
    for f in (log, st): open(f, 'w').close()
    proc = subprocess.Popen(['node', os.path.join(HERE, 'mcp_host.mjs'), '--serve', '--log', log, '--state', st], stdout=subprocess.PIPE, text=True, env=clean_env())
    info = json.loads(proc.stdout.readline())
    return proc, info, log, st

def save(name, obj):
    with open(out(name), 'w') as f: f.write(obj if isinstance(obj, str) else json.dumps(obj, indent=1))
