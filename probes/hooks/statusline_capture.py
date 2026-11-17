# README: status line command used by p12_statusline.py. Usage in settings: python3 statusline_capture.py <dir> [label]. Reads the status line JSON on stdin, writes it to <dir>/<session_id>.json through a temporary file and an atomic rename, appends one line (time, pid, payload) to <dir>/fires.jsonl, prints a short status text.
import sys, os, json, time
d = sys.argv[1]; label = sys.argv[2] if len(sys.argv) > 2 else ''
raw = sys.stdin.read()
try: data = json.loads(raw)
except Exception: data = None
os.makedirs(d, exist_ok=True)
if data is not None:
    sid = str(data.get('session_id', 'unknown'))
    safe = ''.join(c for c in sid if c.isalnum() or c in '-_')[:80] or 'unknown'
    tmp = os.path.join(d, f'.{safe}.{os.getpid()}.tmp')
    with open(tmp, 'w') as f: f.write(raw)
    os.replace(tmp, os.path.join(d, f'{safe}.json'))
with open(os.path.join(d, 'fires.jsonl'), 'a') as f:
    f.write(json.dumps({'t': time.time(), 'pid': os.getpid(), 'label': label, 'data': data, 'raw_len': len(raw)}) + '\n')
print(f'probe-status {label}')
