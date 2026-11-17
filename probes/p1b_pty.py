# README: python3 p1b_pty.py [basic|mcp|perm_hook|perm_screen ...]  -- P1b/P3: interactive claude in a PTY (haiku). Completion via a Stop hook and the transcript JSONL; app MCP server config reused from P3.
import sys, os, json, time, subprocess, collections
from pty_lib import *

which = sys.argv[1:] or ['basic', 'mcp', 'perm_hook', 'perm_screen']
report = {}
LOGHOOK = f'python3 {HERE}/hooks/log_hook.py'
EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Notification', 'PermissionRequest', 'Stop', 'SessionEnd']

def settings_for(log, perm=None):
    hooks = {e: [{'hooks': [{'type': 'command', 'command': f'{LOGHOOK} {log}'}]}] for e in EVENTS}
    if perm:  # extra decision hook runs alongside the logger
        hooks['PermissionRequest'].append({'hooks': [{'type': 'command', 'command': f'python3 {HERE}/hooks/perm_hook.py {perm} {log}.perm'}]})
    return json.dumps({'hooks': hooks})

def start_host(name):
    log = os.path.join(OUT, f'p1b_{name}_host.jsonl'); st = os.path.join(OUT, f'p1b_{name}_state.json')
    for f in (log, st): open(f, 'w').close()
    proc = subprocess.Popen(['node', os.path.join(HERE, 'mcp_host.mjs'), '--serve', '--log', log, '--state', st], stdout=subprocess.PIPE, text=True, env=clean_env())
    info = json.loads(proc.stdout.readline())
    return proc, info, log, st

def summarize_transcript(path):
    rows = read_jsonl(path)
    types = collections.Counter(r.get('type') for r in rows)
    blocks = collections.Counter()
    usage_keys = set(); tool_uses = []; keys = set()
    for r in rows:
        keys |= set(r.keys())
        msg = r.get('message') if isinstance(r.get('message'), dict) else {}
        c = msg.get('content')
        if isinstance(c, list):
            for b in c:
                blocks[b.get('type')] += 1
                if b.get('type') == 'tool_use': tool_uses.append(b.get('name'))
        if msg.get('usage'): usage_keys |= set(msg['usage'].keys())
    return {'lines': len(rows), 'line_types': dict(types), 'content_block_types': dict(blocks), 'tool_uses': tool_uses, 'line_keys': sorted(keys), 'assistant_usage_keys': sorted(usage_keys), 'has_cost_field': any('cost' in k.lower() for k in keys | usage_keys)}

def run(name, prompt, extra_args, perm=None, host=None, screen_answer=None, settle=3, keep_raw=True, keep_screen=True, timeout=120):
    log = os.path.join(OUT, f'p1b_{name}_hooks.jsonl'); open(log, 'w').close()
    if perm: open(log + '.perm', 'w').close()
    raw = os.path.join(OUT, f'p1b_{name}_raw.bin') if keep_raw else None
    if raw: open(raw, 'wb').close()
    args = ['--model', 'haiku', '--setting-sources', 'user', '--permission-mode', 'manual', '--settings', settings_for(log, perm)] + extra_args
    p = Pty(args, rawlog=raw)
    t0 = time.time()
    ready = p.wait_for(r'Try\s*"|auto mode|manual|\? for shortcuts', 25)
    # SessionStart hook is the structured readiness signal
    t_ready = time.time() - t0
    time.sleep(settle); p.pump(0.5)
    mark = p.mark()
    p.type(prompt); time.sleep(0.6); p.send('\r')
    t_sent = time.time()
    screen_hits = {}
    deadline = time.time() + timeout
    stop_seen = None
    while time.time() < deadline:
        p.pump(0.4)
        ev = read_jsonl(log)
        if screen_answer and 'answered' not in screen_hits:
            m = p.wait_for(screen_answer['pattern'], 0.1, since=mark)
            if m:
                screen_hits['dialog_text'] = p.text()[mark:][-900:]
                screen_hits['answered'] = True
                time.sleep(1.0); p.send(screen_answer['keys'])
        stop_seen = next((e for e in ev if e.get('hook_event_name') == 'Stop'), None)
        if stop_seen: break
    t_stop = time.time()
    p.pump(1.0)
    ev = read_jsonl(log)
    tp = next((e.get('transcript_path') for e in ev if e.get('transcript_path')), None)
    out = {
        'startup_seconds_to_ready_text': round(t_ready, 1), 'ready_text_seen': bool(ready),
        'stop_hook_fired': bool(stop_seen), 'seconds_prompt_to_stop_hook': round(t_stop - t_sent, 1) if stop_seen else None,
        'hook_sequence': [e.get('hook_event_name') + (':' + e['tool_name'] if e.get('tool_name') else '') for e in ev if e.get('hook_event_name')],
        'hook_payload_keys': {h: sorted(next(e for e in ev if e.get('hook_event_name') == h).keys()) for h in sorted({e.get('hook_event_name') for e in ev if e.get('hook_event_name')})},
        'stop_hook_has_last_assistant_message': 'last_assistant_message' in (stop_seen or {}),
        'permission_mode_in_hooks': sorted({e.get('permission_mode') for e in ev if e.get('permission_mode')}),
        'transcript': tp.replace(os.environ['HOME'], '~') if tp else None,
        'transcript_summary': summarize_transcript(tp) if tp else None,
        'screen': screen_hits or None,
        'final_screen_tail': p.text(900) if keep_screen else '(not recorded)',
    }
    p.send('/exit\r'); p.pump(2.0)
    if p.exited is None: p.close()
    out['exit_code'] = p.exited
    out['hooks_after_exit'] = [e.get('hook_event_name') for e in read_jsonl(log)][-2:]
    return out

def basic():
    report['basic'] = run('basic', 'Reply with just the word: pong', ['--strict-mcp-config'])

def mcp():
    proc, info, hlog, st = start_host('mcp')
    try:
        r = run('mcp', 'Use the app tools: call ui_create_folder with name "Gamma", then call ui_open_file with path "/tmp/g.md". Reply with just: done',
                ['--mcp-config', json.dumps(info['config']), '--strict-mcp-config', '--allowedTools', 'mcp__app__*'])
        r['host_state'] = json.load(open(st)); r['host_rpc'] = [(c.get('method'), (c.get('params') or {}).get('name')) for c in read_jsonl(hlog) if c.get('kind') == 'rpc']
        report['mcp'] = r
    finally: proc.terminate()

def perm_hook():
    proc, info, hlog, st = start_host('perm_hook')
    try:
        r = run('perm_hook', 'Call the tool ui_create_folder with name "Delta". Reply with just: done',
                ['--mcp-config', json.dumps(info['config']), '--strict-mcp-config'], perm='allow')
        r['host_state_folders'] = [f['name'] for f in json.load(open(st))['folders'].values()]
        r['perm_hook_calls'] = len(read_jsonl(os.path.join(OUT, 'p1b_perm_hook_hooks.jsonl.perm')))
        report['perm_hook'] = r
    finally: proc.terminate()

def perm_screen():
    proc, info, hlog, st = start_host('perm_screen')
    try:
        r = run('perm_screen', 'Call the tool ui_create_folder with name "Epsilon". Reply with just: done',
                ['--mcp-config', json.dumps(info['config']), '--strict-mcp-config'],
                screen_answer={'pattern': r'Do you want|proceed|Allow', 'keys': '\r'})
        r['host_state_folders'] = [f['name'] for f in json.load(open(st))['folders'].values()]
        report['perm_screen'] = r
    finally: proc.terminate()

def main():
  for k in which:
    try: globals()[k]()
    except Exception as e:
        import traceback; report[k] = {'error': traceback.format_exc()}
  json.dump(report, open(os.path.join(OUT, 'p1b_report_' + '_'.join(which) + '.json'), 'w'), indent=1)
  print(json.dumps(report, indent=1)[:12000])

if __name__ == '__main__': main()
