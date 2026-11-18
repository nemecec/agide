# README: python3 p_perm_pty.py [case ...]  -- P20 and P21 interactive half. Each case starts the TUI in a fresh directory under probes/work/ with --permission-mode and --settings (permission rules, a PreToolUse decision hook from hooks/pretool_decide.py, a logging hook on every event incl. PermissionRequest), submits one Bash, MCP or connector prompt, and records: did a permission dialog open (PermissionRequest fired and dialog text on screen), did the call run (marker file or host state, PostToolUse), the hook payload permission_mode. A dialog is answered with Esc (deny). Connector case: ask rule plus Esc, so no connector call executes.
import sys, shutil, re
from stage2_lib import *

report = json.load(open(out('p_perm_pty_report.json'))) if os.path.exists(out('p_perm_pty_report.json')) else {}
BASH = 'Use the Bash tool to run exactly: echo p21 > marker.txt . Then reply with one sentence saying whether it ran, and quote any refusal or hook message you received verbatim.'
MCP = 'Call the tool ui_create_folder with name "P20". If it fails or is denied, quote the error text. Otherwise reply with just: done'
CONN = 'Call the connector tool whose name ends in atlassianUserInfo (search for it with ToolSearch if it is deferred), once. Reply with just ok if the call succeeded or failed if it did not. Do not repeat any data from the result.'
REWRITE = json.dumps({'command': 'echo rewritten > rewritten.txt'})
DIALOG = re.compile(r'Do\s*you\s*want\s*to|Esc\s*to\s*cancel|1\.\s*Yes', re.I)

def run(name, mode, hook=None, perms=None, prompt=BASH, mcp=False, connector=False, timeout=None, wait=75):
    cwd = tmpdir('p-m3-pty-'); log = out(f'ppty_{name}_hooks.jsonl'); dlog = out(f'ppty_{name}_decide.jsonl')
    open(dlog, 'w').close()
    extra = {'PreToolUse': [f'python3 {HERE}/hooks/pretool_decide.py {dlog} ' + (f"'{hook}'" if hook and ' ' in hook else hook)]} if hook else None
    st = hook_settings(log, extra)
    if timeout and hook: st['hooks']['PreToolUse'][-1]['hooks'][0]['timeout'] = timeout
    if perms: st['permissions'] = perms
    args = ['--permission-mode', mode, '--settings', json.dumps(st)]
    host = None
    if mcp:
        host = start_host(f'ppty_{name}'); args += ['--mcp-config', json.dumps(host[1]['config'])]
    if not connector: args.append('--strict-mcp-config')
    p = start_pty(args, cwd, log, raw=out(f'ppty_{name}_raw.bin'))
    submit(p, prompt)
    t0 = time.time(); dialog = False; answered = False
    while time.time() - t0 < wait:
        p.pump(0.4)
        if count(log, 'Stop') >= 1: break
        if count(log, 'PermissionRequest') >= 1 and not answered:
            dialog = True; p.pump(1.0); p.send(b'\x1b'); answered = True
    p.pump(1.0)
    ev = events(log)
    r = {'permission_mode_in_payloads': sorted({f"{e['tool_name']}:{e.get('permission_mode')}" for e in ev if e.get('hook_event_name') in ('PreToolUse',) and e.get('tool_name') != 'ToolSearch'}),
         'permission_request_fired': count(log, 'PermissionRequest'), 'dialog_text_on_screen_at_end_or_after': bool(DIALOG.search(p.text(1500))) , 'stopped': count(log, 'Stop') >= 1, 'answered_esc': answered,
         'post_tool_use_non_search': [e['tool_name'] for e in ev if e.get('hook_event_name') == 'PostToolUse' and e.get('tool_name') != 'ToolSearch'],
         'pre_tool_use_non_search': [e['tool_name'] for e in ev if e.get('hook_event_name') == 'PreToolUse' and e.get('tool_name') != 'ToolSearch'],
         'decision_hook_invocations': len(read_jsonl(dlog)), 'marker': os.path.exists(os.path.join(cwd, 'marker.txt')), 'rewritten': os.path.exists(os.path.join(cwd, 'rewritten.txt')),
         'permission_request_input': [json.dumps(e.get('tool_input'))[:120] for e in ev if e.get('hook_event_name') == 'PermissionRequest'],
         'last_assistant_message': next((e.get('last_assistant_message', '')[:240] for e in ev if e.get('hook_event_name') == 'Stop'), None)}
    if host: r['host_folders_created'] = len(json.load(open(host[3]))['folders']) - 1
    tp = transcript_of(log)
    if tp:
        res = []
        for row in read_jsonl(tp):
            c = (row.get('message') or {}).get('content') if isinstance(row.get('message'), dict) else None
            for b in (c if isinstance(c, list) else []):
                if b.get('type') == 'tool_result' and 'tool_reference' not in json.dumps(b.get('content')): res.append({'is_error': b.get('is_error'), 'content': str(b.get('content'))[:240]})
        r['transcript_tool_results'] = res
    r['exit'] = exit_pty(p)
    if host: host[0].terminate()
    shutil.rmtree(cwd, ignore_errors=True)
    report[name] = r
    print(name, json.dumps({k: r[k] for k in ('permission_mode_in_payloads', 'permission_request_fired', 'marker', 'rewritten', 'post_tool_use_non_search', 'stopped')}))
    json.dump(report, open(out('p_perm_pty_report.json'), 'w'), indent=1)

ASK = {'ask': ['Bash(echo p21*)']}
cases = {
  'p22_acceptEdits': lambda: run('p22_acceptEdits', 'acceptEdits'),
  'p22_plan': lambda: run('p22_plan', 'plan'),
  'p22_dontAsk': lambda: run('p22_dontAsk', 'dontAsk'),
  'p22_settings_default_plan': lambda: run('p22_settings_default_plan', 'auto', perms={'defaultMode': 'plan'}),
  'p20_auto_bash_ask_match': lambda: run('p20_auto_bash_ask_match', 'auto', perms=ASK),
  'p20_auto_bash_no_rule': lambda: run('p20_auto_bash_no_rule', 'auto'),
  'p20_auto_mcp_ask_match': lambda: run('p20_auto_mcp_ask_match', 'auto', perms={'ask': ['mcp__app__ui_create_folder']}, prompt=MCP, mcp=True),
  'p20_auto_mcp_no_rule': lambda: run('p20_auto_mcp_no_rule', 'auto', prompt=MCP, mcp=True),
  'p20_auto_connector_ask_match': lambda: run('p20_auto_connector_ask_match', 'auto', perms={'ask': ['mcp__claude_ai_Atlassian__atlassianUserInfo']}, prompt=CONN, connector=True, wait=100),
  'p21_auto_hook_allow': lambda: run('p21_auto_hook_allow', 'auto', hook='allow'),
  'p21_auto_hook_allow_vs_ask_rule': lambda: run('p21_auto_hook_allow_vs_ask_rule', 'auto', hook='allow', perms=ASK),
  'p21_auto_hook_deny_vs_allow_rule': lambda: run('p21_auto_hook_deny_vs_allow_rule', 'auto', hook='deny', perms={'allow': ['Bash(echo p21*)']}),
  'p21_auto_hook_ask': lambda: run('p21_auto_hook_ask', 'auto', hook='ask'),
  'p21_manual_hook_allow': lambda: run('p21_manual_hook_allow', 'manual', hook='allow'),
  'p21_manual_hook_allow_vs_ask_rule': lambda: run('p21_manual_hook_allow_vs_ask_rule', 'manual', hook='allow', perms=ASK),
  'p21_auto_hook_updated_input': lambda: run('p21_auto_hook_updated_input', 'auto', hook='updated:' + REWRITE),
  'p21_manual_hook_updated_input_vs_ask_rule': lambda: run('p21_manual_hook_updated_input_vs_ask_rule', 'manual', hook='updated:' + REWRITE, perms={'ask': ['Bash(echo *)']}),
  'p21_auto_hook_exit1': lambda: run('p21_auto_hook_exit1', 'auto', hook='exit1'),
  'p21_manual_hook_exit1': lambda: run('p21_manual_hook_exit1', 'manual', hook='exit1'),
  'p21_auto_hook_exit2': lambda: run('p21_auto_hook_exit2', 'auto', hook='exit2'),
  'p21_auto_hook_timeout': lambda: run('p21_auto_hook_timeout', 'auto', hook='sleep:6', timeout=2),
  'p21_manual_hook_timeout': lambda: run('p21_manual_hook_timeout', 'manual', hook='sleep:6', timeout=2),
}
for k in (sys.argv[1:] or list(cases)):
    try: cases[k]()
    except Exception as e: report[k] = {'error': repr(e)}; print(k, 'ERR', e)
