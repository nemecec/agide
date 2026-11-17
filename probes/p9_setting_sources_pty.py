# README: python3 p9_setting_sources_pty.py [config ...]  -- P9 in the PTY: fixture checkout (project .mcp.json, project hook, CLAUDE.md) under --setting-sources user with and without --strict-mcp-config, plus a control with all sources. Records dialogs shown at start, project server and hook markers, whether CLAUDE.md is read, the /mcp screen text (server list), and one read-only connector call (atlassianUserInfo, result not stored) on the non-strict runs. Haiku.
import sys, subprocess, re
from stage2_lib import *

CONFIGS = {'user_only': ['--setting-sources', 'user'], 'user_strict': ['--setting-sources', 'user', '--strict-mcp-config'], 'all_sources': ['--setting-sources', 'user,project,local']}
PROMPT = 'What is the project codeword in your instructions? Reply with the codeword exactly as written, or NONE if you have no such instruction. No tools.'
prev = out('p9_pty_report.json')
report = json.load(open(prev)) if os.path.exists(prev) else {}

def one(name):
    checkout = subprocess.check_output(['python3', os.path.join(HERE, 'make_checkout.py'), f'p9pty-{name}'], text=True).strip()
    markers = checkout + '-markers'
    log = out(f'p9_pty_{name}_hooks.jsonl'); pol = out(f'p9_pty_{name}_policy.json')
    json.dump({'mcp__claude_ai_Atlassian__atlassianUserInfo': 'allow'}, open(pol, 'w'))
    settings = hook_settings(log, {'PermissionRequest': [f'python3 {HERE}/hooks/perm_policy.py {pol} {log}.perm']})
    args = CONFIGS[name] + ['--permission-mode', 'manual', '--settings', json.dumps(settings)]
    raw = out(f'p9_pty_{name}_raw.bin'); open(raw, 'wb').close()
    # setting-sources must be passed once; start_pty adds user, so build the Pty directly
    open(log, 'w').close(); open(log + '.perm', 'w').close()
    p = Pty(['--model', 'haiku'] + args, cwd=checkout, rawlog=raw)
    deadline = time.time() + 30
    while time.time() < deadline and count(log, 'SessionStart') == 0: p.pump(0.3)
    p.pump(3.0)
    start_screen = p.text(1200)
    dialog = bool(re.search(r'\.mcp\.json|MCP\s*server|trust', start_screen, re.I))
    if name == 'all_sources' and re.search(r'MCP\s*server\s*found', start_screen, re.I):
        p.send(b'\x1b[A'); p.pump(0.3); p.send(b'\x1b[A'); p.pump(0.3); p.send('\r'); p.pump(4.0)
    submit(p, PROMPT); wait_stops(p, log, 1, 90)
    stop = next((e for e in events(log) if e.get('hook_event_name') == 'Stop'), {})
    answer = stop.get('last_assistant_message')
    # /mcp screen
    mark = p.mark(); p.type('/mcp'); time.sleep(0.8); p.send('\r'); p.pump(2.0); p.send('\r'); p.pump(4.0)
    mcp_screen = p.text()[mark:]
    p.send(b'\x1b'); p.pump(1.0); p.send(b'\x1b'); p.pump(1.0)
    n0 = count(log, 'Stop')
    submit(p, 'List the distinct MCP server name prefixes (the part after mcp__ and before the next double underscore) of every tool whose name starts with mcp__ in your tool lists, including deferred tools, comma separated, or NONE. No tool calls.')
    wait_stops(p, log, n0 + 1, 90)
    listing = [e for e in events(log) if e.get('hook_event_name') == 'Stop'][-1].get('last_assistant_message')
    connector = None
    if name != 'user_strict':
        n = count(log, 'Stop')
        submit(p, 'Use ToolSearch to find the tool atlassianUserInfo of the claude.ai Atlassian connector, call it once, and reply with exactly SUCCESS or FAILURE. Do not repeat any data from the result.')
        ok = wait_stops(p, log, n + 1, 150)
        s2 = [e for e in events(log) if e.get('hook_event_name') == 'Stop'][-1]
        connector = {'stopped': ok, 'reply': (s2.get('last_assistant_message') or '')[:40], 'permission_requests': [r.get('tool_name') for r in read_jsonl(log + '.perm')]}
    exit_pty(p)
    read = lambda f: open(os.path.join(markers, f)).read().split() if os.path.exists(os.path.join(markers, f)) else None
    names = re.findall(r'(?:claude\.ai [A-Za-z0-9 ._-]+?|projfix|grafana|coralogix|codex)(?=\s|·|✔|✘|$)', mcp_screen)
    report[name] = {'flags': CONFIGS[name], 'start_dialog_text_seen': dialog, 'start_screen_tail': start_screen[-500:], 'project_mcp_server_started': os.path.exists(os.path.join(markers, 'mcp_started.txt')),
                    'project_hook_ran': read('hook_ran.txt'), 'claude_md_answer': (answer or '')[:80], 'mcp_screen': mcp_screen[:3000], 'model_listed_mcp_prefixes': listing, 'mentions_projfix': 'projfix' in mcp_screen, 'mentions_claude_ai': 'claude.ai' in mcp_screen, 'connector_call': connector}
    save('p9_pty_report.json', report)

for k in (sys.argv[1:] or CONFIGS):
    try: one(k)
    except Exception:
        import traceback; report[k] = {'error': traceback.format_exc()}; save('p9_pty_report.json', report)
for k, v in report.items(): print(k, {x: v.get(x) for x in v if x not in ('mcp_screen', 'start_screen_tail', 'flags')})
