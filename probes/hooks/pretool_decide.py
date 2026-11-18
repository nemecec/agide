# README: PreToolUse hook for the milestone 3 permission probes. Usage in settings: python3 pretool_decide.py <logfile> <mode>. Appends the stdin JSON to logfile with a timestamp, then acts on mode: none, allow, deny, ask, updated:<json object for updatedInput>, exit1, exit2, sleep:<seconds> (then allow).
import sys, json, time
log, mode = sys.argv[1], sys.argv[2]
raw = sys.stdin.read()
try: data = json.loads(raw)
except Exception: data = {'_unparsed': raw[:500]}
data['_logged_at'] = time.time(); data['_mode'] = mode
with open(log, 'a') as f: f.write(json.dumps(data) + '\n')

def out(decision, reason=None, updated=None):
    o = {'hookEventName': 'PreToolUse', 'permissionDecision': decision}
    if reason: o['permissionDecisionReason'] = reason
    if updated is not None: o['updatedInput'] = updated
    print(json.dumps({'hookSpecificOutput': o}))

if mode in ('allow', 'ask'): out(mode, f'hook says {mode}')
elif mode == 'deny': out('deny', 'denied by probe hook')
elif mode.startswith('updated:'):
    out('allow', 'hook rewrote input', json.loads(mode[len('updated:'):]))
elif mode == 'exit1': sys.stderr.write('probe hook exit 1\n'); sys.exit(1)
elif mode == 'exit2': sys.stderr.write('probe hook blocks with exit 2\n'); sys.exit(2)
elif mode.startswith('sleep:'):
    time.sleep(float(mode[6:])); out('allow', 'after sleep')
