// README: node p22_modes.mjs [name ...]  -- P22: permission modes in -p. Values accepted by --permission-mode, defaultMode through --settings, behaviour of auto, plan, acceptEdits, manual, dontAsk for a Write and a Bash call, and the permission_mode field of the PreToolUse hook payload.
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { runOnce, save, OUT, BASE, NOHOOKS } from './lib.mjs';
import { scenario, preToolHook, readLog, exists, fresh, cleanup } from './p_perm_lib.mjs';

const only = process.argv.slice(2);
const report = {};
const W = 'Use the Write tool to create the file w.txt in the current directory containing the word hello. Then use the Bash tool to run exactly: echo b > b.txt . Then reply with one sentence saying which of the two were done or refused, quoting any refusal text.';

async function mode(label, args, settingsExtra = {}) {
  const log = join(OUT, `p22_${label}_hook.jsonl`); writeFileSync(log, '');
  const cwd = fresh();
  const r = await scenario(`p22_${label}`, { prompt: W, args, cwd, settings: { hooks: preToolHook(log, 'none'), ...settingsExtra } });
  r.write_file = exists(cwd, 'w.txt'); r.bash_file = exists(cwd, 'b.txt');
  r.hook_permission_mode = [...new Set(readLog(log).map((e) => `${e.tool_name}:${e.permission_mode}`))];
  cleanup(cwd); delete r.cwd;
  report[label] = r;
}

const steps = {
  async invalid_value() {
    const r = await runOnce(['-p', 'hi', ...BASE, '--permission-mode', 'bogus', ...NOHOOKS], { cwd: fresh() });
    report.invalid_value = { code: r.code, stderr: r.stderr.slice(0, 400), stdout: r.stdout.slice(0, 200) };
  },
  async modes() {
    for (const m of ['auto', 'manual', 'acceptEdits', 'plan', 'dontAsk']) await mode(`flag_${m}`, ['--permission-mode', m]);
  },
  async default_mode_settings() {
    for (const m of ['auto', 'acceptEdits', 'plan']) await mode(`settings_${m}`, [], { permissions: { defaultMode: m } });
    await mode('settings_plan_flag_auto', ['--permission-mode', 'auto'], { permissions: { defaultMode: 'plan' } });
  },
  async bypass() { await mode('flag_bypassPermissions', ['--permission-mode', 'bypassPermissions']); await mode('flag_bypassPermissions_allow_dangerously', ['--permission-mode', 'bypassPermissions', '--allow-dangerously-skip-permissions']); },
  async no_mode() { await mode('no_mode_given', []); },
};
for (const k of (only.length ? only : Object.keys(steps))) { try { await steps[k](); } catch (e) { report[k] = { error: String(e) }; } }
save('p22_report.json', report);
for (const [k, v] of Object.entries(report)) console.log(k, JSON.stringify({ pm: v.permissionMode, write: v.write_file, bash: v.bash_file, hookpm: v.hook_permission_mode, prompts: v.prompts?.map((p) => p.tool_name), denials: v.permission_denials, res: v.result?.slice(0, 120), code: v.code, stderr: v.stderr?.slice(0, 200) }));
