// README: node p20_ask_rules.mjs [name ...]  -- P20 (-p half): does an ask rule in --settings permissions.ask still prompt under --permission-mode auto? Cases: Bash command pattern (with an unmatched control command), app MCP tool (mcp_host.mjs), claude.ai connector tool (one read-only call, only success/failure and tool names are kept). Prompts arrive as can_use_tool requests (stdio prompt tool) and are answered deny, except where noted.
import { join } from 'node:path';
import { startMcpHost } from './mcp_host.mjs';
import { save } from './lib.mjs';
import { scenario, exists, fresh, cleanup } from './p_perm_lib.mjs';

const only = process.argv.slice(2);
const report = {};
const brief = (r) => ({ pm: r.permissionMode, prompts: r.prompts.map((p) => ({ tool: p.tool_name, input: JSON.stringify(p.input).slice(0, 120), reason: p.decision_reason, title: p.title })), denials: r.permission_denials, uses: r.tool_uses.map((u) => u.name), errs: r.tool_results.map((t) => t.is_error), subtype: r.subtype, cost: r.cost });
const BASH1 = 'Use the Bash tool to run exactly: echo p20 > marker.txt . Then reply with just: done';
const BASH2 = 'Use the Bash tool to run exactly: echo other > control.txt . Then reply with just: done';

const steps = {
  async bash() {
    for (const [label, settings, prompt, file] of [
      ['ask_match', { permissions: { ask: ['Bash(echo p20*)'] } }, BASH1, 'marker.txt'],
      ['ask_nomatch_control', { permissions: { ask: ['Bash(echo p20*)'] } }, BASH2, 'control.txt'],
      ['no_rule_baseline', {}, BASH1, 'marker.txt'],
      ['ask_whole_tool', { permissions: { ask: ['Bash'] } }, BASH2, 'control.txt'],
    ]) {
      const cwd = fresh();
      const r = await scenario(`p20_bash_${label}`, { prompt, args: ['--permission-mode', 'auto'], settings, cwd });
      report[`bash_${label}`] = { ...brief(r), file_exists: exists(cwd, file) }; cleanup(cwd);
    }
    // answered allow: does the call then run
    const cwd = fresh();
    const r = await scenario('p20_bash_ask_match_allowed', { prompt: BASH1, args: ['--permission-mode', 'auto'], settings: { permissions: { ask: ['Bash(echo p20*)'] } }, cwd, promptAnswer: 'allow' });
    report.bash_ask_match_answered_allow = { ...brief(r), file_exists: exists(cwd, 'marker.txt') }; cleanup(cwd);
  },
  async mcp() {
    const CALL = 'Call the tool ui_create_folder with name "P20". If it fails or is denied, quote the error text. Otherwise reply with just: done';
    for (const [label, settings] of [['ask_match', { permissions: { ask: ['mcp__app__ui_create_folder'] } }], ['ask_server_wildcard', { permissions: { ask: ['mcp__app__*'] } }], ['no_rule_baseline', {}]]) {
      const host = await startMcpHost();
      const r = await scenario(`p20_mcp_${label}`, { prompt: CALL, args: ['--permission-mode', 'auto', '--mcp-config', JSON.stringify(host.config())], settings });
      report[`mcp_${label}`] = { ...brief(r), host_folders_created: Object.keys(host.state.folders).length - 1 };
      await host.close();
    }
  },
  async connector() {
    // one read-only connector call; saveEvents false and the result text is dropped so no user data is kept
    const CALL = 'Call the connector tool whose name ends in atlassianUserInfo (search for it with ToolSearch if it is deferred), once. Reply with just ok if the call succeeded or failed if it did not. Do not repeat any data from the result.';
    const out = {};
    for (const [label, rule, answer] of [['ask_rule_answered_deny', 'mcp__claude_ai_Atlassian__atlassianUserInfo', 'deny'], ['ask_server_wildcard_answered_allow', 'mcp__claude_ai_Atlassian__*', 'allow']]) {
      const r = await scenario(`p20_connector_${label}`, { prompt: CALL, args: ['--permission-mode', 'auto'], settings: { permissions: { ask: [rule] } }, promptAnswer: answer, saveEvents: false, strict: false });
      out[label] = { pm: r.permissionMode, prompt_tools: r.prompts.map((p) => p.tool_name), prompt_keys: r.prompts[0]?.keys, denials: r.permission_denials, tools_used: r.tool_uses.map((u) => u.name), tool_result_is_error: r.tool_results.map((t) => t.is_error), final: r.result.slice(0, 30) };
    }
    report.connector = out;
  },
};
for (const k of (only.length ? only : Object.keys(steps))) { try { await steps[k](); } catch (e) { report[k] = { error: String(e) }; } }
save('p20_report.json', report);
console.log(JSON.stringify(report, null, 1));
