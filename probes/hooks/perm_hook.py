# README: PermissionRequest hook used by p1c_permissions.mjs. Usage in settings: python3 perm_hook.py <allow|deny|none> <logfile>. Reads the hook JSON on stdin, appends it to logfile, prints a decision.
import sys, json
mode, log = sys.argv[1], sys.argv[2]
raw = sys.stdin.read()
try: data = json.loads(raw)
except Exception: data = {'_unparsed': raw[:500]}
with open(log, 'a') as f: f.write(json.dumps(data) + '\n')
if mode == 'allow':
    print(json.dumps({'hookSpecificOutput': {'hookEventName': 'PermissionRequest', 'decision': {'behavior': 'allow'}}}))
elif mode == 'deny':
    print(json.dumps({'hookSpecificOutput': {'hookEventName': 'PermissionRequest', 'decision': {'behavior': 'deny', 'message': 'denied by probe hook'}}}))
