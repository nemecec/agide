# README: PermissionRequest hook that waits before answering. Usage in settings: python3 perm_wait.py <allow|deny> <seconds> <logfile>. Appends a "start" line (time, tool name) when called, sleeps, appends a "decide" line, prints the decision. A killed hook leaves no "decide" line.
import sys, json, time
mode, secs, log = sys.argv[1], float(sys.argv[2]), sys.argv[3]
data = json.loads(sys.stdin.read() or '{}')
def w(o):
    with open(log, 'a') as f: f.write(json.dumps({'t': time.time(), **o}) + '\n')
w({'phase': 'start', 'tool_name': data.get('tool_name')})
time.sleep(secs)
w({'phase': 'decide', 'mode': mode})
d = {'behavior': 'allow'} if mode == 'allow' else {'behavior': 'deny', 'message': 'denied by the waiting probe hook'}
print(json.dumps({'hookSpecificOutput': {'hookEventName': 'PermissionRequest', 'decision': d}}))
