// README: node p45_http_hook.mjs [case|group ...]  -- P45 (-p stream-json half): the `http` hook type against a local receiver. One haiku session per case in an empty directory under /tmp/agide-r21-probes/p45/, started with the stdio permission prompt tool so that a call that reaches the permission prompt shows up as can_use_tool (answered deny). Records the payload of each event, the effect of allow, deny and ask answers, what happens when the receiver is down, slow, answers an error, plain text or invalid JSON, a held PermissionRequest, header interpolation from an environment variable and whether the value shows in any process argument list, and delivery under srt and under the CLI's own sandbox setting. Groups: payload, decide, failure, hold, headers, sandbox, srt (srt needs SRT_BIN, see below). At most 3 sessions run at once. Report: probes/out/p45_report.json.
// srt group: SRT_BIN=<path to srt> node p45_http_hook.mjs srt   (the script writes the srt settings itself and starts claude through probes/hooks/srt_claude.sh)
import { mkdirSync, rmSync, readFileSync, existsSync, writeFileSync, chmodSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { homedir } from 'node:os';

const GROUPS = {
  payload: ['payloads'],
  decide: ['userprompt_context', 'perm_allow', 'perm_deny', 'perm_deny_interrupt', 'pre_allow', 'pre_deny', 'pre_ask'],
  failure: ['perm_down', 'perm_down_block', 'pre_down', 'pre_down_block', 'perm_500', 'perm_text', 'perm_badjson', 'pre_badjson', 'perm_slow_timeout', 'pre_slow_timeout', 'pre_slow_timeout_block'],
  hold: ['perm_hold_20', 'perm_hold_130'],
  longhold: ['perm_hold_330'],
  headers: ['headers_env', 'headers_env_bash', 'headers_file_literal'],
  sandbox: ['sandbox_setting', 'sandbox_allow_loopback'],
  srt: ['srt_no_loopback', 'srt_domain_only', 'srt_binding_only', 'srt_loopback'],
};
const wanted = process.argv.slice(2).flatMap((a) => GROUPS[a] || [a]);
const useSrt = wanted.some((n) => n.startsWith('srt_'));
const ROOT = '/tmp/agide-r21-probes/p45';
mkdirSync(ROOT, { recursive: true });
if (useSrt) {
  if (!process.env.SRT_BIN) throw new Error('SRT_BIN is required for the srt group');
  process.env.CLAUDE_BIN = new URL('./hooks/srt_claude.sh', import.meta.url).pathname;
}
const { startStream, userMsg, resultsOf, save, OUT, sleep } = await import('./lib.mjs');
const { startHookServer, ctxWord } = await import('./p45_hook_server.mjs');

// Dummy value for the header probes, derived at run time so that no secret-shaped literal sits in the file.
const dummy = (label) => `h45-${createHash('sha256').update(label).digest('hex').slice(0, 24)}`;
const PROMPT = 'Use the Bash tool to run exactly: echo h45 > marker.txt . Then reply with one sentence saying whether it ran, and quote any refusal or hook message you received verbatim.';
const ALLOW_BASH = ['--allowedTools', 'Bash(echo h45*)'];
const EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'Stop', 'Notification', 'SessionEnd'];

const hk = (url, extra = {}) => ({ type: 'http', url, ...extra });
const one = (event, url, extra = {}, matcher) => ({ [event]: [{ ...(matcher ? { matcher } : {}), hooks: [hk(url, extra)] }] });

// name: { routes, hooks(base, ctx) -> hooks object, args, env, prompt, settleS, extraSettings }
const CASES = {
  payloads: { routes: {}, hooks: (b) => Object.fromEntries(EVENTS.map((e) => [e, [{ hooks: [hk(`${b}/e/${e}`)] }]])) },
  userprompt_context: {
    routes: { '/p': 'ctx' }, hooks: (b) => one('UserPromptSubmit', `${b}/p`),
    prompt: () => 'Without using any tool: what is the p45 context word that was given to you in your context? Reply with the word only, or the word none if you were given no such word.',
  },
  perm_allow: { routes: { '/p': 'allow' }, hooks: (b) => one('PermissionRequest', `${b}/p`) },
  perm_deny: { routes: { '/p': 'deny' }, hooks: (b) => one('PermissionRequest', `${b}/p`) },
  perm_deny_interrupt: { routes: { '/p': 'deny-interrupt' }, hooks: (b) => one('PermissionRequest', `${b}/p`) },
  pre_allow: { routes: { '/p': 'allow' }, hooks: (b) => one('PreToolUse', `${b}/p`, {}, 'Bash') },
  pre_deny: { routes: { '/p': 'deny' }, hooks: (b) => one('PreToolUse', `${b}/p`, {}, 'Bash'), args: ALLOW_BASH },
  pre_ask: { routes: { '/p': 'ask' }, hooks: (b) => one('PreToolUse', `${b}/p`, {}, 'Bash'), args: ALLOW_BASH },
  perm_down: { down: true, hooks: (b) => one('PermissionRequest', `${b}/p`) },
  perm_down_block: { down: true, hooks: (b) => one('PermissionRequest', `${b}/p`, { onFailure: 'block' }) },
  pre_down: { down: true, hooks: (b) => one('PreToolUse', `${b}/p`, {}, 'Bash'), args: ALLOW_BASH },
  pre_down_block: { down: true, hooks: (b) => one('PreToolUse', `${b}/p`, { onFailure: 'block' }, 'Bash'), args: ALLOW_BASH },
  perm_500: { routes: { '/p': 'status:500' }, hooks: (b) => one('PermissionRequest', `${b}/p`) },
  perm_text: { routes: { '/p': 'text' }, hooks: (b) => one('PermissionRequest', `${b}/p`) },
  perm_badjson: { routes: { '/p': 'badjson' }, hooks: (b) => one('PermissionRequest', `${b}/p`) },
  pre_badjson: { routes: { '/p': 'badjson' }, hooks: (b) => one('PreToolUse', `${b}/p`, {}, 'Bash'), args: ALLOW_BASH },
  perm_slow_timeout: { routes: { '/p': 'delay:10,allow' }, hooks: (b) => one('PermissionRequest', `${b}/p`, { timeout: 3 }), settleS: 9 },
  pre_slow_timeout: { routes: { '/p': 'delay:10,deny' }, hooks: (b) => one('PreToolUse', `${b}/p`, { timeout: 3 }, 'Bash'), args: ALLOW_BASH, settleS: 9 },
  pre_slow_timeout_block: { routes: { '/p': 'delay:10,allow' }, hooks: (b) => one('PreToolUse', `${b}/p`, { timeout: 3, onFailure: 'block' }, 'Bash'), args: ALLOW_BASH, settleS: 9 },
  perm_hold_20: { answerDelayMs: null, routes: { '/p': 'delay:20,allow' }, hooks: (b) => one('PermissionRequest', `${b}/p`) },
  perm_hold_130: { answerDelayMs: null, routes: { '/p': 'delay:130,allow' }, hooks: (b) => one('PermissionRequest', `${b}/p`) },
  perm_hold_330: { answerDelayMs: null, routes: { '/p': 'delay:330,allow' }, hooks: (b) => one('PermissionRequest', `${b}/p`) },
  headers_env: {
    routes: { '/p': 'empty' },
    hooks: (b) => one('PreToolUse', `${b}/p`, { headers: { Authorization: 'Bearer $H45_TOKEN', 'X-Unlisted': '$H45_OTHER', 'X-Braced': '${H45_TOKEN}' }, allowedEnvVars: ['H45_TOKEN'] }, 'Bash'),
    env: { H45_TOKEN: dummy('h45-token'), H45_OTHER: dummy('h45-other') }, args: ALLOW_BASH, psWatch: [dummy('h45-token'), dummy('h45-other')],
  },
  headers_env_bash: {
    routes: { '/p': 'empty' },
    hooks: (b) => one('PreToolUse', `${b}/p`, { headers: { Authorization: 'Bearer $H45_TOKEN' }, allowedEnvVars: ['H45_TOKEN'] }, 'Read'),
    env: { H45_TOKEN: dummy('h45-token') }, args: ['--allowedTools', 'Bash(printenv H45_TOKEN)'],
    prompt: () => 'Use the Bash tool to run exactly: printenv H45_TOKEN . Then reply with one sentence quoting the output verbatim, or saying that it was empty.',
  },
  headers_file_literal: {
    routes: { '/p': 'empty' },
    hooks: (b) => one('PreToolUse', `${b}/p`, { headers: { Authorization: `Bearer ${dummy('h45-literal')}` } }, 'Bash'),
    settingsFile: true, args: ALLOW_BASH, psWatch: [dummy('h45-literal')],
  },
  sandbox_setting: {
    routes: { '/p': 'empty', '/frombash': 'empty' },
    hooks: (b) => one('PreToolUse', `${b}/p`, {}, 'Bash'),
    extraSettings: { sandbox: { enabled: true, autoAllowBashIfSandboxed: true, network: { allowedDomains: [] } } },
    prompt: (b) => `Use the Bash tool to run exactly: curl -s -m 5 -o /dev/null -w '%{http_code}' ${b}/frombash ; echo " exit=$?" . Then reply with one sentence quoting the command output verbatim.`,
    args: ['--allowedTools', 'Bash(curl*)'],
  },
  sandbox_allow_loopback: {
    routes: { '/p': 'empty', '/frombash': 'empty' },
    hooks: (b) => one('PreToolUse', `${b}/p`, {}, 'Bash'),
    extraSettings: { sandbox: { enabled: true, autoAllowBashIfSandboxed: true, network: { allowedDomains: ['127.0.0.1'] } } },
    prompt: (b) => `Use the Bash tool to run exactly: curl -s -m 5 -o /dev/null -w '%{http_code}' ${b}/frombash ; echo " exit=$?" . Then reply with one sentence quoting the command output verbatim.`,
    args: ['--allowedTools', 'Bash(curl*)'],
  },
  srt_no_loopback: { routes: { '/p': 'deny' }, hooks: (b) => one('PreToolUse', `${b}/p`, {}, 'Bash'), args: ALLOW_BASH, srtDomains: ['api.anthropic.com', '*.anthropic.com'], local: false },
  srt_domain_only: { routes: { '/p': 'deny' }, hooks: (b) => one('PreToolUse', `${b}/p`, {}, 'Bash'), args: ALLOW_BASH, srtDomains: ['api.anthropic.com', '*.anthropic.com', '127.0.0.1', 'localhost'], local: false },
  srt_binding_only: { routes: { '/p': 'deny' }, hooks: (b) => one('PreToolUse', `${b}/p`, {}, 'Bash'), args: ALLOW_BASH, srtDomains: ['api.anthropic.com', '*.anthropic.com'], local: true },
  srt_loopback: { routes: { '/p': 'deny' }, hooks: (b) => one('PreToolUse', `${b}/p`, {}, 'Bash'), args: ALLOW_BASH, srtDomains: ['api.anthropic.com', '*.anthropic.com', '127.0.0.1', 'localhost'], local: true },
};

function psLines(needles) {
  const r = spawnSync('ps', ['-axo', 'pid=,args='], { encoding: 'utf8' });
  return r.stdout.split('\n').filter((l) => needles.some((n) => l.includes(n))).map((l) => l.slice(0, 120));
}

function srtSettings(cwd, c) {
  const cfgdir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
  const cfg = { allowPty: true, network: { allowedDomains: c.srtDomains, deniedDomains: [], allowLocalBinding: !!c.local },
    filesystem: { denyRead: [], allowRead: [], denyWrite: [], allowWrite: [cwd, cfgdir, join(homedir(), '.claude'), join(homedir(), '.claude.json'), `/private/tmp/claude-${process.getuid()}`] } };
  const p = join(cwd, '..', `srt-${c.name}.json`); writeFileSync(p, JSON.stringify(cfg)); return p;
}

async function runCase(name) {
  const c = { name, ...CASES[name] };
  const cwd = join(ROOT, name); rmSync(cwd, { recursive: true, force: true }); mkdirSync(cwd, { recursive: true });
  const logFile = join(OUT, `p45_${name}_server.jsonl`); try { rmSync(logFile); } catch {}
  const srv = await startHookServer({ logFile, routes: c.routes || {} });
  let base = srv.base;
  if (c.down) { const dead = await startHookServer({}); base = dead.base; await dead.close(); }
  const settings = { hooks: c.hooks(base), ...(c.extraSettings || {}) };
  let settingsArg = JSON.stringify(settings);
  if (c.settingsFile) { const f = join(ROOT, `${name}.settings.json`); writeFileSync(f, settingsArg); chmodSync(f, 0o600); settingsArg = f; }
  const env = { ...(c.env || {}) };
  if (c.srtDomains) { process.env.SRT_SETTINGS = srtSettings(cwd, c); }
  const args = ['--permission-mode', 'manual', '--permission-prompt-tool', 'stdio', '--include-hook-events', '--strict-mcp-config', ...(c.args || []), '--settings', settingsArg];
  const h = startStream(args, { cwd, env });
  const prompts = [];
  const answered = new Set();
  const iv = setInterval(() => {
    for (const e of h.events) {
      if (answered.has(e)) continue; answered.add(e);
      if (e.type === 'control_request' && e.request?.subtype === 'can_use_tool') {
        prompts.push({ t: e._t, tool_name: e.request.tool_name, input: JSON.stringify(e.request.input).slice(0, 100), reason: e.request.decision_reason });
        // The can_use_tool request is emitted before the PermissionRequest hooks start, so the host answers after a delay; a hook answer that arrives earlier cancels the request.
        const delay = c.answerDelayMs === undefined ? 4000 : c.answerDelayMs;
        if (delay !== null) setTimeout(() => h.send({ type: 'control_response', response: { subtype: 'success', request_id: e.request_id, response: { behavior: 'deny', message: 'probe host denies' } } }), delay);
      }
    }
  }, 40);
  const t0 = Date.now();
  h.send(userMsg(c.prompt ? c.prompt(base) : PROMPT));
  let ps = [];
  if (c.psWatch) { await h.waitFor((e) => e.type === 'system' && e.subtype === 'init', 30000); await sleep(1500); ps = psLines(c.psWatch); }
  const done = await h.waitResult(1, ((c.name.includes('330') ? 330 : c.name.includes('130') ? 130 : 20) + 120) * 1000);
  const tEnd = Date.now();
  if (!done) h.kill('SIGKILL');
  await sleep((c.settleS ?? 2) * 1000);
  clearInterval(iv);
  const ev = h.events;
  save(`p45_${name}.jsonl`, ev.map((e) => JSON.stringify(e)).join('\n'));
  const r = resultsOf(ev)[0];
  const results = [];
  for (const e of ev) for (const b of e.message?.content || []) if (b.type === 'tool_result' && !JSON.stringify(b.content).includes('tool_reference')) results.push({ is_error: !!b.is_error, content: JSON.stringify(b.content).slice(0, 300) });
  const hookEvents = ev.filter((e) => e.type === 'system' && /hook/.test(e.subtype || '')).map((e) => ({ subtype: e.subtype, hook_event: e.hook_event, outcome: e.outcome, exit_code: e.exit_code, stderr: String(e.stderr || '').slice(0, 200), output: String(e.output || e.stdout || '').slice(0, 250), dt_s: Math.round((e._t - t0) / 100) / 10 }));
  const reqs = srv.events.filter((e) => e.kind === 'request');
  const out = {
    name, finished: done, total_s: Math.round((tEnd - t0) / 100) / 10, subtype: r?.subtype, result: String(r?.result).slice(0, 250), cost: r?.total_cost_usd,
    marker: existsSync(join(cwd, 'marker.txt')), cancel_requests: ev.filter((e) => e.type === 'control_cancel_request').map((e) => ({ dt_s: Math.round((e._t - t0) / 100) / 10 })), prompts: prompts.map((p) => ({ ...p, dt_s: Math.round((p.t - t0) / 100) / 10, t: undefined })), tool_results: results,
    server_requests: reqs.map((q) => ({ at_s: q.at_s, url: q.url, event: q.body?.hook_event_name })),
    server_other: srv.events.filter((e) => e.kind !== 'request').map((e) => ({ at_s: e.at_s, kind: e.kind, url: e.url, status: e.status })),
    hook_events: hookEvents, ps_hits: c.psWatch ? ps : undefined, stderr: h.stderr.slice(0, 300),
  };
  if (name === 'userprompt_context') out.context_word_in_answer = String(r?.result).includes(ctxWord());
  if (name === 'payloads') out.payloads = Object.fromEntries(reqs.map((q) => [q.body?.hook_event_name || q.url, { headers: q.headers, remote: q.remote, body: q.body }]));
  else if (reqs[0]) out.first_request = { headers: reqs[0].headers, remote: reqs[0].remote, body: reqs[0].body };
  if (name.startsWith('headers')) out.header_values_seen = reqs.map((q) => ({ authorization: q.headers.authorization, 'x-unlisted': q.headers['x-unlisted'], 'x-braced': q.headers['x-braced'] }));
  await srv.close();
  try { h.kill('SIGKILL'); } catch {}
  rmSync(cwd, { recursive: true, force: true });
  console.log(name, JSON.stringify({ marker: out.marker, prompts: out.prompts.map((p) => p.tool_name), cancels: out.cancel_requests.length, results: out.tool_results.map((x) => x.content.slice(0, 120)), server: out.server_requests.map((q) => `${q.event || q.url}@${q.at_s}`), other: out.server_other.map((o) => `${o.kind}@${o.at_s}`), hooks: out.hook_events.filter((x) => x.subtype === 'hook_response').map((x) => `${x.hook_event}:${x.outcome}`), total_s: out.total_s }));
  return out;
}

const reportPath = join(OUT, 'p45_report.json');
const queue = wanted.length ? [...wanted] : Object.keys(CASES).filter((n) => !n.startsWith('srt_') && n !== 'perm_hold_330');
await Promise.all((useSrt ? [0] : [0, 1, 2].slice(0, Number(process.env.P45_POOL) || 3)).map(async () => {
  while (queue.length) {
    const n = queue.shift();
    if (!CASES[n]) { console.log('unknown case', n); continue; }
    let result;
    try { result = await runCase(n); } catch (e) { result = { error: String(e) }; console.log(n, 'error', String(e)); }
    // re-read so that runs started at the same time do not overwrite each other's cases
    const latest = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) : {};
    save('p45_report.json', { ...latest, [n]: result });
  }
}));
