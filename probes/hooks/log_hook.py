# README: generic hook logger used by the PTY probes. Usage in settings: python3 log_hook.py <logfile>. Appends the hook's stdin JSON as one line; prints nothing (no decision).
import sys, json, time
raw = sys.stdin.read()
try: data = json.loads(raw)
except Exception: data = {'_unparsed': raw[:500]}
data['_logged_at'] = time.time()
with open(sys.argv[1], 'a') as f: f.write(json.dumps(data) + '\n')
