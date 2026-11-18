// README: node p21_pretool_hook.mjs [name ...]  -- P21 (-p half): PreToolUse hook decisions (allow, deny, ask, updatedInput), exit codes 1 and 2, timeout, and ordering against permission rules, under --permission-mode auto and manual. Prompts arrive as can_use_tool requests and are answered deny.
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { save, OUT } from './lib.mjs';
import { scenario, preToolHook, readLog, exists, fresh, cleanup } from './p_perm_lib.mjs';

const only = process.argv.slice(2);
const report = {};
const PROMPT = 'Use the Bash tool to run exactly: echo p21 > marker.txt . Then reply with one sentence saying whether it ran, and quote any refusal or hook message you received verbatim.';
const REWRITE = JSON.stringify({ command: 'echo rewritten > rewritten.txt' });

const cases = [
  // [label, hook mode, permission mode, permissions block, extra hook timeout seconds]
  ['auto_hook_allow_baseline', 'allow', 'auto'],
  ['auto_hook_deny_baseline', 'deny', 'auto'],
  ['auto_hook_ask', 'ask', 'auto'],
  ['auto_hook_allow_vs_ask_rule', 'allow', 'auto', { ask: ['Bash(echo p21*)'] }],
  ['auto_hook_deny_vs_allow_rule', 'deny', 'auto', { allow: ['Bash(echo p21*)'] }],
  ['auto_hook_allow_vs_deny_rule', 'allow', 'auto', { deny: ['Bash(echo p21*)'] }],
  ['auto_hook_ask_vs_allow_rule', 'ask', 'auto', { allow: ['Bash(echo p21*)'] }],
  ['manual_hook_allow_baseline', 'allow', 'manual'],
  ['manual_hook_ask', 'ask', 'manual'],
  ['manual_hook_allow_vs_ask_rule', 'allow', 'manual', { ask: ['Bash(echo p21*)'] }],
  ['manual_hook_updated_input', `updated:${REWRITE}`, 'manual'],
  ['auto_hook_updated_input', `updated:${REWRITE}`, 'auto'],
  ['auto_hook_updated_input_vs_ask_rule', `updated:${REWRITE}`, 'auto', { ask: ['Bash(echo *)'] }],
  ['auto_hook_exit1', 'exit1', 'auto'],
  ['manual_hook_exit1', 'exit1', 'manual'],
  ['auto_hook_exit2', 'exit2', 'auto'],
  ['auto_hook_exit2_vs_allow_rule', 'exit2', 'auto', { allow: ['Bash(echo p21*)'] }],
  ['auto_hook_timeout', 'sleep:6', 'auto', undefined, 2],
  ['manual_hook_timeout', 'sleep:6', 'manual', undefined, 2],
  ['auto_hook_slow_no_timeout', 'sleep:3', 'auto'],
];

for (const [label, mode, pm, perms, timeout] of cases) {
  if (only.length && !only.includes(label)) continue;
  const log = join(OUT, `p21_${label}_hook.jsonl`); writeFileSync(log, '');
  const cwd = fresh();
  try {
    const settings = { hooks: preToolHook(log, mode, 'Bash', timeout), ...(perms ? { permissions: perms } : {}) };
    const t0 = Date.now();
    const r = await scenario(`p21_${label}`, { prompt: PROMPT, args: ['--permission-mode', pm], settings, cwd });
    const hl = readLog(log);
    report[label] = { pm: r.permissionMode, hook_invocations: hl.length, hook_payload_keys: hl[0] ? Object.keys(hl[0]).filter((k) => !k.startsWith('_')) : [], prompts: r.prompts.map((p) => ({ tool: p.tool_name, input: JSON.stringify(p.input).slice(0, 100), reason_type: p.decision_reason_type, source: p.decision_reason_rule_source, hook: p.decision_reason })), denials: r.permission_denials, marker: exists(cwd, 'marker.txt'), rewritten: exists(cwd, 'rewritten.txt'), tool_result: r.tool_results.map((t) => t.content.slice(0, 220)), final: r.result.slice(0, 220), hook_events: r.hook_events.filter((e) => e.hook_event === 'PreToolUse').map((e) => `${e.subtype}:${e.outcome}:${e.exit_code}`), secs: Math.round((Date.now() - t0) / 100) / 10 };
  } catch (e) { report[label] = { error: String(e) }; }
  cleanup(cwd);
  console.log(label, JSON.stringify({ prompts: report[label].prompts?.length, marker: report[label].marker, rewritten: report[label].rewritten, denials: report[label].denials, hook_events: report[label].hook_events, secs: report[label].secs, res: report[label].tool_result }));
}
save('p21_report.json', report);
