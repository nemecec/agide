// README: shared helpers for the credential-proxy probes P44 (Node ESM, no dependencies). Not run directly. Everything lives under /tmp/agide-p44/: a throwaway CA, a local HTTPS test registry (npm, Maven and Cargo sparse layouts, an /echo endpoint, a redirect endpoint, an Authorization log), runners for the srt CLI and for SandboxManager used as a library, and a secret scanner. No real credential is read or written anywhere.
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, existsSync, lstatSync } from 'node:fs';
import { homedir } from 'node:os';
import http from 'node:http';
import https from 'node:https';
import { join } from 'node:path';

export const ROOT = '/tmp/agide-p44';
mkdirSync(ROOT, { recursive: true });
export const fresh = (prefix) => mkdtempSync(join(ROOT, `${prefix}-`));
export const cleanup = (d) => { try { rmSync(d, { recursive: true, force: true }); } catch {} };
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const write = (p, s, mode) => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, s, mode ? { mode } : undefined); };

// Locates the srt package: SRT_PKG, else the pnpm global store (pnpm root -g, one directory level below it), else the shim of the srt binary.
export function srtPackageDir() {
  if (process.env.SRT_PKG) return process.env.SRT_PKG;
  const tail = join('node_modules', '@anthropic-ai', 'sandbox-runtime');
  const pnpmHome = process.env.PNPM_HOME || join(homedir(), 'Library', 'pnpm');
  const env = { ...process.env, PATH: `${join(pnpmHome, 'bin')}:${process.env.PATH}` };
  const root = spawnSync('pnpm', ['root', '-g'], { encoding: 'utf8', env }).stdout.trim().split('\n').pop();
  if (root) {
    for (const d of readdirSync(root)) {
      const c = join(root, d, tail);
      if (existsSync(join(c, 'package.json'))) return c;
    }
  }
  const shim = spawnSync('sh', ['-c', 'command -v srt'], { encoding: 'utf8', env }).stdout.trim();
  if (shim) {
    const m = /cmd-shim-target=(.*)\/dist\/cli\.js/.exec(readFileSync(shim, 'utf8'));
    if (m) return m[1];
  }
  throw new Error('srt package not found; set SRT_PKG');
}
export const srtVersion = () => JSON.parse(readFileSync(join(srtPackageDir(), 'package.json'), 'utf8')).version;
export const srtBinDir = () => join(process.env.PNPM_HOME || join(homedir(), 'Library', 'pnpm'), 'bin');

// Random test strings in the shape of real tokens.
const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
export const rnd = (n) => Array.from(randomBytes(n), (b) => ALNUM[b % ALNUM.length]).join('');
export const makeSecrets = () => ({ npm: `npm_${rnd(36)}`, mavenUser: 'deploy', maven: `${rnd(28)}`, cargo: `cio${rnd(32)}` });
export const makePlaceholders = () => ({ npm: `npm_${rnd(36)}`, maven: `${rnd(28)}`, cargo: `cio${rnd(32)}` });

// ---- throwaway CA and the registry certificate (openssl CLI, LibreSSL compatible) ----
export const HOSTS = { inject: 'registry.localhost', other: 'other.localhost', excluded: 'excl.localhost', sub: 'a.registry.localhost' };
export function makeCa(dir) {
  mkdirSync(dir, { recursive: true });
  const sh = (cmd) => { const r = spawnSync('sh', ['-c', cmd], { cwd: dir, encoding: 'utf8' }); if (r.status !== 0) throw new Error(`${cmd}\n${r.stderr}`); };
  write(join(dir, 'ca.cnf'), `[req]\ndistinguished_name=dn\nx509_extensions=v3\nprompt=no\n[dn]\nCN=p44 throwaway test CA ${rnd(8)}\n[v3]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\n`);
  const san = [...Object.values(HOSTS), 'localhost'].map((h) => `DNS:${h}`).join(',') + ',IP:127.0.0.1';
  write(join(dir, 'leaf.cnf'), `[req]\ndistinguished_name=dn\nprompt=no\n[dn]\nCN=${HOSTS.inject}\n[v3]\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature\nextendedKeyUsage=serverAuth\nsubjectAltName=${san}\n`);
  sh('openssl ecparam -name prime256v1 -genkey -noout -out ca.key');
  sh('openssl req -x509 -new -key ca.key -sha256 -days 3 -config ca.cnf -out ca.pem');
  sh('openssl ecparam -name prime256v1 -genkey -noout -out leaf.key');
  sh('openssl req -new -key leaf.key -config leaf.cnf -out leaf.csr');
  sh('openssl x509 -req -in leaf.csr -CA ca.pem -CAkey ca.key -CAcreateserial -sha256 -days 3 -extfile leaf.cnf -extensions v3 -out leaf.pem');
  return { caPem: join(dir, 'ca.pem'), key: readFileSync(join(dir, 'leaf.key')), cert: readFileSync(join(dir, 'leaf.pem')) };
}

// ---- fixture packages ----
const sha = (alg, buf) => createHash(alg).update(buf).digest('hex');
function sh(dir, cmd) { const r = spawnSync('sh', ['-c', cmd], { cwd: dir, encoding: 'utf8' }); if (r.status !== 0) throw new Error(`${cmd}\n${r.stdout}${r.stderr}`); }
export function makeFixtures(dir) {
  mkdirSync(dir, { recursive: true });
  // npm: package/package.json
  write(join(dir, 'npm/package/package.json'), JSON.stringify({ name: 'probe-pkg', version: '1.0.0', main: 'index.js' }));
  write(join(dir, 'npm/package/index.js'), 'module.exports = 1;\n');
  sh(join(dir, 'npm'), 'COPYFILE_DISABLE=1 tar -czf probe-pkg-1.0.0.tgz package');
  const npmTgz = readFileSync(join(dir, 'npm/probe-pkg-1.0.0.tgz'));
  // Maven: a pom and a jar with one class compiled by javac
  write(join(dir, 'mvn/src/probe/Probe.java'), 'package probe;\npublic class Probe { public static int one() { return 1; } }\n');
  sh(join(dir, 'mvn'), 'javac -d classes src/probe/Probe.java && jar cf probe-1.0.jar -C classes .');
  const jar = readFileSync(join(dir, 'mvn/probe-1.0.jar'));
  const pom = Buffer.from('<?xml version="1.0" encoding="UTF-8"?>\n<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion><groupId>com.example</groupId><artifactId>probe</artifactId><version>1.0</version><packaging>jar</packaging></project>\n');
  // Cargo: a .crate (gzip tar) with Cargo.toml and src/lib.rs
  write(join(dir, 'cargo/probe-crate-1.0.0/Cargo.toml'), '[package]\nname = "probe-crate"\nversion = "1.0.0"\nedition = "2021"\n');
  write(join(dir, 'cargo/probe-crate-1.0.0/src/lib.rs'), 'pub fn one() -> u32 { 1 }\n');
  sh(join(dir, 'cargo'), 'COPYFILE_DISABLE=1 tar -czf probe-crate-1.0.0.crate probe-crate-1.0.0');
  const crate = readFileSync(join(dir, 'cargo/probe-crate-1.0.0.crate'));
  // PyPI: a wheel (zip) with one module
  write(join(dir, 'pypi/probe_pkg/__init__.py'), 'VALUE = 1\n');
  write(join(dir, 'pypi/probe_pkg-1.0.dist-info/METADATA'), 'Metadata-Version: 2.1\nName: probe-pkg\nVersion: 1.0\n');
  write(join(dir, 'pypi/probe_pkg-1.0.dist-info/WHEEL'), 'Wheel-Version: 1.0\nGenerator: p44\nRoot-Is-Purelib: true\nTag: py3-none-any\n');
  write(join(dir, 'pypi/probe_pkg-1.0.dist-info/RECORD'), '');
  sh(join(dir, 'pypi'), 'COPYFILE_DISABLE=1 /usr/bin/zip -qr probe_pkg-1.0-py3-none-any.whl probe_pkg probe_pkg-1.0.dist-info');
  const wheel = readFileSync(join(dir, 'pypi/probe_pkg-1.0-py3-none-any.whl'));
  return { npmTgz, jar, pom, crate, wheel };
}

// ---- the test registry ----
// opts: { dir, secrets, fakes: string[] (known placeholder strings, for classification), plainPort }
export async function startRegistry({ dir, secrets }) {
  const ca = makeCa(join(dir, 'pki'));
  const fx = makeFixtures(join(dir, 'fixtures'));
  const log = []; // every request: { t, scheme, host, method, url, auth, kind, headers }
  const fakes = new Set();
  const classify = (auth) => {
    if (!auth) return 'none';
    let decoded = '';
    const m = /^Basic\s+(.+)$/i.exec(auth);
    if (m) { try { decoded = Buffer.from(m[1], 'base64').toString('utf8'); } catch {} }
    const hay = `${auth}\n${decoded}`;
    for (const s of [secrets.npm, secrets.maven, secrets.cargo]) if (hay.includes(s)) return 'real';
    for (const f of fakes) if (hay.includes(f)) return 'placeholder';
    if (hay.includes('fake_value_')) return 'srt-sentinel';
    return 'other';
  };
  const okAuth = (req, which) => {
    const a = req.headers.authorization || '';
    if (which === 'npm') return a === `Bearer ${secrets.npm}`;
    if (which === 'cargo') return a === secrets.cargo;
    if (which === 'maven') return a === `Basic ${Buffer.from(`${secrets.mavenUser}:${secrets.maven}`).toString('base64')}`;
    return false;
  };
  const handler = (scheme) => (req, res) => {
    const host = req.headers.host || '';
    const entry = { t: Date.now(), scheme, host, method: req.method, url: req.url, auth: req.headers.authorization || null, kind: classify(req.headers.authorization), headers: { ...req.headers } };
    log.push(entry);
    const send = (code, body, headers = {}) => { entry.status = code; res.writeHead(code, headers); res.end(body); };
    const u = new URL(req.url, `${scheme}://${host}`);
    const p = u.pathname;
    let body = [];
    req.on('data', (d) => body.push(d));
    req.on('end', () => {
      entry.body = Buffer.concat(body).toString('utf8').slice(0, 2000);
      if (p === '/echo') {
        const payload = JSON.stringify({ method: req.method, url: req.url, headers: req.headers, body: entry.body });
        return send(200, payload, { 'content-type': 'application/json', 'x-echo-authorization': req.headers.authorization || '', 'set-cookie': `echo=${req.headers.authorization || ''}; Path=/` });
      }
      if (p === '/redirect') return send(302, '', { location: u.searchParams.get('to') });
      if (p === '/ok') return send(200, 'ok');
      if (p.startsWith('/npm/')) {
        if (!okAuth(req, 'npm')) return send(401, '{"error":"unauthorized"}', { 'www-authenticate': 'Bearer realm="p44"', 'content-type': 'application/json' });
        if (p === '/npm/probe-pkg') {
          const doc = { name: 'probe-pkg', 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': { name: 'probe-pkg', version: '1.0.0', dist: { tarball: `${scheme}://${host}/npm/probe-pkg/-/probe-pkg-1.0.0.tgz`, shasum: sha('sha1', fx.npmTgz), integrity: `sha512-${createHash('sha512').update(fx.npmTgz).digest('base64')}` } } } };
          return send(200, JSON.stringify(doc), { 'content-type': 'application/json' });
        }
        if (p === '/npm/probe-pkg/-/probe-pkg-1.0.0.tgz') return send(200, fx.npmTgz, { 'content-type': 'application/octet-stream' });
        return send(404, '{}');
      }
      if (p.startsWith('/maven/')) {
        if (!okAuth(req, 'maven')) return send(401, 'unauthorized', { 'www-authenticate': 'Basic realm="p44"' });
        const base = '/maven/com/example/probe/1.0/probe-1.0';
        const files = { [`${base}.pom`]: fx.pom, [`${base}.jar`]: fx.jar };
        for (const [k, v] of Object.entries({ ...files })) { files[`${k}.sha1`] = Buffer.from(sha('sha1', v)); files[`${k}.md5`] = Buffer.from(sha('md5', v)); }
        if (files[p]) return send(200, files[p], { 'content-type': 'application/octet-stream' });
        return send(404, 'not found');
      }
      if (p.startsWith('/cargo/')) {
        if (!okAuth(req, 'cargo')) return send(401, 'unauthorized', { 'www-authenticate': `Cargo login_url="${scheme}://${host}/login"` });
        if (p === '/cargo/config.json') return send(200, JSON.stringify({ dl: `${scheme}://${host}/cargo/crates/{crate}/{version}/download`, api: `${scheme}://${host}/cargo`, 'auth-required': true }), { 'content-type': 'application/json' });
        if (p === '/cargo/pr/ob/probe-crate') return send(200, JSON.stringify({ name: 'probe-crate', vers: '1.0.0', deps: [], cksum: sha('sha256', fx.crate), features: {}, yanked: false }) + '\n', { 'content-type': 'text/plain' });
        if (p === '/cargo/crates/probe-crate/1.0.0/download') return send(200, fx.crate, { 'content-type': 'application/octet-stream' });
        return send(404, 'not found');
      }
      if (p.startsWith('/pypi/')) {
        if (!okAuth(req, 'maven')) return send(401, 'unauthorized', { 'www-authenticate': 'Basic realm="p44"' });
        if (p === '/pypi/simple/probe-pkg/') return send(200, `<!DOCTYPE html><html><body><a href="${scheme}://${host}/pypi/files/probe_pkg-1.0-py3-none-any.whl#sha256=${sha('sha256', fx.wheel)}">probe_pkg-1.0-py3-none-any.whl</a></body></html>`, { 'content-type': 'text/html' });
        if (p === '/pypi/files/probe_pkg-1.0-py3-none-any.whl') return send(200, fx.wheel, { 'content-type': 'application/octet-stream' });
        return send(404, 'not found');
      }
      send(404, 'not found');
    });
  };
  const server = https.createServer({ key: ca.key, cert: ca.cert }, handler('https'));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const plain = http.createServer(handler('http'));
  await new Promise((r) => plain.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const plainPort = plain.address().port;
  return {
    port, plainPort, caPem: ca.caPem, log, fakes,
    url: (host = HOSTS.inject, path = '') => `https://${host}:${port}${path}`,
    plainUrl: (host = HOSTS.inject, path = '') => `http://${host}:${plainPort}${path}`,
    mark: () => log.length,
    since: (i) => log.slice(i),
    close: () => new Promise((r) => { server.closeAllConnections?.(); plain.closeAllConnections?.(); server.close(() => plain.close(r)); }),
  };
}

// ---- running things under the srt CLI ----
export function baseEnv(home, extra = {}) {
  const pnpmBin = srtBinDir();
  const env = {
    PATH: `${pnpmBin}:${process.env.PATH}`,
    HOME: home, TMPDIR: join(home, 'tmp'), LANG: 'C.UTF-8',
    JAVA_HOME: process.env.JAVA_HOME || '',
    ...extra,
  };
  mkdirSync(env.TMPDIR, { recursive: true });
  return env;
}

// Runs `srt --settings <file> -c <cmd>`. Returns { code, stdout, stderr, ms }.
export function runSrt({ settings, cmd, env, cwd, dir, timeoutMs = 180000, debug = false }) {
  const f = join(dir, `settings-${rnd(5)}.json`);
  writeFileSync(f, JSON.stringify(settings, null, 2));
  return new Promise((res) => {
    const t0 = Date.now();
    const args = ['--settings', f, ...(debug ? ['--debug'] : []), '-c', cmd];
    const child = spawn('srt', args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, timeoutMs);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code, sig) => { clearTimeout(timer); res({ code, sig, stdout, stderr, ms: Date.now() - t0, settingsFile: f }); });
  });
}

// The settings every probe starts from. ctx: { registry, home, work }.
export function baseSettings({ registry, work, tmp, extraDeny = [], network = {}, credentials, filesystem = {} }) {
  const s = {
    network: {
      allowedDomains: [HOSTS.inject, HOSTS.other, HOSTS.excluded, HOSTS.sub, `127.0.0.1:${registry.port}`, `127.0.0.1:${registry.plainPort}`],
      deniedDomains: [],
      tlsTerminate: { excludeDomains: [HOSTS.excluded], extraCaCertPaths: [registry.caPem] },
      ...network,
    },
    filesystem: {
      // Absolute paths: srt expands ~ from the HOME of its own process, which the probes point at a temporary directory.
      denyRead: ['.npmrc', '.m2/settings.xml', '.m2/settings-security.xml', '.cargo/credentials.toml', '.cargo/credentials', '.gradle/gradle.properties', '.ssh'].map((p) => join(homedir(), p)).concat(extraDeny),
      allowWrite: [work, tmp],
      denyWrite: [],
      ...filesystem,
    },
  };
  if (credentials) s.credentials = credentials;
  return s;
}

// ---- secret scanning (host side, outside the sandbox) ----
// Returns [{ file, needle }] for every file under the roots that contains any needle (raw or as base64 of the text around it).
export function scanFor(roots, needles, { maxBytes = 64 * 1024 * 1024 } = {}) {
  const hits = [];
  const variants = needles.flatMap((n) => [n, Buffer.from(n).toString('base64'), Buffer.from(`${n}`).toString('base64').replace(/=+$/, '')]);
  const bufs = [...new Set(variants)].map((v) => ({ v, b: Buffer.from(v) }));
  const walk = (p) => {
    let st; try { st = lstatSync(p); } catch { return; }
    if (st.isSymbolicLink()) return;
    if (st.isDirectory()) { let es = []; try { es = readdirSync(p); } catch {} for (const e of es) walk(join(p, e)); return; }
    if (!st.isFile() || st.size > maxBytes) return;
    let data; try { data = readFileSync(p); } catch { return; }
    for (const { v, b } of bufs) if (data.includes(b)) hits.push({ file: p, needle: needles.includes(v) ? 'raw' : 'base64' });
  };
  for (const r of roots) walk(r);
  return hits;
}
export const b64userpass = (u, p) => Buffer.from(`${u}:${p}`).toString('base64');

// ---- SandboxManager as a library ----
export async function loadSrtLib() {
  return import(join(srtPackageDir(), 'dist', 'index.js'));
}

// Runs a command wrapped by an initialized SandboxManager. Returns { code, stdout, stderr, ms }.
export async function runWrapped(SandboxManager, cmd, { env, cwd, timeoutMs = 180000 } = {}) {
  const t0 = Date.now();
  const wrapped = await SandboxManager.wrapWithSandbox(cmd);
  return new Promise((res) => {
    const child = spawn(wrapped, { shell: true, cwd, env: env || process.env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, timeoutMs);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code, sig) => { clearTimeout(timer); res({ code, sig, stdout, stderr, ms: Date.now() - t0, wrapped }); });
  });
}

export const psGrep = (pattern) => spawnSync('sh', ['-c', `ps -axo pid,ppid,etime,command | grep -E '${pattern}' | grep -v grep`], { encoding: 'utf8' }).stdout.trim();
export const freeGiB = () => { const r = spawnSync('df', ['-k', '/tmp'], { encoding: 'utf8' }).stdout.trim().split('\n').pop().split(/\s+/); return Math.round((Number(r[3]) / 1024 / 1024) * 10) / 10; };
