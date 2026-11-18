# README: python3 p24_trust.py [name ...]  -- P24: folder-trust dialog in the interactive TUI. For each case a fresh directory is started in a PTY with a SessionStart logging hook; records whether the dialog text appears, whether SessionStart fires, the dialog screen, and what the case wrote to the login's project trust entries (before and after, directory names reduced to the temporary prefix). Cases: default location under probes/work, OS temp directory, env CLAUDE_CODE_SANDBOXED, settings key attempts, key answers (Enter, 1, Down+Enter, Esc).
import sys, shutil, tempfile
from stage2_lib import *

CFG = os.path.join(os.environ.get('CLAUDE_CONFIG_DIR', os.path.expanduser('~/.claude')), '.claude.json')
def trust_entry(path):
    try: return (json.load(open(CFG)).get('projects', {}).get(path) or {}).get('hasTrustDialogAccepted', 'no-entry')
    except Exception as e: return f'unreadable:{e}'
report = json.load(open(out('p24_report.json'))) if os.path.exists(out('p24_report.json')) else {}
def home(s): return s.replace(os.path.expanduser('~'), '~')

def case(name, where='work', env=None, extra_args=None, settings_extra=None, answer=None, wait=14, prompt_after=False):
    base = WORK if where == 'work' else os.path.realpath(tempfile.gettempdir())
    cwd = os.path.realpath(tempfile.mkdtemp(prefix='p24-', dir=base)); log = out(f'p24_{name}_hooks.jsonl'); raw = out(f'p24_{name}_raw.bin')
    open(log, 'w').close(); open(raw, 'wb').close()
    st = hook_settings(log, events=['SessionStart', 'Stop']); st.update(settings_extra or {})
    args = ['--model', 'haiku', '--setting-sources', 'user', '--permission-mode', 'manual', '--strict-mcp-config', '--settings', json.dumps(st)] + (extra_args or [])
    before = trust_entry(cwd)
    p = Pty(args, cwd=cwd, env=env, rawlog=raw)
    t0 = time.time(); seen_dialog = None; started = None
    while time.time() - t0 < wait:
        p.pump(0.3)
        if seen_dialog is None and 'Quicksafetycheck' in p.text().replace(' ', ''): seen_dialog = round(time.time() - t0, 1)
        if count(log, 'SessionStart'): started = round(time.time() - t0, 1); break
    r = {'cwd_kind': 'probes/work/p24-*' if where == 'work' else 'os-temp/p24-*', 'dialog_seen_s': seen_dialog, 'session_start_s': started,
         'screen_when_dialog': re.sub(r'\s+', ' ', p.text(900)).replace(os.path.expanduser('~'), '~')[-700:] if seen_dialog else None, 'trust_entry_before': before}
    if seen_dialog is not None and answer:
        keys = {'enter': b'\r', '1': b'1', 'down_enter': b'\x1b[B\r', 'esc': b'\x1b', 'up_enter': b'\x1b[A\r'}[answer]
        p.send(keys); t1 = time.time()
        while time.time() - t1 < 20:
            p.pump(0.3)
            if count(log, 'SessionStart'): r['session_start_after_answer_s'] = round(time.time() - t1, 1); break
            if p.exited is not None: break
        r['answer'] = answer; r['exited_after_answer'] = p.exited
        r['screen_after_answer'] = re.sub(r'\s+', ' ', p.text(500)).replace(os.path.expanduser('~'), '~')[-300:]
    r['trust_entry_after'] = trust_entry(cwd)
    r['exit'] = exit_pty(p) if started or answer else (p.close() or p.exited)
    shutil.rmtree(cwd, ignore_errors=True)
    report[name] = r
    print(name, json.dumps({k: v for k, v in r.items() if not k.startswith('screen')}))

steps = {
  'default_work': lambda: case('default_work', answer='esc'),
  'default_temp': lambda: case('default_temp', where='temp', answer='esc'),
  'sandboxed_env': lambda: case('sandboxed_env', where='temp', env={'CLAUDE_CODE_SANDBOXED': '1'}),
  'settings_key': lambda: case('settings_key', where='temp', settings_extra={'hasTrustDialogAccepted': True, 'projects': {}}, answer='esc'),
  'bypass_flag': lambda: case('bypass_flag', where='temp', extra_args=['--dangerously-skip-permissions'], answer='esc'),
  'key_enter': lambda: case('key_enter', where='temp', answer='enter'),
  'key_1': lambda: case('key_1', where='temp', answer='1'),
  'key_down_enter': lambda: case('key_down_enter', where='temp', answer='down_enter'),
}
for k in (sys.argv[1:] or list(steps)):
    try: steps[k]()
    except Exception as e: report[k] = {'error': repr(e)}; print(k, 'ERR', e)
    json.dump(report, open(out('p24_report.json'), 'w'), indent=1)
