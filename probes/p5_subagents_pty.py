# README: python3 p5_subagents_pty.py -- P5 in the interactive TUI (haiku): two parallel subagents, with SubagentStart/SubagentStop/PreToolUse/PostToolUse/Stop hooks logged through --settings. Prints the hook sequence, payload keys and the transcript tree on disk.
import os, json, time, glob
from pty_lib import *

LOG = os.path.join(OUT, 'p5_pty_hooks.jsonl'); open(LOG, 'w').close()
EVENTS = ['SessionStart', 'SubagentStart', 'SubagentStop', 'PreToolUse', 'PostToolUse', 'Notification', 'PermissionRequest', 'Stop']
hooks = {e: [{'hooks': [{'type': 'command', 'command': f'python3 {HERE}/hooks/log_hook.py {LOG}'}]}] for e in EVENTS}
args = ['--model', 'haiku', '--setting-sources', 'user', '--strict-mcp-config', '--permission-mode', 'acceptEdits', '--settings', json.dumps({'hooks': hooks})]
p = Pty(args, rawlog=os.path.join(OUT, 'p5_pty_raw.bin'))
p.wait_for(r'\? for shortcuts|Try\s*"', 25); time.sleep(3); p.pump(0.5)
p.type('Use the Agent tool to start exactly two subagents in the same message so they run in parallel. Each replies with only the word ok. Use no other tool. When both are done reply with the word done.')
time.sleep(0.6); p.send('\r')
screens = []
deadline = time.time() + 120
while time.time() < deadline:
    p.pump(0.5)
    ev = read_jsonl(LOG)
    if any(e.get('hook_event_name') == 'SubagentStart' for e in ev) and len(screens) < 3:
        screens.append(p.text(700))  # what the TUI shows while agents run
    if any(e.get('hook_event_name') == 'Stop' for e in ev): break
p.pump(1.0)
ev = read_jsonl(LOG)
t0 = ev[0]['_logged_at'] if ev else 0
seq = [(round(e['_logged_at'] - t0, 2), e['hook_event_name'], e.get('agent_id'), e.get('tool_name')) for e in ev]
keys = {h: sorted(next(e for e in ev if e['hook_event_name'] == h).keys()) for h in sorted({e['hook_event_name'] for e in ev})}
tp = next((e.get('transcript_path') for e in ev if e.get('transcript_path')), None)
tree = []
if tp:
    base = tp[:-6]
    for root, _, files in os.walk(base):
        for f in sorted(files): tree.append(os.path.relpath(os.path.join(root, f), os.path.dirname(tp)))
metas = {}
for f in tree:
    if f.endswith('.json'): metas[f] = open(os.path.join(os.path.dirname(tp), f)).read()[:600]
stop_ev = [e for e in ev if e['hook_event_name'] == 'SubagentStop']
report = {'sequence': seq, 'payload_keys': keys, 'tree_under_session_dir': tree, 'meta_files': metas,
          'subagent_stop_sample': {k: (str(v)[:200]) for k, v in (stop_ev[0] if stop_ev else {}).items()},
          'screen_while_running': screens[:1], 'final_screen_tail': p.text(600)}
open(os.path.join(OUT, 'p5_pty_report.json'), 'w').write(json.dumps(report, indent=1))
p.send('/exit\r'); p.pump(2.0)
if p.exited is None: p.close()
print(json.dumps({k: report[k] for k in ('sequence', 'payload_keys', 'tree_under_session_dir', 'meta_files')}, indent=1)[:5000])
