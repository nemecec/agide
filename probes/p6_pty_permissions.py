# README: python3 p6_pty_permissions.py  -- P6: PermissionRequest hook in the interactive TUI for Bash, Edit and an MCP tool, with allow and deny decisions. Records the hook payload per tool, whether deny stops the call, and whether the agent sees the deny message. Haiku, empty temp dirs, manual permission mode.
import sys
from stage2_lib import *

report = json.load(open(out('p6_report.json'))) if os.path.exists(out('p6_report.json')) else {}

def scenario(name, prompt, policy, mcp=False, prep=None, check=None):
    cwd = tmpdir(); log = out(f'p6_{name}_hooks.jsonl')
    pol = out(f'p6_{name}_policy.json'); json.dump(policy, open(pol, 'w'))
    if prep: prep(cwd)
    args = ['--permission-mode', 'manual', '--strict-mcp-config']
    host = None
    if mcp:
        host = start_host(f'p6_{name}'); args += ['--mcp-config', json.dumps(host[1]['config'])]
    settings = hook_settings(log, {'PermissionRequest': [f'python3 {HERE}/hooks/perm_policy.py {pol} {log}.perm']})
    args += ['--settings', json.dumps(settings)]
    p = start_pty(args, cwd, log, raw=out(f'p6_{name}_raw.bin'))
    open(log + '.perm', 'w').close()
    submit(p, prompt)
    stopped = wait_stops(p, log, 1, 90)
    ev = events(log); perms = read_jsonl(log + '.perm')
    stop = next((e for e in ev if e.get('hook_event_name') == 'Stop'), {})
    r = {
        'stopped': stopped, 'policy': policy,
        'permission_request_payloads': perms,
        'permission_request_count': len(perms),
        'hook_sequence': [e['hook_event_name'] + (':' + e['tool_name'] if e.get('tool_name') else '') for e in ev if e.get('hook_event_name')],
        'last_assistant_message': stop.get('last_assistant_message'),
        'screen_tail': p.text(700),
        'cwd_files': sorted(os.listdir(cwd)),
    }
    if check: r.update(check(cwd, host))
    tp = transcript_of(log)
    if tp:
        rows = read_jsonl(tp); res = []
        for row in rows:
            c = (row.get('message') or {}).get('content') if isinstance(row.get('message'), dict) else None
            if isinstance(c, list):
                for b in c:
                    if b.get('type') == 'tool_result': res.append({'is_error': b.get('is_error'), 'content': str(b.get('content'))[:400]})
        r['transcript_tool_results'] = res
    r['exit_code'] = exit_pty(p)
    if host: host[0].terminate()
    report[name] = r

def prep_edit(cwd): open(os.path.join(cwd, 'f.txt'), 'w').write('alpha\n')
BASH = 'Use the Bash tool to run exactly: echo probe6 > marker.txt . Then reply with one sentence saying whether the command ran or was refused, quoting any refusal text you received.'
EDIT = 'Use the Edit tool to replace the word alpha with beta in f.txt (read it first if needed). Then reply with one sentence saying whether the edit happened or was refused, quoting any refusal text you received.'
MCP = 'Call the tool ui_create_folder with name "Zeta". Then reply with one sentence saying whether it ran or was refused, quoting any refusal text you received.'

steps = {
 'bash_deny': lambda: scenario('bash_deny', BASH, {'*': 'deny'}, check=lambda c, h: {'marker_exists': os.path.exists(os.path.join(c, 'marker.txt'))}),
 'bash_allow': lambda: scenario('bash_allow', BASH, {'*': 'allow'}, check=lambda c, h: {'marker_exists': os.path.exists(os.path.join(c, 'marker.txt'))}),
 'edit_deny': lambda: scenario('edit_deny', EDIT, {'*': 'deny'}, prep=prep_edit, check=lambda c, h: {'file_after': open(os.path.join(c, 'f.txt')).read()}),
 'edit_allow': lambda: scenario('edit_allow', EDIT, {'*': 'allow'}, prep=prep_edit, check=lambda c, h: {'file_after': open(os.path.join(c, 'f.txt')).read()}),
 'mcp_deny': lambda: scenario('mcp_deny', MCP, {'*': 'deny'}, mcp=True, check=lambda c, h: {'host_folders': [f['name'] for f in json.load(open(h[3]))['folders'].values()]}),
 'mcp_allow': lambda: scenario('mcp_allow', MCP, {'*': 'allow'}, mcp=True, check=lambda c, h: {'host_folders': [f['name'] for f in json.load(open(h[3]))['folders'].values()]}),
}
for k in (sys.argv[1:] or list(steps)):
    try: steps[k]()
    except Exception:
        import traceback; report[k] = {'error': traceback.format_exc()}
save('p6_report.json', report)
print(json.dumps({k: {x: v.get(x) for x in ('stopped', 'permission_request_count', 'marker_exists', 'file_after', 'host_folders', 'last_assistant_message', 'error')} for k, v in report.items()}, indent=1))
