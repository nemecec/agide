# README: python3 p13_transcript_usage.py [--old]  -- P13: usage data in session transcripts. Runs a short interactive session with two parallel subagents (Haiku, empty temp dir, acceptEdits mode), then parses the main transcript and the subagent transcripts under the session directory: usage fields per assistant line, repeated message ids, cache token fields, cost-relevant fields. With --old it also parses the transcripts named by earlier probe hook logs when the files still exist. A status line command captures the session cost for comparison.
import sys, collections
from m2_lib import *

CAP = f'python3 {HERE}/hooks/statusline_capture.py'

def usage_rows(path):
    rows = []
    for i, row in enumerate(read_jsonl(path)):
        m = row.get('message')
        if row.get('type') == 'assistant' and isinstance(m, dict) and isinstance(m.get('usage'), dict):
            rows.append({'line': i, 'message_id': m.get('id'), 'model': m.get('model'), 'stop_reason': m.get('stop_reason'), 'usage': m['usage'], 'uuid': row.get('uuid'), 'is_sidechain': row.get('isSidechain'), 'agent_id': row.get('agentId'), 'ts': row.get('timestamp'), 'content_types': [b.get('type') for b in (m.get('content') or []) if isinstance(b, dict)]})
    return rows

def flat_keys(d, pre=''):
    o = set()
    for k, v in d.items():
        if isinstance(v, dict): o |= flat_keys(v, pre + k + '.')
        else: o.add(pre + k)
    return o

def analyse(path):
    rows = usage_rows(path)
    keys = set()
    for r in rows: keys |= flat_keys(r['usage'])
    by_id = collections.defaultdict(list)
    for r in rows: by_id[r['message_id']].append(r)
    dup = {k: len(v) for k, v in by_id.items() if len(v) > 1}
    # last line per message id carries the final output_tokens; sum over distinct ids
    tot = collections.Counter()
    for mid, rs in by_id.items():
        u = rs[-1]['usage']
        for k in ('input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'): tot[k] += u.get(k) or 0
    return {'assistant_lines_with_usage': len(rows), 'distinct_message_ids': len(by_id), 'ids_on_several_lines': len(dup), 'usage_key_paths': sorted(keys), 'sum_last_line_per_id': dict(tot), 'models': sorted({str(r['model']) for r in rows}), 'sample': rows[:1] and {k: rows[0][k] for k in ('message_id', 'usage', 'content_types', 'is_sidechain')}, 'sample_multi_line': next(([{'line': r['line'], 'content_types': r['content_types'], 'output_tokens': r['usage'].get('output_tokens'), 'stop_reason': r['stop_reason']} for r in v] for v in by_id.values() if len(v) > 1), None)}

report = {}
cwd = tmpdir(); log = out('p13_hooks.jsonl'); cap = out('p13_cap'); os.makedirs(cap, exist_ok=True)
for f in os.listdir(cap): os.remove(os.path.join(cap, f))
settings = hook_settings(log, events=EVENTS + ['SubagentStart', 'SubagentStop']); settings['statusLine'] = {'type': 'command', 'command': f'{CAP} {cap} p13'}
p = start_pty2(['--permission-mode', 'acceptEdits', '--strict-mcp-config', '--settings', json.dumps(settings)], cwd, log, raw=out('p13_raw.bin'))
submit(p, 'Use the Agent tool to start exactly two subagents in the same message so they run in parallel. Each replies with only the word ok. Use no other tool. When both are done reply with the word done.')
report['stopped'] = wait_stops(p, log, 1, 120)
p.pump(3.0)
tp = transcript_of(log)
fs = read_jsonl(os.path.join(cap, 'fires.jsonl'))
report['statusline_last_cost'] = fs[-1]['data'].get('cost') if fs else None
report['statusline_last_context_window'] = fs[-1]['data'].get('context_window') if fs else None
report['exit_code'] = exit_pty(p)
if tp:
    sdir = tp[:-6]
    files = []
    for root, _, fl in os.walk(sdir):
        for f in sorted(fl): files.append(os.path.relpath(os.path.join(root, f), os.path.dirname(tp)))
    report['files_under_session_dir'] = files
    report['main'] = analyse(tp)
    report['subagents'] = {f: analyse(os.path.join(os.path.dirname(tp), f)) for f in files if f.endswith('.jsonl')}
    report['subagent_meta'] = {f: open(os.path.join(os.path.dirname(tp), f)).read()[:300] for f in files if f.endswith('.json')}
    report['subagent_stop_payload_keys'] = sorted(next((e for e in events(log) if e.get('hook_event_name') == 'SubagentStop'), {}))
    allrows = usage_rows(tp)
    # relation of tool_result line for the Agent tool to usage text, if any
    res = []
    for row in read_jsonl(tp):
        tr = row.get('toolUseResult')
        if isinstance(tr, dict) and ('usage' in tr or 'totalTokens' in tr): res.append({k: tr[k] for k in tr if k in ('agentId', 'totalTokens', 'totalDurationMs', 'totalToolUseCount', 'usage', 'status')})
    report['agent_tool_result_usage'] = res[:3]
if '--old' in sys.argv:
    import glob
    old = {}
    for lg in sorted(glob.glob(out('p5_pty_hooks.jsonl')) + glob.glob(out('p6_*_hooks.jsonl'))[:2]):
        t = next((e['transcript_path'] for e in read_jsonl(lg) if e.get('transcript_path')), None)
        if t and os.path.exists(t): old[os.path.basename(lg)] = analyse(t)
        else: old[os.path.basename(lg)] = 'transcript file no longer on disk' if t else 'no transcript path'
    report['earlier_probe_transcripts'] = old
save('p13_report.json', report)
print(json.dumps(report, indent=1)[:9000])
