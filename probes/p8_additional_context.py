# README: python3 p8_additional_context.py [p|pty ...]   (env P8_ONLY=case,case limits the cases)  -- P8: a UserPromptSubmit hook injects additionalContext (or plain stdout) of several sizes, in -p and in the PTY. The prompt asks which TAG-* tokens the model sees outside the user message; tools are disabled so the answer shows what the context carries directly. Records the answer, hook log and transcript form of the context. Haiku.
import sys, subprocess
from stage2_lib import *

report = {}
PROMPT = 'Without using any tool: list every token that starts with TAG- and appears anywhere in your context outside this user message, one per line, or write NONE. Then say in one line whether you were told to end replies with a particular word.'
CASES = [('small_json', 'json', 200, 'neutral'), ('small_stdout', 'stdout', 200, 'neutral'), ('mid_json', 'json', 5000, 'neutral'),
         ('big_json', 'json', 12000, 'neutral'), ('huge_json', 'json', 60000, 'neutral'), ('imperative_json', 'json', 200, 'imperative'),
         ('edge_9900_json', 'json', 9900, 'neutral'), ('edge_10100_json', 'json', 10100, 'neutral')]

def cfg(name, mode, size, style, log):
    hook = f'python3 {HERE}/hooks/ctx_hook.py {mode} {size} {style} {log}.ctx'
    return json.dumps(hook_settings(log, {'UserPromptSubmit': [hook]}))

def ctx_in_transcript(tp):
    rows = read_jsonl(tp) if tp else []
    found = []
    for r in rows:
        s = json.dumps(r)
        if 'TAG-START-4417' in s: found.append({'type': r.get('type'), 'keys': sorted(r.keys()), 'attachment_type': (r.get('attachment') or {}).get('type') if isinstance(r.get('attachment'), dict) else None, 'len': len(s), 'has_end_tag': 'TAG-END-6639' in s, 'has_hookAdditionalContext_key': 'hookAdditionalContext' in r})
    return found

def run_p(name, mode, size, style):
    cwd = tmpdir(); log = out(f'p8_p_{name}_hooks.jsonl'); open(log, 'w').close(); open(log + '.ctx', 'w').close()
    args = ['-p', PROMPT, '--output-format', 'json', '--model', 'haiku', '--max-budget-usd', '0.25', '--setting-sources', 'user', '--strict-mcp-config', '--tools', '', '--settings', cfg(name, mode, size, style, log)]
    r = subprocess.run([CLAUDE] + args, cwd=cwd, env=clean_env(), capture_output=True, text=True, timeout=120, stdin=subprocess.DEVNULL)
    try: res = json.loads(r.stdout)
    except Exception: res = {'raw': r.stdout[:500]}
    save(f'p8_p_{name}_result.json', res)
    ev = events(log)
    tp = next((e.get('transcript_path') for e in ev if e.get('transcript_path')), None)
    report[f'p_{name}'] = {'exit': r.returncode, 'answer': res.get('result'), 'cost_usd': res.get('total_cost_usd'), 'hook_runs': read_jsonl(log + '.ctx'), 'stderr': r.stderr[-300:], 'transcript_context_lines': ctx_in_transcript(tp)}

def run_pty(name, mode, size, style):
    cwd = tmpdir(); log = out(f'p8_pty_{name}_hooks.jsonl'); open(log + '.ctx', 'w').close()
    p = start_pty(['--permission-mode', 'manual', '--strict-mcp-config', '--tools', '', '--settings', cfg(name, mode, size, style, log)], cwd, log, raw=out(f'p8_pty_{name}_raw.bin'))
    submit(p, PROMPT); stopped = wait_stops(p, log, 1, 90)
    stop = next((e for e in events(log) if e.get('hook_event_name') == 'Stop'), {})
    tp = transcript_of(log)
    report[f'pty_{name}'] = {'stopped': stopped, 'answer': stop.get('last_assistant_message'), 'hook_runs': read_jsonl(log + '.ctx'), 'transcript_context_lines': ctx_in_transcript(tp)}
    exit_pty(p)

want = sys.argv[1:] or ['p', 'pty']
prev = out('p8_report.json')
if os.path.exists(prev): report.update(json.load(open(prev)))
only = os.environ.get('P8_ONLY')
for c in CASES:
    if only and c[0] not in only.split(','): continue
    for path, fn in (('p', run_p), ('pty', run_pty)):
        if path in want:
            try: fn(*c)
            except Exception:
                import traceback; report[f'{path}_{c[0]}'] = {'error': traceback.format_exc()}
            save('p8_report.json', report)
for k, v in report.items(): print(k, '|', (v.get('answer') or v.get('error') or '')[:240].replace('\n', ' / '))
