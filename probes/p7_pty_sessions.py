# README: python3 p7_pty_sessions.py  -- P7: --session-id, --resume and --fork-session in the interactive TUI. Creates a session with a chosen id, resumes it, forks it with and without a chosen new id, and reuses the id. Records the session_id in hooks, transcript paths and whether history carries over. Haiku, one empty temp dir.
import sys, uuid
from stage2_lib import *

report = {}
cwd = tmpdir()
A = str(uuid.uuid4()); F1 = str(uuid.uuid4())

def session(name, args, prompt, timeout=60):
    log = out(f'p7_{name}_hooks.jsonl')
    p = start_pty(args + ['--permission-mode', 'manual', '--strict-mcp-config', '--settings', json.dumps(hook_settings(log))], cwd, log, raw=out(f'p7_{name}_raw.bin'))
    r = {'args': args, 'session_start_events': [{k: e.get(k) for k in ('session_id', 'source', 'transcript_path')} for e in events(log) if e.get('hook_event_name') == 'SessionStart']}
    if prompt:
        submit(p, prompt); r['stopped'] = wait_stops(p, log, 1, timeout)
        stop = next((e for e in events(log) if e.get('hook_event_name') == 'Stop'), {})
        r['last_assistant_message'] = stop.get('last_assistant_message')
        r['prompt_session_ids'] = sorted({e.get('session_id') for e in events(log) if e.get('hook_event_name') in ('UserPromptSubmit', 'Stop')})
    else:
        p.pump(2.0)
    r['screen_tail'] = p.text(500)
    tp = transcript_of(log)
    r['transcript'] = tp.replace(os.environ['HOME'], '~') if tp else None
    r['transcript_basename'] = os.path.basename(tp) if tp else None
    r['exit_code'] = exit_pty(p)
    report[name] = r
    return r

def tpath(r): return os.path.expanduser(r['transcript']) if r.get('transcript') else None
def nlines(path): return len(open(path).readlines()) if path and os.path.exists(path) else None

session('a_create', ['--session-id', A], 'Remember this secret word: PLUM-7. Reply with just: ok')
pa = tpath(report['a_create']); report['a_create']['transcript_lines_after'] = nlines(pa)
report['a_create']['transcript_name_matches_id'] = report['a_create']['transcript_basename'] == f'{A}.jsonl'

session('b_resume', ['--resume', A], 'What was the secret word? Reply with just the word.')
report['b_resume']['transcript_lines_after'] = nlines(pa)
report['b_resume']['same_transcript_file'] = report['b_resume']['transcript_basename'] == f'{A}.jsonl'

before = nlines(pa)
session('c_fork', ['--resume', A, '--fork-session'], 'What was the secret word? Reply with just the word.')
r = report['c_fork']; r['original_lines_before'] = before; r['original_lines_after'] = nlines(pa)
r['fork_is_new_file'] = r['transcript_basename'] not in (None, f'{A}.jsonl'); r['fork_lines'] = nlines(tpath(r))

session('d_fork_chosen_id', ['--resume', A, '--fork-session', '--session-id', F1], 'What was the secret word? Reply with just the word.')
r = report['d_fork_chosen_id']; r['transcript_name_matches_chosen_id'] = r['transcript_basename'] == f'{F1}.jsonl'; r['original_lines_after'] = nlines(pa)

session('e_session_id_reuse', ['--session-id', A], None)
report['e_session_id_reuse']['note'] = 'session-id of an existing session without --resume; screen_tail shows the result'

session('f_resume_with_chosen_id_no_fork', ['--resume', A, '--session-id', str(uuid.uuid4())], None)

report['ids'] = {'A': A, 'F1': F1}
save('p7_report.json', report)
for k, v in report.items():
    if k != 'ids': print(k, {x: v.get(x) for x in ('stopped', 'last_assistant_message', 'prompt_session_ids', 'transcript_basename', 'transcript_name_matches_id', 'same_transcript_file', 'fork_is_new_file', 'original_lines_before', 'original_lines_after', 'transcript_name_matches_chosen_id', 'exit_code')})
