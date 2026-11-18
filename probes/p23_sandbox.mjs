// README: node p23_sandbox.mjs [name ...]  -- P23: sandbox settings through --settings ({"sandbox":{"enabled":true,"network":{"allowedDomains":[...]}}}) in -p under --permission-mode auto. One Bash command per session. Records the tool result text, prompts (can_use_tool), and whether a retry outside the sandbox was requested. Commands use public hosts only (example.com, example.org, a public https repository); the ssh case presents no identity (-F /dev/null drops the user's ssh configuration, IdentityFile=none and IdentityAgent=none drop key files and the agent).
import { existsSync, rmSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { save, OUT } from './lib.mjs';
import { scenario, fresh, cleanup, exists, preToolHook } from './p_perm_lib.mjs';

const only = process.argv.slice(2);
const REPORT = join(OUT, 'p23_report.json');
const report = existsSync(REPORT) ? JSON.parse(readFileSync(REPORT, 'utf8')) : {};
const sb = (domains, extra = {}) => ({ sandbox: { enabled: true, ...(domains ? { network: { allowedDomains: domains } } : {}), ...extra } });
const run = (cmd) => `Use the Bash tool to run exactly this command and nothing else: ${cmd}\nThen reply with one sentence saying what happened, quoting the command output or error text verbatim.`;
const CURL = (u) => `curl -sS -m 10 -o /dev/null -w "http=%{http_code}" ${u}`;
const LSR = 'git ls-remote https://github.com/octocat/Hello-World.git HEAD';
const SSH = 'ssh -F /dev/null -o BatchMode=yes -o IdentityAgent=none -o IdentitiesOnly=yes -o IdentityFile=none -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/dev/null -o ConnectTimeout=8 git@github.com true';
const OUTSIDE = join(homedir(), '.p23-sandbox-outside-write.txt');

const cases = [
  ['curl_allowed_domain', run(CURL('https://example.com')), sb(['example.com'])],
  ['curl_non_allowed_domain', run(CURL('https://example.org')), sb(['example.com'])],
  ['curl_no_sandbox_baseline', run(CURL('https://example.org')), {}],
  ['curl_sandbox_no_domains', run(CURL('https://example.com')), sb(null)],
  ['git_lsremote_https_not_allowed', run(LSR), sb(['example.com'])],
  ['git_lsremote_https_allowed', run(LSR), sb(['github.com'])],
  ['git_lsremote_no_sandbox_baseline', run(LSR), {}],
  ['ssh_github_sandbox_github_allowed', run(SSH), sb(['github.com'])],
  ['ssh_github_no_sandbox_baseline', run(SSH), {}],
  ['curl_non_allowed_manual_mode', run(CURL('https://example.org')), sb(['example.com']), 'manual'],
  ['curl_denied_domain_auto', run(CURL('https://example.org')), { sandbox: { enabled: true, network: { allowedDomains: ['example.com'], deniedDomains: ['example.org'] } } }],
  ['curl_denied_domain_manual', run(CURL('https://example.org')), { sandbox: { enabled: true, network: { allowedDomains: ['example.com'], deniedDomains: ['example.org'] } } }, 'manual'],
  ['curl_no_unsandboxed_auto', run(CURL('https://example.org')), sb(['example.com'], { allowUnsandboxedCommands: false })],
  ['curl_allowed_manual_mode', run(CURL('https://example.com')), sb(['example.com']), 'manual'],
  ['curl_non_allowed_manual_answered_allow', run(CURL('https://example.org')), sb(['example.com']), 'manual', 'allow'],
  ['git_ssh_url_sandbox_github_allowed', run('git ls-remote ssh://git@github.com/octocat/Hello-World.git HEAD'), sb(['github.com'])],
  ['curl_explicit_allowed_domains_auto', `Use the Bash tool with its allowed_domains parameter set to ["example.org"] to run exactly: ${CURL('https://example.org')}\nThen reply with one sentence saying what happened.`, { ...sb(['example.com']), hooks: preToolHook(join(OUT, 'p23_explicit_hook.jsonl'), 'none', 'Bash') }],
  ['write_outside_cwd', run(`echo p23 > ${OUTSIDE}`), sb(['example.com'])],
  ['write_in_cwd', run('echo p23 > inside.txt'), sb(['example.com'])],
];
for (const [label, prompt, settings, pm = 'auto', answer = 'deny'] of cases) {
  if (only.length && !only.includes(label)) continue;
  const cwd = fresh();
  try {
    const r = await scenario(`p23_${label}`, { prompt, args: ['--permission-mode', pm], settings, cwd, promptAnswer: answer });
    report[label] = { pm: r.permissionMode, prompts: r.prompts.map((p) => ({ tool: p.tool_name, input: JSON.stringify(p.input).slice(0, 200), reason: p.decision_reason_type })), denials: r.permission_denials, tool_input: r.tool_uses.map((u) => JSON.stringify(u.input).slice(0, 260)), tool_result: r.tool_results.map((t) => ({ err: t.is_error, c: t.content.slice(0, 420) })), final: r.result, outside_exists: label === 'write_outside_cwd' ? existsSync(OUTSIDE) : undefined, inside_exists: label === 'write_in_cwd' ? exists(cwd, 'inside.txt') : undefined };
  } catch (e) { report[label] = { error: String(e) }; }
  cleanup(cwd);
  if (existsSync(OUTSIDE)) { rmSync(OUTSIDE); report[label].outside_file_removed = true; }
  console.log(label, 'prompts', report[label].prompts?.length, 'inputs', (report[label].tool_input || []).map((t) => t.slice(0, 40) + (t.includes('allowed_domains') ? ' +allowed_domains' : '') + (t.includes('dangerouslyDisableSandbox') ? ' +dangerouslyDisableSandbox' : '')).join(' | '));
}
save('p23_report.json', report);
