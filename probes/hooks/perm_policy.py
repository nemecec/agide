# README: PermissionRequest hook with a per-tool policy. Usage in settings: python3 perm_policy.py <policy.json> <logfile>. policy.json maps a tool name (or "*") to allow, deny or none. Logs the stdin JSON, prints the decision.
import sys, json
policy_file, log = sys.argv[1], sys.argv[2]
raw = sys.stdin.read()
try: data = json.loads(raw)
except Exception: data = {'_unparsed': raw[:500]}
policy = json.load(open(policy_file))
mode = policy.get(data.get('tool_name'), policy.get('*', 'none'))
with open(log, 'a') as f: f.write(json.dumps(data) + '\n')
if mode == 'allow':
    print(json.dumps({'hookSpecificOutput': {'hookEventName': 'PermissionRequest', 'decision': {'behavior': 'allow'}}}))
elif mode == 'deny':
    print(json.dumps({'hookSpecificOutput': {'hookEventName': 'PermissionRequest', 'decision': {'behavior': 'deny', 'message': 'DENIED-BY-HOST-PROBE6: the desktop app refused this tool call'}}}))
