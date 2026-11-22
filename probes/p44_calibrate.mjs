// README: P44 calibration. Starts the local test registry and answers the setup questions of the credential-proxy probe with curl and Node inside srt: which host names and loopback rules srt needs, whether the proxy CA is trusted by curl and Node, what the sandbox environment looks like, and what a masked env var (mechanism A) turns into. Evidence goes to probes/out/p44_calibrate.json. Run: node probes/p44_calibrate.mjs
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';
import { ROOT, fresh, cleanup, startRegistry, makeSecrets, baseEnv, baseSettings, runSrt, scanFor, srtVersion, HOSTS, write } from './p_cred_lib.mjs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'out');
mkdirSync(OUT, { recursive: true });
const dir = fresh('cal');
const home = join(dir, 'home'); const work = join(dir, 'work');
mkdirSync(work, { recursive: true });
const secrets = makeSecrets();
const reg = await startRegistry({ dir, secrets });
// The proxy verifies the upstream with Node's default roots plus NODE_EXTRA_CA_CERTS of the srt process; tlsTerminate.extraCaCertPaths only extends the bundle the sandbox sees.
const env = baseEnv(home, { NPM_TOKEN: secrets.npm, NODE_EXTRA_CA_CERTS: reg.caPem });
const report = { srtVersion: srtVersion(), registryPort: reg.port, cases: {} };

// Host side sanity: the registry answers with the throwaway CA.
const hostSide = await new Promise((res) => https.get(reg.url(HOSTS.inject, '/echo'), { ca: readFileSync(reg.caPem), headers: { authorization: 'Bearer host-side' } }, (r) => { let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => res({ status: r.statusCode, body: b.slice(0, 120) })); }).on('error', (e) => res({ error: String(e) })));
report.hostSide = hostSide;

const tmp = join(home, 'tmp');
// srt sets NO_PROXY=localhost,127.0.0.1,..., which tools match as a suffix, so every *.localhost name would skip the proxy; the probe clears it for the command.
const NP = 'NO_PROXY= no_proxy= ';
const ok = (host) => `${NP}curl -sS -m 20 -o /dev/null -w '%{http_code}' https://${host}:${reg.port}/ok`;
async function c(name, settings, cmd, extra = {}) {
  const m = reg.mark();
  const { envOverride, ...rest } = extra;
  const r = await runSrt({ settings, cmd, env: envOverride || env, cwd: work, dir, ...rest });
  report.cases[name] = { cmd, code: r.code, ms: r.ms, stdout: r.stdout.slice(0, 1500), stderr: r.stderr.slice(0, 1500), registrySaw: reg.since(m).map((e) => ({ host: e.host, url: e.url, kind: e.kind, status: e.status })) };
  console.log(name, r.code, r.ms + 'ms', JSON.stringify(r.stdout.slice(0, 200)), JSON.stringify(r.stderr.slice(0, 300)));
  return r;
}

// 1. No tls termination, localhost literal not allowed: the resolved-address check refuses the loopback target.
const noLiteral = baseSettings({ registry: reg, work, tmp });
noLiteral.network.allowedDomains = [HOSTS.inject, HOSTS.other, HOSTS.excluded];
delete noLiteral.network.tlsTerminate;
await c('1_no_literal_no_terminate', noLiteral, ok(HOSTS.inject), { debug: true });
// 2. With the loopback literal on the registry port, no termination: the client verifies the registry certificate itself (CA only through the bundle? no bundle without termination).
const noTerm = baseSettings({ registry: reg, work, tmp });
delete noTerm.network.tlsTerminate;
await c('2_literal_no_terminate', noTerm, ok(HOSTS.inject));
// 3. With termination: curl trusts the proxy CA through the variables srt sets.
const term = baseSettings({ registry: reg, work, tmp });
await c('3_terminate_curl', term, ok(HOSTS.inject));
await c('3a_terminate_curl_debug', term, ok(HOSTS.inject), { debug: true });
await c('3b_terminate_node', term, `${NP}node -e "fetch('https://${HOSTS.inject}:${reg.port}/ok').then(async r=>console.log(r.status, await r.text())).catch(e=>console.log('ERR', String(e.cause||e)))"`);
// Node's fetch ignores HTTPS_PROXY unless NODE_USE_ENV_PROXY=1; the https module does too. Try the env switch.
await c('3c_terminate_node_env_proxy', term, `${NP}NODE_USE_ENV_PROXY=1 node -e "fetch('https://${HOSTS.inject}:${reg.port}/ok').then(async r=>console.log(r.status, await r.text())).catch(e=>console.log('ERR', String(e.cause||e)))"`);
// 3d. Termination without the loopback literals in allowedDomains: the *.localhost names alone are enough.
const noLits = baseSettings({ registry: reg, work, tmp });
noLits.network.allowedDomains = [HOSTS.inject, HOSTS.other, HOSTS.excluded];
await c('3d_terminate_no_literals', noLits, ok(HOSTS.inject));
// 3e. extraCaCertPaths alone (no NODE_EXTRA_CA_CERTS in the srt process): the proxy does not verify the upstream.
const envNoExtra = baseEnv(home, { NPM_TOKEN: secrets.npm });
await c('3e_extraCaCertPaths_only', term, ok(HOSTS.inject), { envOverride: envNoExtra });
// 3f. Terminated host in excludeDomains: the client talks TLS to the registry itself and needs the throwaway CA, which extraCaCertPaths puts into the bundle.
await c('3f_excluded_host', term, ok(HOSTS.excluded));
// 3g. Plain http through the proxy.
await c('3g_plain_http', term, `${NP}curl -sS -m 20 -o /dev/null -w '%{http_code}' http://${HOSTS.inject}:${reg.plainPort}/ok`);
// 3h. Bare localhost, the IP literal with and without its entry, strictAllowlist and deniedResolvedAddresses.
const bare = baseSettings({ registry: reg, work, tmp });
bare.network.allowedDomains = ['localhost'];
await c('3h_bare_localhost', bare, `${NP}curl -sS -m 20 -o /dev/null -w '%{http_code}' https://localhost:${reg.port}/ok`);
const ipNoEntry = baseSettings({ registry: reg, work, tmp });
ipNoEntry.network.allowedDomains = [HOSTS.inject];
await c('3i_ip_literal_without_entry', ipNoEntry, `${NP}curl -sS -m 20 -o /dev/null -w '%{http_code}' https://127.0.0.1:${reg.port}/ok`);
const ipEntry = baseSettings({ registry: reg, work, tmp });
ipEntry.network.allowedDomains = [`127.0.0.1:${reg.port}`];
await c('3j_ip_literal_with_entry', ipEntry, `${NP}curl -sS -m 20 -o /dev/null -w '%{http_code}' https://127.0.0.1:${reg.port}/ok`);
const strict = baseSettings({ registry: reg, work, tmp });
strict.network.strictAllowlist = true;
await c('3k_strictAllowlist', strict, ok(HOSTS.inject));
const denyRes = baseSettings({ registry: reg, work, tmp });
denyRes.network.deniedResolvedAddresses = ['127.0.0.0/8', '::1/128'];
await c('3l_deniedResolvedAddresses_loopback', denyRes, ok(HOSTS.inject));
// 4. Sandbox environment: proxy and trust variables, masked variable.
const credA = { envVars: [{ name: 'NPM_TOKEN', mode: 'mask', injectHosts: [HOSTS.inject] }] };
const withCred = baseSettings({ registry: reg, work, tmp, credentials: credA });
const envRun = await c('4_env_masked', withCred, `env | sort`);
write(join(dir, 'env.txt'), envRun.stdout);
report.envMasked = envRun.stdout.split('\n').filter((l) => /proxy|PROXY|CERT|CA_|NPM_TOKEN|JAVA_TOOL|SRT|TMPDIR|HOME/.test(l)).map((l) => l.replace(/(PROXY=http:\/\/[^:]*:)[^@]*@/, '$1<token>@'));
report.envContainsRealSecret = envRun.stdout.includes(secrets.npm);
// 5. Masked var to the inject host with /echo: substitution in a Bearer header, then in Basic (base64).
await c('5_bearer_inject', withCred, `${NP}curl -sS -m 20 -H "Authorization: Bearer $NPM_TOKEN" https://${HOSTS.inject}:${reg.port}/echo`);
await c('5b_basic_inject', withCred, `${NP}curl -sS -m 20 -u "u:$NPM_TOKEN" https://${HOSTS.inject}:${reg.port}/echo`);
await c('5c_other_host', withCred, `${NP}curl -sS -m 20 -H "Authorization: Bearer $NPM_TOKEN" https://${HOSTS.other}:${reg.port}/echo`);
report.scanTemp = scanFor([dir], [secrets.npm]).map((h) => h.file.replace(dir, '<run>'));

writeFileSync(join(OUT, 'p44_calibrate.json'), JSON.stringify(report, null, 2));
await reg.close();
cleanup(dir);
console.log('done; free dir', ROOT);
