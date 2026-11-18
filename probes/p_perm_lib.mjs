// README: shared helpers for the milestone 3 permission probes P20 to P24 (Node ESM). Not run directly. scenario() runs one -p stream-json session in a fresh directory under probes/work/ with the stdio permission prompt tool, so that every prompt shows up as a can_use_tool control request (answered with deny, or with allow when promptAnswer is "allow").
import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { startStream, userMsg, initOf, resultsOf, save, WORK, OUT, HERE } from './lib.mjs';

export const HOOK = join(HERE, 'hooks', 'pretool_decide.py');
export const fresh = (prefix = 'p-m3-') => mkdtempSync(join(WORK, prefix));
export const hookCmd = (log, mode) => `python3 ${HOOK} ${log} ${mode.includes(' ') ? `'${mode}'` : mode}`;
export const preToolHook = (log, mode, matcher, timeout) => ({ PreToolUse: [{ ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command: hookCmd(log, mode), ...(timeout ? { timeout } : {}) }] }] });
export const readLog = (p) => (existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return { _unparsed: l }; } }) : []);

export async function scenario(name, { prompt, args = [], settings, cwd = fresh(), promptAnswer = 'deny', timeoutMs = 150000, prep, saveEvents = true, strict = true } = {}) {
  if (prep) prep(cwd);
  const a = ['--permission-prompt-tool', 'stdio', '--include-hook-events', ...(strict ? ['--strict-mcp-config'] : []), ...args];
  if (settings) a.push('--settings', JSON.stringify(settings));
  const h = startStream(a, { cwd });
  const prompts = [];
  const iv = setInterval(() => {
    for (const e of h.events) {
      if (e._seen) continue; e._seen = true;
      if (e.type === 'control_request' && e.request?.subtype === 'can_use_tool') {
        prompts.push({ tool_name: e.request.tool_name, input: e.request.input, suggestions: e.request.permission_suggestions, decision_reason: e.request.decision_reason, title: e.request.title, keys: Object.keys(e.request) });
        h.send({ type: 'control_response', response: { subtype: 'success', request_id: e.request_id, response: promptAnswer === 'allow' ? { behavior: 'allow', updatedInput: e.request.input } : { behavior: 'deny', message: 'probe host denies' } } });
      }
    }
  }, 40);
  h.send(userMsg(prompt));
  const done = await h.waitResult(1, timeoutMs);
  if (!done) h.kill('SIGKILL');
  await h.end(); clearInterval(iv);
  if (saveEvents) save(`${name}.jsonl`, h.events.map((e) => JSON.stringify(e)).join('\n'));
  const r = resultsOf(h.events)[0];
  const uses = [], results = [];
  for (const e of h.events) for (const b of e.message?.content || []) {
    if (b.type === 'tool_use' && b.name !== 'ToolSearch') uses.push({ name: b.name, input: b.input });
    if (b.type === 'tool_result' && !JSON.stringify(b.content).includes('tool_reference')) results.push({ is_error: !!b.is_error, content: JSON.stringify(b.content).slice(0, 300) });
  }
  const init = initOf(h.events);
  return { name, cwd, finished: done, permissionMode: init?.permissionMode, result: String(r?.result).slice(0, 200), subtype: r?.subtype, permission_denials: (r?.permission_denials || []).map((d) => d.tool_name), prompts, tool_uses: uses, tool_results: results, stderr: h.stderr.slice(0, 300), cost: r?.total_cost_usd,
    hook_events: h.events.filter((e) => e.type === 'system' && /hook/.test(e.subtype || '')).map((e) => ({ subtype: e.subtype, hook_event: e.hook_event, hook_name: e.hook_name, outcome: e.outcome, exit_code: e.exit_code, stderr: String(e.stderr || '').slice(0, 200), output: String(e.output || e.stdout || '').slice(0, 300) })), };
}
export const exists = (cwd, f) => existsSync(join(cwd, f));
export const cleanup = (cwd) => { try { rmSync(cwd, { recursive: true, force: true }); } catch {} };
export function writeReport(file, obj) { save(file, obj); }
