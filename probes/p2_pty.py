# README: python3 p2_pty.py  -- P2 in interactive PTY mode: marketplace plugin skill, user skill and the claude.ai Atlassian connector (one read-only call). Only tool names, success/failure and deprecation text are recorded.
import json, os, re, time
from pty_lib import *
import p1b_pty as b

PROMPT = ('Do these in order. (1) Use the Skill tool to invoke the skill "plugin-dev:skill-development" with no arguments. '
          '(2) Use the Skill tool to invoke the skill "find-skills" with no arguments. '
          '(3) Find the tool atlassianUserInfo from the claude.ai Atlassian connector with ToolSearch and call it once with no arguments; call no other Atlassian tool. '
          'Final reply, exactly two lines. Line 1: SUCCESS or FAILURE for step 3. Line 2: any deprecation notice about the Atlassian endpoint quoted verbatim from your instructions or the tool result, or NONE. Never include user, site or project data.')

r = b.run('p2_pty', PROMPT, [], perm='allow', keep_raw=False, keep_screen=False, timeout=180)
tp = os.path.expanduser(r['transcript'].replace('~', os.environ['HOME'], 1)) if r['transcript'] else None
uses = {}; results = {}; final = ''
for row in read_jsonl(tp):
    msg = row.get('message') if isinstance(row.get('message'), dict) else {}
    c = msg.get('content')
    if isinstance(c, list):
        for blk in c:
            if blk.get('type') == 'tool_use': uses[blk['id']] = {'name': blk['name'], 'input_skill': blk['input'].get('skill') if blk['name'] == 'Skill' else None}
            if blk.get('type') == 'tool_result': results[blk['tool_use_id']] = {'is_error': bool(blk.get('is_error')), 'text': json.dumps(blk.get('content'))}
            if blk.get('type') == 'text' and row.get('type') == 'assistant': final = blk['text']
def sentences(s, rx): return [x.strip()[:400] for x in re.split(r'(?<=[.!?])\s+|\n', s) if re.search(rx, x, re.I)]
calls = [{'tool': u['name'], 'skill': u['input_skill'], 'is_error': results.get(i, {}).get('is_error'), 'has_result': i in results} for i, u in uses.items() if u['name'] != 'ToolSearch']
notice = sorted({x for i, rr in results.items() for x in sentences(rr['text'].replace('\\n', '\n').replace('\\"', '"'), r'deprecat|v1/mcp|v2/mcp')})
rep = {
    'stop_hook_fired': r['stop_hook_fired'], 'seconds_prompt_to_stop_hook': r['seconds_prompt_to_stop_hook'],
    'hook_sequence': r['hook_sequence'], 'calls': calls,
    'outcome': 'SUCCESS' if re.match(r'\s*SUCCESS', final, re.I) else 'FAILURE' if re.match(r'\s*FAILURE', final, re.I) else 'UNCLEAR',
    'deprecation_text_in_tool_result': notice, 'deprecation_text_in_model_reply': sentences(final, r'deprecat|v1/mcp|v2/mcp'),
    'perm_hook_calls': len(read_jsonl(os.path.join(OUT, 'p1b_p2_pty_hooks.jsonl.perm'))), 'exit_code': r['exit_code'],
}
json.dump(rep, open(os.path.join(OUT, 'p2_pty_report.json'), 'w'), indent=1)
print(json.dumps(rep, indent=1))
