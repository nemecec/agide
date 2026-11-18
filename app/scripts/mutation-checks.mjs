// Breaks each security decision once and runs the unit tests that guard it; a mutation that no test notices
// fails this script. The source file is restored after every run, also on Ctrl-C. Pass a name fragment to run a subset.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');

const SCOPE = ['src/core/commands', 'src/core/browser/BrowserTools.test.ts', 'src/main/modules/browser.test.ts'];
const ADDRESS = ['src/core/browser/addressPolicy.test.ts', 'src/main/browser/guards.test.ts', 'src/core/browser/BrowserTools.test.ts'];
const INSPECTOR = ['src/core/permissions'];
const REDACTION = ['src/core/browser/redaction.test.ts', 'src/core/browser/PageSession.test.ts', 'src/core/browser/BrowserTools.test.ts'];
const OBSERVATION = ['src/core/browser/redaction.test.ts', 'src/core/browser/BrowserTools.test.ts', 'src/core/browser/browser.test.ts', 'src/core/browser/services.test.ts', 'src/core/browser/blocked.test.ts'];

/** `from` must occur exactly once in the file. */
const mutations = [
  // Folder scope of browser tools and surfaces_observe
  { name: 'scope: MCP caller may name a node outside its folder', file: 'src/core/commands/scope.ts', from: 'if (!tree.isWithin(nodeId, caller.folderId)) {', to: 'if (false) {', tests: SCOPE },
  { name: 'scope: top level counts as inside the folder', file: 'src/core/commands/scope.ts', from: 'if (nodeId === null) {', to: 'if (false) {', tests: SCOPE },
  { name: 'scope: MCP callers are treated as the UI', file: 'src/core/commands/scope.ts', from: "if (caller.kind === 'ui') return;", to: 'return;', tests: SCOPE },
  { name: 'scope: tab ids resolve across folders', file: 'src/core/browser/BrowserTools.ts', from: "if (caller.kind === 'mcp' && !this.deps.tree.isWithin(record.leafId, caller.folderId)) throw unknown;", to: '', tests: SCOPE },
  // Navigation scheme policy
  { name: 'address: file scheme loads', file: 'src/core/browser/addressPolicy.ts', from: "if (url.protocol === 'http:' || url.protocol === 'https:') {", to: "if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'file:') {", tests: ADDRESS },
  { name: 'address: javascript scheme loads', file: 'src/core/browser/addressPolicy.ts', from: "return { allow: false, reason: `the ${url.protocol} scheme is not allowed in a browser tab; only http, https and about:blank load` };", to: 'return { allow: true, url: raw };', tests: ADDRESS },
  { name: 'address: URLs with credentials load', file: 'src/core/browser/addressPolicy.ts', from: "if (url.username !== '' || url.password !== '') return", to: "if (false) return", tests: ADDRESS },
  { name: 'address: mailto opens for an agent', file: 'src/core/browser/addressPolicy.ts', from: "&& source === 'user') {", to: '&& source !== "page") {', tests: ADDRESS },
  { name: 'address: redirects leave the service', file: 'src/core/browser/addressPolicy.ts', from: 'if (input.redirect === true || verdict.url', to: 'if (verdict.url', tests: ADDRESS },
  { name: 'address: cross-service navigation stays in the tab', file: 'src/core/browser/addressPolicy.ts', from: 'if (target === undefined || target === input.current) return', to: 'if (true) return', tests: ADDRESS },
  { name: 'address: any pop-up host keeps an opener', file: 'src/core/browser/addressPolicy.ts', from: 'if (popup) return', to: 'if (true) return', tests: ADDRESS },
  { name: 'address: sign-in path prefix ignored', file: 'src/core/browser/addressPolicy.ts', from: '(entry.pathPrefix === undefined || url.pathname.startsWith(entry.pathPrefix))', to: 'true', tests: ADDRESS },
  { name: 'address: permissions granted', file: 'src/core/browser/addressPolicy.ts', from: "export const ALLOWED_PERMISSIONS: readonly string[] = ['fullscreen', 'clipboard-sanitized-write'];", to: "export const ALLOWED_PERMISSIONS: readonly string[] = ['fullscreen', 'clipboard-sanitized-write', 'media', 'geolocation'];", tests: ADDRESS },
  { name: 'guards: subframe navigation unchecked', file: 'src/main/browser/guards.ts', from: 'if (details.isMainFrame === false) {', to: 'if (false) {', tests: ADDRESS },
  { name: 'guards: webview attach allowed', file: 'src/main/browser/guards.ts', from: "(event: { preventDefault(): void }) => event.preventDefault());", to: '() => undefined);', tests: ADDRESS },
  { name: 'guards: blocked navigation not cancelled', file: 'src/main/browser/guards.ts', from: '    details.preventDefault();\n    if (decision.action', to: '    if (decision.action', tests: ADDRESS },
  { name: 'guards: device permission granted', file: 'src/main/browser/guards.ts', from: 'session.setDevicePermissionHandler(() => false);', to: 'session.setDevicePermissionHandler(() => true);', tests: ADDRESS },
  // Inspector deny rules
  { name: 'inspector: deny mode ignored', file: 'src/core/permissions/inspector.ts', from: "if (strictestMode === 'deny') {", to: 'if (false) {', tests: INSPECTOR },
  { name: 'inspector: approve under bypass mode asks instead of denying', file: 'src/core/permissions/inspector.ts', from: "if (payload.permission_mode === 'bypassPermissions') {", to: 'if (false) {', tests: INSPECTOR },
  { name: 'inspector: approve mode passes', file: 'src/core/permissions/inspector.ts', from: "if (strictestMode === 'draft' || strictestMode === 'approve') {", to: "if (strictestMode === 'draft') {", tests: INSPECTOR },
  { name: 'inspector: strictest of several hits not taken', file: 'src/core/permissions/inspector.ts', from: 'if (RANK[mode] > RANK[strictestMode]) {', to: 'if (false) {', tests: INSPECTOR },
  { name: 'inspector: hard floor not applied', file: 'src/core/permissions/inspector.ts', from: 'if (hit.hard === true && row?.hardFloor !== undefined && RANK[base] < RANK[row.hardFloor]) return row.hardFloor;', to: '', tests: INSPECTOR },
  { name: 'inspector: unknown class defaults to allow', file: 'src/core/permissions/inspector.ts', from: "row?.defaultMode ?? 'approve'", to: "row?.defaultMode ?? 'allow'", tests: INSPECTOR },
  { name: 'inspector: Bash with a host list treated as readable', file: 'src/core/permissions/inspector.ts', from: "if (isRecord(input) && input['allowed_domains'] !== undefined) return [{ classId: 'shell.opaque', reason: 'a per-command host list' }];", to: '', tests: INSPECTOR },
  { name: 'inspector: unreadable Bash command passes', file: 'src/core/permissions/inspector.ts', from: "command === undefined ? [{ classId: 'shell.opaque', reason: 'command the gate cannot read' }] : classifyBash(command)", to: 'command === undefined ? [] : classifyBash(command)', tests: INSPECTOR },
  { name: 'inspector: unknown connector tool passes as a read', file: 'src/core/permissions/inspector.ts', from: ": [{ classId: 'connector.unknown', reason: 'unknown connector tool' }];", to: ": [{ classId: 'read' }];", tests: INSPECTOR },
  { name: 'inspector: unknown MCP tool passes as a read', file: 'src/core/permissions/inspector.ts', from: ": [{ classId: 'mcp.other', reason: 'unknown MCP tool' }];", to: ": [{ classId: 'mcp.other.read' }];", tests: INSPECTOR },
  { name: 'inspector: host allowlist matches look-alike hosts', file: 'src/core/permissions/hosts.ts', from: 'name.endsWith(rule.slice(1))', to: 'name.includes(rule.slice(2))', tests: INSPECTOR },
  { name: 'inspector: plain http covered by the allowlist', file: 'src/core/permissions/hosts.ts', from: "url.protocol === 'https:' && hostAllowed", to: 'hostAllowed', tests: INSPECTOR },
  { name: 'inspector: payloads of other events decided', file: 'src/core/permissions/gateRun.ts', from: "(raw as { hook_event_name?: unknown }).hook_event_name !== 'PreToolUse'", to: 'false', tests: INSPECTOR },
  // Redaction
  { name: 'redaction: token query values kept', file: 'src/core/browser/redaction.ts', from: "'code', 'state', 'token', 'access_token'", to: "'code', 'state', 'access_token'", tests: REDACTION },
  { name: 'redaction: fragment tokens kept', file: 'src/core/browser/redaction.ts', from: "if (url.hash !== '' && /(^|[#&])(access_token|id_token|token|code|state|jwt|session)=/i.test(url.hash)) url.hash = REDACTED;", to: '', tests: REDACTION },
  { name: 'redaction: cookie header kept', file: 'src/core/browser/redaction.ts', from: "['authorization', 'cookie', 'set-cookie', 'proxy-authorization']", to: "['authorization', 'set-cookie', 'proxy-authorization']", tests: REDACTION },
  { name: 'redaction: header names compared case-sensitively', file: 'src/core/browser/redaction.ts', from: 'SENSITIVE_HEADERS.has(name.toLowerCase())', to: 'SENSITIVE_HEADERS.has(name)', tests: REDACTION },
  { name: 'redaction: password fields not sensitive', file: 'src/core/browser/redaction.ts', from: "if ((field.type ?? '').toLowerCase() === 'password') return true;", to: '', tests: REDACTION },
  { name: 'redaction: protected accessibility fields not sensitive', file: 'src/core/browser/redaction.ts', from: 'if (field.protected === true) return true;', to: '', tests: REDACTION },
  { name: 'redaction: autocomplete hints ignored', file: 'src/core/browser/redaction.ts', from: 'if (autocomplete.some((token) => SENSITIVE_AUTOCOMPLETE.has(token))) return true;', to: '', tests: REDACTION },
  { name: 'redaction: field names not matched', file: 'src/core/browser/redaction.ts', from: "return names.some((name) => name !== '' && label.includes(name.toLowerCase()));", to: 'return false;', tests: REDACTION },
  { name: 'redaction: short cookie values replaced (text corrupted)', file: 'src/core/browser/redaction.ts', from: 'if (value.length >= 8) result', to: 'if (value.length >= 0) result', tests: REDACTION },
  { name: 'redaction: cookie values kept in text', file: 'src/core/browser/redaction.ts', from: 'if (value.length >= 8) result', to: 'if (false) result', tests: REDACTION },
  { name: 'redaction: sensitive field values kept in text', file: 'src/core/browser/redaction.ts', from: 'if (value.length >= 3) result', to: 'if (false) result', tests: REDACTION },
  { name: 'redaction: shorter values replace longer ones first', file: 'src/core/browser/redaction.ts', from: '[...values].sort((a, b) => b.length - a.length)', to: '[...values].sort((a, b) => a.length - b.length)', tests: REDACTION },
  { name: 'redaction: digest and log keep the query string', file: 'src/core/browser/redaction.ts', from: 'return `${url.origin}${url.pathname}`;', to: 'return url.href;', tests: REDACTION },
  { name: 'redaction: titles keep control characters', file: 'src/core/browser/redaction.ts', from: "title.replace(/[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}]/gu, ' ')", to: 'title', tests: REDACTION },
  { name: 'redaction: titles not cut', file: 'src/core/browser/redaction.ts', from: 'clean.length > 120 ?', to: 'false ?', tests: REDACTION },
  // Observation switch
  { name: 'observation: off mode refused no more', file: 'src/core/browser/BrowserTools.ts', from: "if (mode === 'off') {", to: 'if (false) {', tests: OBSERVATION },
  { name: 'observation: Slack and Discord tabs readable', file: 'src/core/browser/services.ts', from: "service === 'slack' || service === 'discord'", to: 'false', tests: OBSERVATION },
  { name: 'observation: blocked address no longer forces off', file: 'src/core/browser/BrowserTools.ts', from: "if (matchesBlocked(url, this.deps.blocked())) return 'off';", to: '', tests: OBSERVATION },
  { name: 'observation: blocked path prefix ignored', file: 'src/core/browser/redaction.ts', from: '(pattern.pathPrefix === undefined || normalizePath(url.pathname).startsWith(normalizePath(pattern.pathPrefix)))', to: 'true', tests: OBSERVATION },
  { name: 'observation: blocked path compared raw', file: 'src/core/browser/redaction.ts', from: 'normalizePath(url.pathname).startsWith(normalizePath(pattern.pathPrefix))', to: 'url.pathname.startsWith(pattern.pathPrefix)', tests: OBSERVATION },
  { name: 'observation: blocked host matched by substring', file: 'src/core/browser/redaction.ts', from: ': url.hostname.toLowerCase() === pattern.origin.toLowerCase();', to: ': url.hostname.toLowerCase().includes(pattern.origin.toLowerCase());', tests: OBSERVATION },
  { name: 'observation: service defaults all on', file: 'src/core/browser/services.ts', from: "slack: 'off',\n  discord: 'off',", to: "slack: 'on-demand',\n  discord: 'on-demand',", tests: OBSERVATION },
  { name: 'observation: unknown surface counted as a tab', file: 'src/core/browser/BrowserTools.ts', from: "if (!record) throw new CommandError('failed', 'this surface cannot be observed; it is not a browser tab of this app');", to: '', tests: OBSERVATION },
];

const filter = process.argv[2];
const selected = filter === undefined ? mutations : mutations.filter((m) => m.name.includes(filter));
const surviving = [];
const broken = [];
let current;

const restore = () => {
  if (current) writeFileSync(current.path, current.original);
  current = undefined;
};
process.on('SIGINT', () => {
  restore();
  process.exit(130);
});

try {
  for (const mutation of selected) {
    const path = join(appDir, mutation.file);
    const original = readFileSync(path, 'utf8');
    const first = original.indexOf(mutation.from);
    if (first < 0 || original.indexOf(mutation.from, first + 1) >= 0) {
      broken.push(mutation.name);
      console.log(`SKIPPED  ${mutation.name}: the text to replace is not there exactly once`);
      continue;
    }
    current = { path, original };
    writeFileSync(path, original.replace(mutation.from, () => mutation.to));
    const run = spawnSync('pnpm', ['exec', 'vitest', 'run', ...mutation.tests], { cwd: appDir, encoding: 'utf8' });
    restore();
    const output = `${run.stdout}${run.stderr}`;
    // A suite that does not load (syntax error, missing import) is not a test noticing the change.
    const failed = (run.status ?? 1) !== 0 && /Failed Tests/.test(output) && !/Failed Suites/.test(output);
    const vacuous = (run.status ?? 1) !== 0 && !failed;
    console.log(`${failed ? 'KILLED  ' : vacuous ? 'BROKEN  ' : 'SURVIVED'} ${mutation.name}`);
    if (!failed) surviving.push(mutation.name);
  }
} finally {
  restore();
}

console.log(`\n${selected.length - surviving.length - broken.length} killed, ${surviving.length} survived, ${broken.length} skipped`);
process.exit(surviving.length + broken.length === 0 ? 0 : 1);
