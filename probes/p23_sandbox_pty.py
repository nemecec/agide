# README: python3 p23_sandbox_pty.py  -- P23 interactive half: --settings sandbox with allowedDomains ["example.com"], auto mode, one blocked curl to example.org (the prompt tells the model not to retry). Records the screen text around the blocked call and the PostToolUse payload (tool_response).
import re, shutil
from stage2_lib import *
cwd = tmpdir('p-m3-pty-'); log = out('p23_pty_hooks.jsonl')
st = hook_settings(log); st['sandbox'] = {'enabled': True, 'network': {'allowedDomains': ['example.com']}}
p = start_pty(['--permission-mode', 'auto', '--strict-mcp-config', '--settings', json.dumps(st)], cwd, log, raw=out('p23_pty_raw.bin'))
submit(p, 'Use the Bash tool to run exactly: curl -sS -m 10 -o /dev/null -w "http=%{http_code}" https://example.org . Do not retry it or change it. Then reply with one sentence saying what happened.')
ok = wait_stops(p, log, 1, 90)
ev = events(log)
screen = re.sub(r'\s+', ' ', p.text(2500)).replace(os.path.expanduser('~'), '~')
post = [e for e in ev if e.get('hook_event_name') in ('PostToolUse', 'PostToolUseFailure') and e.get('tool_name') == 'Bash']
rep = {'stopped': ok, 'permission_request_count': count(log, 'PermissionRequest'),
       'hook_events_for_bash': [(e['hook_event_name'], re.sub(r'JAVA_HOME[^\\n]*', '', json.dumps(e.get('tool_response') or e.get('error'))[:700])) for e in post],
       'screen_tail': screen[-900:]}
rep['exit'] = exit_pty(p); shutil.rmtree(cwd, ignore_errors=True)
save('p23_pty_report.json', rep); print(json.dumps(rep, indent=1)[:2500])
