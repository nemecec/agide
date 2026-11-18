# README: [P16_NO_SRT=1] python3 p16_srt.py [basic|mcp|write_outside ...] -- I1: the real claude (haiku, empty temp directory) in a PTY under Anthropic's sandbox runtime (srt). Hook files go to an allowed events directory, the app-style MCP server (mcp_host.mjs) listens on loopback. Needs the srt package under the prefix named by SRT_PREFIX (default: the path in /tmp/agide-srt-prefix.txt). Writes only to temporary directories and probes/out/p16_*.
import sys, re, tempfile, shutil, time
from m2_lib import *

PREFIX = os.environ.get('SRT_PREFIX') or open('/tmp/agide-srt-prefix.txt').read().strip()
SRT_BIN = os.path.join(PREFIX, 'node_modules/.bin/srt')
cfgdir = os.environ.get('CLAUDE_CONFIG_DIR') or os.path.expanduser('~/.claude')


def start_trusted(args, cwd, log, raw):
    # The trust dialog needs a settled screen before the keys: Down, check the marker moved, then Enter.
    open(raw, 'wb').close(); open(log, 'w').close()
    p = Pty(['--model', 'haiku', '--setting-sources', 'user'] + args, cwd=cwd, rawlog=raw)
    deadline = time.time() + 45; answered = False
    while time.time() < deadline and count(log, 'SessionStart') == 0:
        p.pump(0.3)
        flat = p.text().replace(' ', '')
        if not answered and 'Entertoconfirm' in flat:
            p.pump(2.0); p.send(b'\x1b[B'); p.pump(1.0)
            if re.search(r'\u276f\s*Yes,\s*I\s*trust', p.text()[-400:].replace('\x00', '')): p.send(b'\r'); answered = True
            else: p.send(b'\x1b[B'); p.pump(1.0); p.send(b'\r'); answered = True
    time.sleep(2.0); p.pump(0.5)
    return p

def make_env(local_binding):
    base = os.path.realpath(tempfile.mkdtemp(prefix='agide-i1run.', dir='/tmp'))
    d = {k: os.path.join(base, k) for k in ('cwd', 'events', 'outside')}
    for p in d.values(): os.makedirs(p)
    cfg = {'allowPty': True, 'network': {'allowedDomains': ['api.anthropic.com', '*.anthropic.com', '127.0.0.1', 'localhost'], 'deniedDomains': [], 'allowLocalBinding': local_binding},
           'filesystem': {'denyRead': [], 'allowRead': [], 'denyWrite': [],
                          'allowWrite': [d['cwd'], d['events'], cfgdir, os.path.expanduser('~/.claude.json'), os.path.expanduser('~/.claude'), f'/private/tmp/claude-{os.getuid()}']}}
    settings = os.path.join(base, 'srt.json'); json.dump(cfg, open(settings, 'w'))
    return base, d, settings

def run(name, prompt, extra_args, local_binding=False, use_host=False, check=None):
    base, d, settings = make_env(local_binding)
    os.environ['SRT_BIN'] = SRT_BIN; os.environ['SRT_SETTINGS'] = settings
    import pty_lib; pty_lib.CLAUDE = pty_lib.CLAUDE if os.environ.get('P16_NO_SRT') else os.path.join(HERE, 'hooks/srt_claude.sh')
    import stage2_lib, m2_lib
    for mod in (stage2_lib, m2_lib):
        mod.CLAUDE = pty_lib.CLAUDE
    log = os.path.join(d['events'], 'hooks.jsonl')
    r = {'name': name, 'local_binding': local_binding}
    proc = info = hlog = st = None
    args = list(extra_args)
    if use_host:
        proc, info, hlog, st = start_host(name)
        args += ['--mcp-config', json.dumps(info['config']), '--strict-mcp-config']
    else:
        args += ['--strict-mcp-config']
    settings_json = hook_settings(log)
    args += ['--settings', json.dumps(settings_json)]
    t0 = time.time()
    p = start_trusted(args, d['cwd'], log, out(f'p16_{name}_raw.bin'))
    r['start_to_SessionStart_s'] = round(time.time() - t0, 1)
    try:
        submit(p, prompt)
        r['stopped'] = wait_stops(p, log, 1, 90)
        ev = events(log)
        r['hook_events'] = [e['hook_event_name'] for e in ev]
        r['hook_file_written_in_allowed_dir'] = os.path.exists(log)
        stop = next((e for e in ev if e.get('hook_event_name') == 'Stop'), {})
        r['last_assistant_message'] = stop.get('last_assistant_message')
        r['screen_tail'] = p.text(500)
        if proc: r['mcp_calls'] = [c.get('tool') or c.get('method') or c for c in read_jsonl(hlog)][:10]; r['mcp_rejected'] = None
        if check: r.update(check(d))
        r['exit'] = exit_pty(p)
    finally:
        if proc: proc.terminate()
        shutil.rmtree(base, ignore_errors=True)
    return r

def basic(): return run('basic', 'Reply with just the word: pong', [])
def mcp():
    r = run('mcp_nolocal', 'Use the app tools: call ui_create_folder with name "Gamma". Reply with just: done', ['--allowedTools', 'mcp__app__*'], local_binding=False, use_host=True)
    r2 = run('mcp_local', 'Use the app tools: call ui_create_folder with name "Gamma". Reply with just: done', ['--allowedTools', 'mcp__app__*'], local_binding=True, use_host=True)
    return {'allowLocalBinding_false': r, 'allowLocalBinding_true': r2}
def write_outside():
    def chk(d): return {'outside_file_exists': os.path.exists(os.path.join(d['outside'], 'x.txt'))}
    # the outside directory is created per run; the prompt names it through a fixed relative sibling path
    return run('write_outside', 'Use the Bash tool to run exactly: echo x > ../outside/x.txt ; then reply with one sentence saying whether it worked, quoting any error.', ['--permission-mode', 'manual', '--allowedTools', 'Bash'], check=chk)

if __name__ == '__main__':
    which = sys.argv[1:] or ['basic', 'mcp', 'write_outside']
    report = {}
    for w in which:
        report[w] = globals()[w]()
        save('p16_report.json', report)
    print(json.dumps(report, indent=1)[:6000])
