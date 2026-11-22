// README: P44 tool matrix. Runs one build tool inside srt against the local test registry, with one of two credential mechanisms, and records what the registry received, what the sandbox saw, and whether the real secret was found anywhere readable. Usage: node probes/p44_tools.mjs <npm|cargo|gradle|maven|pnpm|uv> <A|B|A2> [more pairs...]. A = srt credentials.envVars mask (CLI settings file). B = our own placeholder in a config file, substituted by network.filterRequest (SandboxManager as a library). A2 = mechanism A with a prebuilt Authorization header blob (Basic). Evidence: probes/out/p44_tool_<tool>_<mech>.json. One run at a time; tiny projects; no daemons.
import { mkdirSync, writeFileSync, readFileSync, existsSync, cpSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import tls from 'node:tls';
import { homedir } from 'node:os';
import { fresh, cleanup, write, startRegistry, makeSecrets, makePlaceholders, baseEnv, baseSettings, runSrt, runWrapped, loadSrtLib, scanFor, b64userpass, srtVersion, HOSTS, psGrep, freeGiB } from './p_cred_lib.mjs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'out');
mkdirSync(OUT, { recursive: true });
const NP = 'export NO_PROXY= no_proxy=;';
const VERBOSE_TOOL = process.env.P44_VERBOSE_TOOL === '1';
const TAIL = VERBOSE_TOOL ? 'cat' : 'tail -25';

// Substitution used by mechanism B: the placeholder is replaced by the real secret in the Authorization header only, only for hosts in INJECT. Basic values are decoded, replaced and encoded again.
export function makeFilter({ pairs, inject, onDecision }) {
  return async (request, info) => {
    const host = (info?.target?.host || new URL(request.url).hostname).toLowerCase();
    const auth = request.headers.get('authorization');
    let decision = { action: 'allow' };
    if (auth && inject.has(host) && info?.scheme === 'https') {
      let v = auth;
      const m = /^Basic\s+(.+)$/i.exec(auth);
      if (m) {
        let dec = Buffer.from(m[1], 'base64').toString('utf8');
        for (const [ph, real] of pairs) dec = dec.split(ph).join(real);
        v = `Basic ${Buffer.from(dec).toString('base64')}`;
      } else {
        for (const [ph, real] of pairs) v = v.split(ph).join(real);
      }
      if (v !== auth) decision = { action: 'allow', setHeaders: [['authorization', v]] };
    }
    onDecision?.({ host, scheme: info?.scheme, substituted: !!decision.setHeaders });
    return decision;
  };
}

// Every scenario returns: files to write, cmd (run inside the sandbox from `work`), env additions for the tool, the A-mode credential entries, the real values A must find in the srt process environment, the success check.
function scenario(tool, mech, ctx) {
  const { dir, home, work, tmp, reg, secrets, ph } = ctx;
  const P = reg.port, H = HOSTS.inject;
  const isA = mech === 'A' || mech === 'A2';
  const noSandbox = mech === 'N';
  const toolHome = join(dir, 'toolhome'); mkdirSync(toolHome, { recursive: true });
  const jks = `${NP} export TMPDIR=${tmp}; sed -n '1,/END CERTIFICATE/p' "$SSL_CERT_FILE" > ${tmp}/mitm.pem && keytool -importcert -noprompt -alias srt -file ${tmp}/mitm.pem -keystore ${tmp}/mitm.jks -storepass changeit >/dev/null 2>&1;`;
  const javaProps = `$(node ${join(dir, 'javaprops.mjs')})`;
  write(join(dir, 'javaprops.mjs'), `const d = decodeURIComponent;\nconst trust = ['-Djavax.net.ssl.trustStore=${tmp}/mitm.jks', '-Djavax.net.ssl.trustStorePassword=changeit', '-Djava.io.tmpdir=${tmp}'];\nif (process.env.P44_JPROPS === 'trust') { console.log(trust.join(' ')); process.exit(0); }\nconst u = new URL(process.env.HTTPS_PROXY);\nconst p = [...trust, '-Dhttps.proxyHost=' + u.hostname, '-Dhttps.proxyPort=' + u.port, '-Dhttp.proxyHost=' + u.hostname, '-Dhttp.proxyPort=' + u.port, '-Dhttps.proxyUser=' + d(u.username), '-Dhttps.proxyPassword=' + d(u.password), '-Dhttp.proxyUser=' + d(u.username), '-Dhttp.proxyPassword=' + d(u.password), '-Djdk.http.auth.tunneling.disabledSchemes=', '-Djdk.http.auth.proxying.disabledSchemes=', '-Dhttp.nonProxyHosts=none'];\nconsole.log(p.join(' '));\n`);
  const s = { files: {}, env: {}, network: {}, credentials: undefined, srtEnv: { ...(process.env.P44_JPROPS ? { P44_JPROPS: process.env.P44_JPROPS } : {}), ...(process.env.P44_NOPROXYSET ? { P44_NOPROXYSET: '1' } : {}) }, cmd: '', check: () => true, needles: [secrets.npm, secrets.cargo, secrets.maven, b64userpass(secrets.mavenUser, secrets.maven)] };
  if (tool === 'npm') {
    write(join(work, 'npm/package.json'), JSON.stringify({ name: 'app', version: '1.0.0', dependencies: { 'probe-pkg': '1.0.0' } }));
    const tokenRef = isA ? '${NPM_TOKEN}' : ph.npm;
    write(join(home, '.npmrc'), `registry=https://${H}:${P}/npm/\n//${H}:${P}/npm/:_authToken=${tokenRef}\n`);
    if (isA) { s.credentials = { envVars: [{ name: 'NPM_TOKEN', mode: 'mask', injectHosts: [H] }] }; s.srtEnv.NPM_TOKEN = secrets.npm; }
    s.cmd = `${NP} export TMPDIR=${tmp}; cd ${work}/npm && npm install --no-audit --no-fund --no-update-notifier --userconfig ${home}/.npmrc --cache ${dir}/npm-cache --loglevel ${VERBOSE_TOOL ? 'silly' : 'http'} 2>&1; ${VERBOSE_TOOL ? 'npm config ls -l --userconfig ' + home + '/.npmrc 2>&1 | grep -i -E "token|auth";' : ''} echo "exit=$?"; ls node_modules/probe-pkg 2>&1`;
    s.check = (r) => /index\.js/.test(r.stdout) && /exit=0/.test(r.stdout);
  } else if (tool === 'pnpm') {
    // The pnpm on PATH is a corepack shim; the cached release is copied so the sandbox does not need to download it.
    mkdirSync(join(dir, 'corepack/v1/pnpm'), { recursive: true });
    cpSync(join(homedir(), '.cache/node/corepack/v1/pnpm/11.21.0'), join(dir, 'corepack/v1/pnpm/11.21.0'), { recursive: true });
    write(join(work, 'pnpm/package.json'), JSON.stringify({ name: 'app', version: '1.0.0', packageManager: 'pnpm@11.21.0', dependencies: { 'probe-pkg': '1.0.0' } }));
    const tokenRef = isA ? '${NPM_TOKEN}' : ph.npm;
    // pnpm 11 ignores ${VAR} in registry credentials of a project .npmrc, so mechanism A keeps the reference in the user-level file.
    write(join(isA ? home : join(work, 'pnpm'), '.npmrc'), `registry=https://${H}:${P}/npm/\n//${H}:${P}/npm/:_authToken=${tokenRef}\n`);
    if (isA) write(join(work, 'pnpm/.npmrc'), `registry=https://${H}:${P}/npm/\n`);
    if (isA) { s.credentials = { envVars: [{ name: 'NPM_TOKEN', mode: 'mask', injectHosts: [H] }] }; s.srtEnv.NPM_TOKEN = secrets.npm; }
    s.cmd = `${NP} export TMPDIR=${tmp}; export COREPACK_HOME=${dir}/corepack COREPACK_ENABLE_NETWORK=0 COREPACK_ENABLE_AUTO_PIN=0 ${process.env.P44_NO_ENV_PROXY ? '' : 'NODE_USE_ENV_PROXY=1'} npm_config_userconfig=${home}/.npmrc XDG_CACHE_HOME=${dir}/xdg XDG_DATA_HOME=${dir}/xdgdata; cd ${work}/pnpm && pnpm install --store-dir ${dir}/pnpm-store --config.update-notifier=false --reporter=append-only 2>&1; echo "exit=$?"; ls node_modules/probe-pkg 2>&1`;
    s.check = (r) => /index\.js/.test(r.stdout) && /exit=0/.test(r.stdout);
  } else if (tool === 'uv') {
    // uv builds a Basic header from the userinfo of the index URL, so mechanism A cannot work (the sentinel ends up inside base64).
    const pw = isA ? '$PYPW' : ph.maven;
    if (isA) { s.credentials = { envVars: [{ name: 'PYPW', mode: 'mask', injectHosts: [H] }] }; s.srtEnv.PYPW = secrets.maven; }
    s.cmd = `${NP} export TMPDIR=${tmp} UV_NO_CONFIG=1 UV_PYTHON_DOWNLOADS=never UV_CACHE_DIR=${dir}/uv-cache XDG_CACHE_HOME=${dir}/xdg; uv pip install --python /usr/bin/python3 --target ${work}/uvt --index-url "https://deploy:${pw}@${H}:${P}/pypi/simple/" probe-pkg 2>&1; echo "exit=$?"; ls ${work}/uvt 2>&1`;
    s.check = (r) => /exit=0/.test(r.stdout) && /probe_pkg/.test(r.stdout.split('exit=0')[1] || '');
  } else if (tool === 'cargo') {
    write(join(work, 'cargo/Cargo.toml'), '[package]\nname = "app"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\nprobe-crate = { version = "1.0", registry = "probe" }\n');
    write(join(work, 'cargo/src/lib.rs'), 'pub fn f() {}\n');
    const cargoHome = join(dir, 'cargo-home'); mkdirSync(cargoHome, { recursive: true });
    s.env.CARGO_HOME = cargoHome;
    s.env.CARGO_REGISTRIES_PROBE_INDEX = `sparse+https://${H}:${P}/cargo/`;
    if (isA) { s.credentials = { envVars: [{ name: 'CARGO_REGISTRIES_PROBE_TOKEN', mode: 'mask', injectHosts: [H] }] }; s.srtEnv.CARGO_REGISTRIES_PROBE_TOKEN = secrets.cargo; }
    else write(join(cargoHome, 'credentials.toml'), `[registries.probe]\ntoken = "${ph.cargo}"\n`);
    const tc = join(homedir(), '.rustup/toolchains/stable-aarch64-apple-darwin/bin');
    s.cmd = `${NP} export TMPDIR=${tmp} PATH=${tc}:$PATH CARGO_HOME=${cargoHome} CARGO_REGISTRIES_PROBE_INDEX='${s.env.CARGO_REGISTRIES_PROBE_INDEX}' CARGO_REGISTRIES_PROBE_CREDENTIAL_PROVIDER=cargo:token ${VERBOSE_TOOL ? 'CARGO_HTTP_DEBUG=true CARGO_LOG=trace' : ''}; cd ${work}/cargo && cargo fetch ${VERBOSE_TOOL ? '-vv' : ''} 2>&1; echo "exit=$?"; ls ${cargoHome}/registry/cache/*/ 2>&1`;
    s.check = (r) => /exit=0/.test(r.stdout) && /probe-crate-1\.0\.0\.crate/.test(r.stdout);
  } else if (tool === 'gradle') {
    // Gradle binds a loopback socket for lock contention; macOS seatbelt refuses that unless network.allowLocalBinding is on.
    s.network.allowLocalBinding = true;
    const gh = join(dir, 'gradle-home'); mkdirSync(gh, { recursive: true });
    write(join(work, 'gradle/settings.gradle'), "rootProject.name = 'app'\n");
    const creds = mech === 'A2'
      ? `credentials(HttpHeaderCredentials) { name = 'Authorization'; value = 'Basic ' + System.getenv('MVN_BASIC') }\n    authentication { header(HttpHeaderAuthentication) }`
      : `credentials { username = 'deploy'; password = providers.gradleProperty('probePassword').get() }\n    authentication { basic(BasicAuthentication) }`;
    write(join(work, 'gradle/build.gradle'), `plugins { id 'java' }\nrepositories { maven { url = uri('https://${H}:${P}/maven')\n    ${creds}\n  } }\ndependencies { implementation 'com.example:probe:1.0' }\n`);
    write(join(work, 'gradle/src/main/java/App.java'), 'public class App { public static void main(String[] a) { System.out.println(probe.Probe.one()); } }\n');
    if (mech === 'A') { s.credentials = { envVars: [{ name: 'ORG_GRADLE_PROJECT_probePassword', mode: 'mask', injectHosts: [H] }] }; s.srtEnv.ORG_GRADLE_PROJECT_probePassword = secrets.maven; }
    else if (mech === 'A2') { s.credentials = { envVars: [{ name: 'MVN_BASIC', mode: 'mask', injectHosts: [H] }] }; s.srtEnv.MVN_BASIC = b64userpass(secrets.mavenUser, secrets.maven); }
    else write(join(gh, 'gradle.properties'), `probePassword=${ph.maven}\n`);
    s.cmd = `${jks} export GRADLE_USER_HOME=${gh} GRADLE_OPTS="${javaProps}"; cd ${work}/gradle && gradle --no-daemon -Dorg.gradle.daemon=false --console=plain --project-cache-dir ${dir}/gradle-proj ${VERBOSE_TOOL ? '--debug' : ''} compileJava 2>&1 | ${TAIL}; echo "exit=\${PIPESTATUS[0]}"; ls build/classes/java/main 2>&1`;
    s.check = (r) => /BUILD SUCCESSFUL|App\.class/.test(r.stdout) && /App\.class/.test(r.stdout);
  } else if (tool === 'maven') {
    const mh = join(dir, 'm2'); mkdirSync(mh, { recursive: true });
    write(join(work, 'maven/pom.xml'), `<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion><groupId>x</groupId><artifactId>app</artifactId><version>1</version>\n<repositories><repository><id>probe</id><url>https://${H}:${P}/maven</url><snapshots><enabled>false</enabled></snapshots></repository></repositories>\n<dependencies><dependency><groupId>com.example</groupId><artifactId>probe</artifactId><version>1.0</version></dependency></dependencies></project>\n`);
    const serverCfg = mech === 'A2' ? `<configuration><httpHeaders><property><name>Authorization</name><value>Basic \${env.MVN_BASIC}</value></property></httpHeaders></configuration>`
      : `<username>deploy</username><password>${isA ? '${env.MVN_PASSWORD}' : ph.maven}</password>`;
    write(join(home, 'm2settings.xml'), `<settings><servers><server><id>probe</id>${serverCfg}</server></servers>\n<proxies>__PROXY__</proxies></settings>\n`);
    if (mech === 'A') { s.credentials = { envVars: [{ name: 'MVN_PASSWORD', mode: 'mask', injectHosts: [H] }] }; s.srtEnv.MVN_PASSWORD = secrets.maven; }
    else if (mech === 'A2') { s.credentials = { envVars: [{ name: 'MVN_BASIC', mode: 'mask', injectHosts: [H] }] }; s.srtEnv.MVN_BASIC = b64userpass(secrets.mavenUser, secrets.maven); }
    // The Maven HTTP client takes its proxy from settings.xml, so the proxy entry is written from the environment inside the sandbox.
    write(join(dir, 'mvnsettings.mjs'), `import { readFileSync, writeFileSync } from 'node:fs';\nconst d = decodeURIComponent;\nconst u = process.env.HTTPS_PROXY ? new URL(process.env.HTTPS_PROXY) : null;\nconst x = !u ? '' : ['http','https'].map((p) => '<proxy><id>' + p + '</id><active>true</active><protocol>' + p + '</protocol><host>' + u.hostname + '</host><port>' + u.port + '</port><username>' + d(u.username) + '</username><password>' + d(u.password) + '</password></proxy>').join('');\nwriteFileSync(process.argv[3], readFileSync(process.argv[2], 'utf8').replace('__PROXY__', process.env.P44_NOPROXYSET ? '' : x));\n`);
    s.cmd = `${jks} export TMPDIR=${tmp}; node ${dir}/mvnsettings.mjs ${home}/m2settings.xml ${tmp}/settings.xml; export MAVEN_OPTS="${javaProps}"; cd ${work}/maven && mvn -B -ntp -s ${tmp}/settings.xml -Dmaven.repo.local=${mh} org.apache.maven.plugins:maven-dependency-plugin:3.8.1:resolve ${VERBOSE_TOOL ? '-X' : ''} 2>&1 | ${TAIL}; echo "exit=\${PIPESTATUS[0]}"; ls ${mh}/com/example/probe/1.0 2>&1`;
    s.check = (r) => /BUILD SUCCESS/.test(r.stdout) && /probe-1\.0\.jar/.test(r.stdout);
  } else throw new Error(`unknown tool ${tool}`);
  return s;
}

export async function runCase(tool, mech, { debug = false, dirOverride } = {}) {
  const dir = dirOverride || fresh(`${tool}-${mech}`);
  const home = join(dir, 'home'), work = join(dir, 'work'), tmp = join(dir, 'tmp');
  for (const d of [home, work, tmp]) mkdirSync(d, { recursive: true });
  const secrets = makeSecrets(), ph = makePlaceholders();
  const shape = process.env.P44_SHAPE;
  if (shape) { const alt = { short: 'pN', symbols: 'ab/cd+ef==gN', comment: 'ab#cd;ef gN', dollar: 'ab${HOME}cN', quote: 'ab"cd\'eN' }[shape]; Object.keys(ph).forEach((k, i) => { ph[k] = alt.replace('N', String(i + 1)); }); }
  const reg = await startRegistry({ dir, secrets });
  for (const v of Object.values(ph)) reg.fakes.add(v);
  if (mech === 'N') for (const [k, v] of Object.entries({ npm: secrets.npm, cargo: secrets.cargo, maven: secrets.maven })) ph[k] = v;
  const ctx = { dir, home, work, tmp, reg, secrets, ph };
  const sc = scenario(tool, mech, ctx);
  const needsCentral = tool === 'maven';
  const net = { ...sc.network };
  if (needsCentral) net.allowedDomains = [HOSTS.inject, HOSTS.other, HOSTS.excluded, 'repo.maven.apache.org', 'repo1.maven.org'];
  const settings = baseSettings({ registry: reg, work, tmp, credentials: sc.credentials, network: net, extraDeny: [], filesystem: { allowWrite: [work, tmp, dir] } });
  if (!net.allowedDomains) { /* default list */ }
  const record = { tool, mech, srtVersion: srtVersion(), settingsNetwork: settings.network, credentialsBlock: sc.credentials || null };
  let result;
  const m0 = reg.mark();
  if (mech === 'N') {
    // Baseline without the sandbox: same project and tool, real secret in the config file, direct connection, the throwaway CA trusted through the usual variables.
    const env = { ...baseEnv(home), ...sc.env, NODE_EXTRA_CA_CERTS: reg.caPem, SSL_CERT_FILE: reg.caPem, CARGO_HTTP_CAINFO: reg.caPem, P44_JPROPS: 'trust', P44_NOPROXYSET: '1', JAVA_TOOL_OPTIONS: '-Djava.net.preferIPv4Stack=true' };
    result = await new Promise((res) => { const t0 = Date.now(); const c = spawn('bash', ['-c', sc.cmd], { cwd: work, env, stdio: ['ignore', 'pipe', 'pipe'] }); let o = '', e = ''; c.stdout.on('data', (d) => (o += d)); c.stderr.on('data', (d) => (e += d)); c.on('close', (code) => res({ code, stdout: o, stderr: e, ms: Date.now() - t0 })); });
  } else if (mech === 'B') {
    const lib = await loadSrtLib();
    const SM = lib.SandboxManager;
    const decisions = [];
    const filter = makeFilter({ pairs: [[ph.npm, secrets.npm], [ph.cargo, secrets.cargo], [ph.maven, secrets.maven]], inject: new Set([HOSTS.inject]), onDecision: (d) => decisions.push(d) });
    // The proxy verifies the upstream with Node's default roots: add the throwaway CA there (Electron main needs the same, or NODE_EXTRA_CA_CERTS at launch).
    tls.setDefaultCACertificates([...tls.getCACertificates('default'), readFileSync(reg.caPem, 'utf8')]);
    const cfg = { ...settings, network: { ...settings.network, filterRequest: filter } };
    const t0 = Date.now();
    await SM.initialize(cfg);
    record.initMs = Date.now() - t0;
    const env = { ...baseEnv(home), ...sc.env, ...sc.srtEnv };
    result = await runWrapped(SM, sc.cmd, { env, cwd: work });
    record.decisions = decisions.length; record.substituted = decisions.filter((d) => d.substituted).length;
    record.violations = SM.getSandboxViolationStore().getViolations().map((v) => v.line).slice(0, 20);
    await SM.reset();
  } else {
    const env = baseEnv(home, { NODE_EXTRA_CA_CERTS: reg.caPem, ...sc.srtEnv });
    result = await runSrt({ settings, cmd: sc.cmd, env, cwd: work, dir, debug });
  }
  record.exit = result.code; record.ms = result.ms;
  record.stdout = result.stdout.slice(-3500); record.stderr = result.stderr.slice(-2500);
  record.ok = sc.check(result);
  const count = (hay, x) => hay.split(x).length - 1;
  const all = result.stdout + result.stderr;
  record.outputCounts = { chars: all.length, placeholder: Object.values(ph).reduce((n, x) => n + count(all, x), 0), srtSentinel: (all.match(/fake_value_[0-9a-f-]{36}/g) || []).length, real: [secrets.npm, secrets.cargo, secrets.maven, b64userpass(secrets.mavenUser, secrets.maven)].reduce((n, x) => n + count(all, x), 0), authorizationLines: (all.match(/authorization/gi) || []).length };
  record.registry = reg.since(m0).map((e) => ({ host: e.host, method: e.method, url: e.url, authKind: e.kind, authShape: e.auth ? e.auth.replace(/[A-Za-z0-9+/=_-]{8,}/g, (m) => `<${m.length}ch>`) : null, status: e.status }));
  record.leaks = { sandboxOutput: [secrets.npm, secrets.cargo, secrets.maven].some((x) => result.stdout.includes(x) || result.stderr.includes(x)), files: scanFor([dir, '/tmp/claude'], sc.needles).map((h) => h.file.replace(dir, '<run>')) };
  const out = join(OUT, `p44_tool_${tool}_${mech}${shape ? '_shape_' + shape : ''}${process.env.P44_JPROPS ? '_' + process.env.P44_JPROPS : ''}${process.env.P44_NOPROXYSET ? '_noproxyset' : ''}${VERBOSE_TOOL ? '_verbose' : ''}${process.env.P44_NO_ENV_PROXY ? '_noenvproxy' : ''}.json`);
  writeFileSync(out, JSON.stringify(record, null, 2));
  await reg.close();
  if (!process.env.P44_KEEP) cleanup(dir); else record.dir = dir;
  return record;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const debug = process.env.P44_DEBUG === '1';
  for (let i = 0; i + 1 < args.length; i += 2) {
    const r = await runCase(args[i], args[i + 1], { debug });
    console.log(`${r.tool} ${r.mech}: ok=${r.ok} exit=${r.exit} ${r.ms}ms substituted=${r.substituted ?? 'n/a'} leaks=${JSON.stringify(r.leaks)}`);
    for (const e of r.registry) console.log('   ', e.method, e.host, e.url.slice(0, 60), e.authKind, e.authShape, e.status);
    if (!r.ok || process.env.P44_VERBOSE) console.log(r.stdout.slice(-1800), '\n--stderr--\n', r.stderr.slice(-800));
    console.log('free GiB', freeGiB());
  }
}
