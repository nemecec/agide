// README: node p1c_permissions.mjs [name ...]  -- P1c permission probes: default mode, --permission-prompt-tool (MCP and stdio), PermissionRequest hook, --permission-prompts none, allow rules.
import { existsSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startMcpHost } from './mcp_host.mjs';
import { startStream, userMsg, initOf, resultsOf, save, NOHOOKS, WORK, OUT } from './lib.mjs';

const only = process.argv.slice(2);
const report = {};
const HOOK = new URL('./hooks/perm_hook.py', import.meta.url).pathname;
const WRITE = (n) => `Use the Write tool to create the file ${n}.txt in the current directory containing the single word hello. Then reply with just: done`;
const MCPCALL = 'Call the tool ui_create_folder with name "Beta". If it fails or is denied, quote the error text. Otherwise reply with just: done';
const clean = (n) => { try { rmSync(join(WORK, n + '.txt')); } catch {} };

async function ask(name, prompt, args, { host, onEvent, fileName } = {}) {
  if (fileName) clean(fileName);
  const h = startStream(args);
  let handler = null;
  if (onEvent) {
    const iv = setInterval(() => { for (const e of h.events) { if (!e._seen) { e._seen = true; onEvent(h, e); } } }, 50);
    h.closed.then(() => clearInterval(iv));
  }
  h.send(userMsg(prompt));
  await h.waitResult(1, 120000); await h.end();
  save(`p1c_${name}.jsonl`, h.events.map((e) => JSON.stringify(e)).join('\n'));
  const r = resultsOf(h.events)[0];
  const uses = [], results = [];
  for (const e of h.events) for (const b of e.message?.content || []) {
    if (b.type === 'tool_use' && b.name !== 'ToolSearch') uses.push(b.name);
    if (b.type === 'tool_result' && !JSON.stringify(b.content).includes('tool_reference')) results.push({ is_error: !!b.is_error, content: JSON.stringify(b.content).slice(0, 260) });
  }
  return { permissionMode: initOf(h.events)?.permissionMode, result: String(r?.result).slice(0, 160), subtype: r?.subtype, permission_denials: r?.permission_denials, tool_uses: uses, tool_results: results, file_written: fileName ? existsSync(join(WORK, fileName + '.txt')) : undefined, control_requests: h.events.filter((e) => e.type === 'control_request').map((e) => e.request), stderr: h.stderr.slice(0, 300), cost: r?.total_cost_usd };
}

const steps = {
  async default_mode_user_settings() {
    // user's own defaultMode applies (init shows which one)
    report.default_mode_user_settings = await ask('default', WRITE('p1c_default'), ['--strict-mcp-config', ...NOHOOKS], { fileName: 'p1c_default' });
  },
  async manual_no_host() {
    report.manual_write = await ask('manual_write', WRITE('p1c_manual'), ['--permission-mode', 'manual', '--strict-mcp-config', ...NOHOOKS], { fileName: 'p1c_manual' });
    const host = await startMcpHost();
    report.manual_mcp_no_allow_rule = await ask('manual_mcp', MCPCALL, ['--permission-mode', 'manual', '--mcp-config', JSON.stringify(host.config()), '--strict-mcp-config', ...NOHOOKS]);
    report.manual_mcp_no_allow_rule.host_folders_created = Object.keys(host.state.folders).length - 1;
    await host.close();
  },
  async allow_rule() {
    const host = await startMcpHost();
    report.allow_rule_mcp_app_star = await ask('allowrule', MCPCALL, ['--permission-mode', 'manual', '--mcp-config', JSON.stringify(host.config()), '--strict-mcp-config', '--allowedTools', 'mcp__app__*', ...NOHOOKS]);
    report.allow_rule_mcp_app_star.host_folders_created = Object.keys(host.state.folders).length - 1;
    await host.close();
  },
  async prompts_none() {
    const host = await startMcpHost();
    report.prompts_none = await ask('none', WRITE('p1c_none'), ['--permission-mode', 'manual', '--permission-prompts', 'none', '--strict-mcp-config', ...NOHOOKS], { fileName: 'p1c_none' });
    report.prompts_none_with_allow_rule = await ask('none_allow', MCPCALL, ['--permission-mode', 'manual', '--permission-prompts', 'none', '--mcp-config', JSON.stringify(host.config()), '--strict-mcp-config', '--allowedTools', 'mcp__app__*', ...NOHOOKS]);
    report.prompts_none_with_allow_rule.host_folders_created = Object.keys(host.state.folders).length - 1;
    await host.close();
  },
  async prompt_tool_mcp() {
    for (const [label, policy] of [['allow', () => ({ behavior: 'allow' })], ['deny', () => ({ behavior: 'deny', message: 'host says no' })]]) {
      const host = await startMcpHost({ permissionPolicy: policy });
      // permission_prompt itself must be allowed to run; allow rule limited to that one tool
      const args = ['--permission-mode', 'manual', '--mcp-config', JSON.stringify(host.config()), '--strict-mcp-config', '--permission-prompt-tool', 'mcp__app__permission_prompt', '--allowedTools', 'mcp__app__permission_prompt', ...NOHOOKS];
      const w = await ask(`ptool_${label}_write`, WRITE(`p1c_ptool_${label}`), args, { fileName: `p1c_ptool_${label}` });
      const m = await ask(`ptool_${label}_mcp`, MCPCALL, args);
      report[`prompt_tool_mcp_${label}`] = { write: w, mcp: m, host_permission_requests: host.state.permissionRequests, host_folders_created: Object.keys(host.state.folders).length - 1 };
      await host.close();
    }
  },
  async prompt_tool_stdio() {
    for (const label of ['allow', 'deny']) {
      const host = await startMcpHost();
      const args = ['--permission-mode', 'manual', '--mcp-config', JSON.stringify(host.config()), '--strict-mcp-config', '--permission-prompt-tool', 'stdio', ...NOHOOKS];
      const seen = [];
      const onEvent = (h, e) => {
        if (e.type === 'control_request' && e.request?.subtype === 'can_use_tool') {
          seen.push({ tool_name: e.request.tool_name, keys: Object.keys(e.request), input: e.request.input, permission_suggestions: e.request.permission_suggestions });
          const response = label === 'allow' ? { behavior: 'allow', updatedInput: e.request.input } : { behavior: 'deny', message: 'stdio host says no' };
          h.send({ type: 'control_response', response: { subtype: 'success', request_id: e.request_id, response } });
        }
      };
      const w = await ask(`stdio_${label}_write`, WRITE(`p1c_stdio_${label}`), args, { fileName: `p1c_stdio_${label}`, onEvent });
      const m = await ask(`stdio_${label}_mcp`, MCPCALL, args, { onEvent });
      report[`prompt_tool_stdio_${label}`] = { write: w, mcp: m, can_use_tool_requests: seen, host_folders_created: Object.keys(host.state.folders).length - 1 };
      await host.close();
    }
  },
  async hook() {
    for (const mode of ['allow', 'deny']) {
      const log = join(OUT, `p1c_hook_${mode}.jsonl`); writeFileSync(log, '');
      const settings = JSON.stringify({ hooks: { PermissionRequest: [{ hooks: [{ type: 'command', command: `python3 ${HOOK} ${mode} ${log}` }] }] } });
      const host = await startMcpHost();
      const args = ['--permission-mode', 'manual', '--mcp-config', JSON.stringify(host.config()), '--strict-mcp-config', '--settings', settings, '--include-hook-events'];
      const w = await ask(`hook_${mode}_write`, WRITE(`p1c_hook_${mode}`), args, { fileName: `p1c_hook_${mode}` });
      const m = await ask(`hook_${mode}_mcp`, MCPCALL, args);
      const logged = readFileSync(log, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
      report[`permission_hook_${mode}`] = { write: w, mcp: m, hook_calls: logged.map((d) => ({ keys: Object.keys(d), hook_event_name: d.hook_event_name, tool_name: d.tool_name, permission_mode: d.permission_mode, tool_input_keys: Object.keys(d.tool_input || {}) })), host_folders_created: Object.keys(host.state.folders).length - 1 };
      await host.close();
    }
  },
};
for (const [k, f] of Object.entries(steps)) if (!only.length || only.includes(k)) { try { await f(); } catch (e) { report[k] = { error: String(e?.stack || e) }; } }
save(`p1c_report_${only.join('_') || 'all'}.json`, report);
console.log(JSON.stringify(report, null, 1));
