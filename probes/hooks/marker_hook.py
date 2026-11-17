# README: python3 marker_hook.py <marker_file>  -- hook command that records that it ran by appending the event name to the marker file. Prints nothing.
import sys, json
raw = sys.stdin.read()
try: name = json.loads(raw).get('hook_event_name')
except Exception: name = '?'
with open(sys.argv[1], 'a') as f: f.write(f'{name}\n')
