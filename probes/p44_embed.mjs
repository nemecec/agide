// README: P44 embedding probe. Answers whether SandboxManager is practical inside a long-running host such as the Electron main process: initialize and reset cost, listening sockets and descriptors, repeated initialize/reset, what is left behind when the host quits (clean reset, plain exit, SIGTERM, SIGKILL), how srt prints violations, and the per-run cost of the CLI. Run with Node or with Electron as Node: ELECTRON_RUN_AS_NODE=1 <Electron binary> probes/p44_embed.mjs. Evidence: probes/out/p44_embed_<runtime>.json. Internal mode: --host <port> <caPem> <logFile> <mode> is the child that plays the app.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import tls from 'node:tls';
import { tmpdir } from 'node:os';
import { fresh, cleanup, startRegistry, makeSecrets, makePlaceholders, baseEnv, baseSettings, runSrt, runWrapped, loadSrtLib, sleep, HOSTS, psGrep, freeGiB } from './p_cred_lib.mjs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'out');
mkdirSync(OUT, { recursive: true });
const runtime = process.versions.electron ? 'electron-node' : 'node';
const NP = 'export NO_PROXY= no_proxy=;';
const lsof = (pid, args) => spawnSync('lsof', ['-nP', '-a', '-p', String(pid), ...args], { encoding: 'utf8' }).stdout.trim().split('\n').slice(1).filter(Boolean);
const fdCount = (pid) => lsof(pid, []).length;
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const srtTemps = () => readdirSync(tmpdir()).filter((n) => n.startsWith('srt-'));

// ---- internal child: plays the app ----
if (process.argv[2] === '--host') {
  const [, , , port, caPem, logFile, mode, marker] = process.argv;
  const lib = await loadSrtLib();
  const SM = lib.SandboxManager;
  tls.setDefaultCACertificates([...tls.getCACertificates('default'), readFileSync(caPem, 'utf8')]);
  const home = join(dirname(logFile), 'home'); mkdirSync(join(home, 'tmp'), { recursive: true });
  const reg = { port: Number(port), plainPort: 1, caPem };
  const settings = baseSettings({ registry: reg, work: dirname(logFile), tmp: join(home, 'tmp') });
  settings.network.filterRequest = async () => ({ action: 'allow' });
  await SM.initialize(settings);
  const wrapped = await SM.wrapWithSandbox(`${NP} : ${marker}; while true; do curl -sS -m 5 -o /dev/null -w "%{http_code}\\n" https://${HOSTS.inject}:${port}/ok >> ${logFile} 2>&1; sleep 0.5; done`);
  const child = spawn(wrapped, { shell: true, env: baseEnv(home), stdio: 'ignore' });
  console.log(JSON.stringify({ ready: true, pid: process.pid, childPid: child.pid, proxyPort: SM.getProxyPort(), listeners: lsof(process.pid, ['-iTCP', '-sTCP:LISTEN']).length, unix: lsof(process.pid, ['-U']).length }));
  process.on('SIGTERM', async () => { if (mode === 'sigterm-reset') { await SM.reset(); } process.exit(0); });
  if (mode === 'reset') { await sleep(2500); await SM.reset(); process.exit(0); }
  if (mode === 'exit') { await sleep(2500); process.exit(0); }
  await sleep(120000);
  process.exit(0);
}

// ---- parent: the measurements ----
const dir = fresh('embed');
const secrets = makeSecrets(), ph = makePlaceholders();
const reg = await startRegistry({ dir, secrets });
const report = { runtime, node: process.versions.node, electron: process.versions.electron || null, v8: process.versions.v8 };
const home = join(dir, 'home'), work = join(dir, 'work'), tmp = join(home, 'tmp');
for (const d of [home, work, tmp]) mkdirSync(d, { recursive: true });
const lib = await loadSrtLib();
const SM = lib.SandboxManager;
tls.setDefaultCACertificates([...tls.getCACertificates('default'), readFileSync(reg.caPem, 'utf8')]);
const cfg = () => { const s = baseSettings({ registry: reg, work, tmp }); s.network.filterRequest = async () => ({ action: 'allow' }); return s; };

// E1/E2/E3: cost, sockets, descriptors, repeated initialize/reset.
const rounds = [];
const fd0 = fdCount(process.pid);
for (let i = 0; i < 6; i++) {
  const rss0 = process.memoryUsage().rss;
  let t = Date.now(); await SM.initialize(cfg()); const init = Date.now() - t;
  const listeners = lsof(process.pid, ['-iTCP', '-sTCP:LISTEN']).map((l) => l.split(/\s+/).slice(8).join(' '));
  const unix = lsof(process.pid, ['-U']).length;
  t = Date.now(); const wrapped = await SM.wrapWithSandbox(`${NP} curl -sS -m 10 -o /dev/null -w "%{http_code}" https://${HOSTS.inject}:${reg.port}/ok`); const wrap = Date.now() - t;
  t = Date.now(); const r = await runWrapped(SM, `${NP} curl -sS -m 10 -o /dev/null -w "%{http_code}" https://${HOSTS.inject}:${reg.port}/ok`, { env: baseEnv(home), cwd: work }); const first = Date.now() - t;
  const rss1 = process.memoryUsage().rss;
  t = Date.now(); await SM.reset(); const reset = Date.now() - t;
  rounds.push({ i, initMs: init, wrapMs: wrap, firstRunMs: first, status: r.stdout, resetMs: reset, rssDeltaMB: Math.round((rss1 - rss0) / 1e5) / 10, listenersWhileUp: listeners, unixSocketsWhileUp: unix, fdsAfterReset: fdCount(process.pid) - fd0, listenersAfterReset: lsof(process.pid, ['-iTCP', '-sTCP:LISTEN']).length, srtTempEntries: srtTemps().length });
}
report.rounds = rounds;
report.medians = { initMs: median(rounds.map((r) => r.initMs)), wrapMs: median(rounds.map((r) => r.wrapMs)), firstRunMs: median(rounds.map((r) => r.firstRunMs)), resetMs: median(rounds.map((r) => r.resetMs)) };

// E5: how violations are printed. Library first, then the CLI.
await SM.initialize(cfg());
const caDirs = srtTemps().filter((n) => n.startsWith('srt-ca-')).map((n) => ({ dir: n, files: readdirSync(join(tmpdir(), n)).map((f) => `${f} ${(statSync(join(tmpdir(), n, f)).mode & 0o777).toString(8)}`) }));
report.srtCaDirs = caDirs.slice(-2);
const denied = `curl -sS -m 10 https://denied.example.invalid/ ; echo > ${join(dir, 'blocked.txt')}; echo x > /private/tmp/agide-p44/outside.txt`;
const cid = `p44-${'x'.repeat(30)}`;
const wrappedId = await SM.wrapWithSandbox(`${NP} ${denied}`, undefined, undefined, undefined, { commandId: cid });
const rv = await new Promise((res) => { const c = spawn(wrappedId, { shell: true, env: baseEnv(home), cwd: work, stdio: ['ignore', 'pipe', 'pipe'] }); let o = '', e = ''; c.stdout.on('data', (d) => (o += d)); c.stderr.on('data', (d) => (e += d)); c.on('close', () => res({ stdout: o, stderr: e, wrapped: wrappedId })); });
await sleep(500);
const store = SM.getSandboxViolationStore();
report.violationsLibrary = { stderr: rv.stderr.slice(0, 600), storeLines: store.getViolations().map((v) => v.line).slice(0, 6), annotated: SM.annotateStderrWithSandboxFailures(cid, rv.stderr).slice(0, 900) };
await SM.reset();
const cli = await runSrt({ settings: baseSettings({ registry: reg, work, tmp }), cmd: `${NP} ${denied}`, env: baseEnv(home, { NODE_EXTRA_CA_CERTS: reg.caPem }), cwd: work, dir });
report.violationsCli = { stdout: cli.stdout.slice(0, 400), stderr: cli.stderr.slice(0, 900), code: cli.code };
const cliDbg = await runSrt({ settings: baseSettings({ registry: reg, work, tmp }), cmd: `${NP} ${denied}`, env: baseEnv(home, { NODE_EXTRA_CA_CERTS: reg.caPem }), cwd: work, dir, debug: true });
report.violationsCliDebug = cliDbg.stderr.split('\n').filter((l) => /deny|denied|violation|blocked|not allowed/i.test(l)).slice(0, 12);

// E6: CLI cost per run.
const timeIt = async (f, n = 5) => { const a = []; for (let i = 0; i < n; i++) { const t = Date.now(); await f(); a.push(Date.now() - t); } return { medianMs: median(a), all: a }; };
const sh = (cmd) => new Promise((res) => { const c = spawn('bash', ['-c', cmd], { stdio: 'ignore', env: baseEnv(home) }); c.on('close', res); });
report.cli = {
  bashTrue: await timeIt(() => sh('true')),
  srtTrue: await timeIt(() => runSrt({ settings: baseSettings({ registry: reg, work, tmp }), cmd: 'true', env: baseEnv(home, { NODE_EXTRA_CA_CERTS: reg.caPem }), cwd: work, dir })),
  srtTrueWithCredentials: await timeIt(() => runSrt({ settings: baseSettings({ registry: reg, work, tmp, credentials: { envVars: [{ name: 'TOK', mode: 'mask', injectHosts: [HOSTS.inject] }] } }), cmd: 'true', env: baseEnv(home, { NODE_EXTRA_CA_CERTS: reg.caPem, TOK: 'x'.repeat(40) }), cwd: work, dir })),
  curlDirectHostSide: await timeIt(() => new Promise((res) => spawn('curl', ['-sS', '-o', '/dev/null', '--cacert', reg.caPem, '--resolve', `${HOSTS.inject}:${reg.port}:127.0.0.1`, `https://${HOSTS.inject}:${reg.port}/ok`], { stdio: 'ignore' }).on('close', res))),
  curlThroughSrtCli: await timeIt(() => runSrt({ settings: baseSettings({ registry: reg, work, tmp }), cmd: `${NP} curl -sS -o /dev/null https://${HOSTS.inject}:${reg.port}/ok`, env: baseEnv(home, { NODE_EXTRA_CA_CERTS: reg.caPem }), cwd: work, dir })),
};

// E4: what is left when the host quits.
const quit = {};
for (const mode of ['reset', 'exit', 'sigterm', 'sigkill']) {
  const marker = `p44loop${mode}${Math.random().toString(36).slice(2, 8)}`;
  const logFile = join(dir, `loop-${mode}`, 'loop.log'); mkdirSync(dirname(logFile), { recursive: true });
  const tempsBefore = new Set(srtTemps());
  const host = spawn(process.execPath, [fileURLToPath(import.meta.url), '--host', String(reg.port), reg.caPem, logFile, mode, marker], { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env } });
  let info = null; let buf = '';
  host.stdout.on('data', (d) => { buf += d; const m = /\{.*"ready".*\}/.exec(buf); if (m && !info) info = JSON.parse(m[0]); });
  for (let i = 0; i < 100 && !info; i++) await sleep(100);
  await sleep(1500);
  const during = { hostPid: info?.pid, proxyPort: info?.proxyPort, listeners: info?.listeners, unix: info?.unix, loopAlive: !!psGrep(marker), logLines: existsSync(logFile) ? readFileSync(logFile, 'utf8').trim().split('\n').length : 0 };
  const tempsDuring = srtTemps().filter((n) => !tempsBefore.has(n));
  const exited = new Promise((res) => host.on('exit', (code, sig) => res({ code, sig })));
  if (mode === 'sigterm') host.kill('SIGTERM'); else if (mode === 'sigkill') host.kill('SIGKILL');
  const ex = await Promise.race([exited, sleep(8000).then(() => 'timeout')]);
  await sleep(2500);
  const logAfter1 = readFileSync(logFile, 'utf8').trim().split('\n');
  await sleep(2000);
  const logAfter2 = readFileSync(logFile, 'utf8').trim().split('\n');
  const after = {
    hostExit: ex, proxyPortStillListening: spawnSync('lsof', ['-nP', `-iTCP:${info?.proxyPort}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).stdout.trim() !== '',
    loopStillRunning: !!psGrep(marker), logGrewAfterExit: logAfter2.length > logAfter1.length, lastLogLines: logAfter2.slice(-3),
    srtTempLeft: srtTemps().filter((n) => !tempsBefore.has(n)), srtTempDuring: tempsDuring,
  };
  quit[mode] = { during, after };
  spawnSync('sh', ['-c', `pkill -f ${marker}`]); // the orphaned loop belongs to this probe
  await sleep(300);
  for (const n of srtTemps().filter((n) => !tempsBefore.has(n))) spawnSync('rm', ['-rf', join(tmpdir(), n)]);
}
report.quit = quit;
report.leftoverProcesses = psGrep('p44loop|srt-proxy');

writeFileSync(join(OUT, `p44_embed_${runtime}.json`), JSON.stringify(report, null, 2));
await reg.close();
cleanup(dir);
console.log(JSON.stringify({ runtime, medians: report.medians, cli: Object.fromEntries(Object.entries(report.cli).map(([k, v]) => [k, v.medianMs])), quit: Object.fromEntries(Object.entries(quit).map(([k, v]) => [k, { exit: v.after.hostExit, portListening: v.after.proxyPortStillListening, loop: v.after.loopStillRunning, logGrew: v.after.logGrewAfterExit, tempLeft: v.after.srtTempLeft.length, last: v.after.lastLogLines }])) }, null, 1));
console.log('free GiB', freeGiB());
