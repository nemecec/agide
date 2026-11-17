# README: python3 pty_explore.py  -- starts interactive claude in a PTY with logging hooks, prints the startup screen text so prompts can be recognised. Exits after ~25 s.
import sys, os, json, time
from pty_lib import *
log = os.path.join(OUT, 'explore_hooks.jsonl'); open(log, 'w').close()
hook = f'python3 {HERE}/hooks/log_hook.py {log}'
settings = json.dumps({'hooks': {e: [{'hooks': [{'type': 'command', 'command': hook}]}] for e in ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SessionEnd']}})
p = Pty(['--model', 'haiku', '--setting-sources', 'user', '--strict-mcp-config', '--settings', settings], rawlog=os.path.join(OUT, 'explore_raw.bin'))
open(os.path.join(OUT, 'explore_raw.bin'), 'wb').close()
p.pump(12)
print(p.text()[-3000:])
p.close()
print('hooks seen:', [h.get('hook_event_name') for h in read_jsonl(log)])
