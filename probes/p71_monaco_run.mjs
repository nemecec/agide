// P71 to P76: run the scenarios of probes/p70_monaco_src/scenarios.js in the app's own Electron, hidden.
//
// Usage: node probes/p71_monaco_run.mjs <scratch project> [variant:scenario ...] [--repeat N]
//
// Default pairs: baseline:startup, core:startup, full:startup, shiki:startup, core:models, core:leaks,
// core:diff, core:themes, core:markdown, core:highlight, shiki:highlight. A variant name ending in `-min` runs
// the minified build. Each run is one Electron process with a fresh user data directory under the scratch
// project; the environment is a fixed allow-list (no inherited variables). Results go to <scratch>/results and a
// summary is printed. No model is started.

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const repeatAt = args.indexOf('--repeat');
const repeat = repeatAt === -1 ? 1 : Number(args.splice(repeatAt, 2)[1]);
const scratch = resolve(args.shift() ?? '/tmp/agide-editor-design/scratch');
const pairs = args.length > 0 ? args : ['baseline:startup', 'core:startup', 'full:startup', 'shiki:startup', 'core:models', 'core:leaks', 'core:diff', 'core:themes', 'core:markdown', 'core:highlight', 'shiki:highlight'];
const electron = createRequire(join(here, '..', 'app', 'package.json'))('electron');
const results = join(scratch, 'results');
mkdirSync(results, { recursive: true });

const env = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: process.env.HOME, TMPDIR: process.env.TMPDIR ?? '/tmp', LANG: 'en_US.UTF-8' };

for (const pair of pairs) {
  const [variant, scenario] = pair.split(':');
  for (let run = 1; run <= repeat; run += 1) {
    const out = join(results, `${variant}-${scenario}-${run}.json`);
    const userData = join(scratch, 'userdata', `${variant}-${scenario}-${run}`);
    rmSync(userData, { recursive: true, force: true });
    mkdirSync(userData, { recursive: true });
    const started = Date.now();
    const child = spawnSync(electron, [join(here, 'p71_monaco_main.cjs')], {
      env: { ...env, P71_HTML: join(scratch, 'out', variant, `${variant.replace(/-min$/, '')}.html`), P71_SCENARIO: scenario, P71_OUT: out, P71_USER_DATA: userData },
      encoding: 'utf8', timeout: 180000,
    });
    const wallMs = Date.now() - started;
    let report;
    try {
      report = JSON.parse(readFileSync(out, 'utf8'));
    } catch {
      report = { error: `no result (exit ${child.status}, signal ${child.signal}): ${(child.stderr ?? '').slice(-600)}` };
    }
    console.log(`${pair} run ${run} (${wallMs} ms wall): ${JSON.stringify({ loadMs: report.loadMs, rendererMemoryMb: report.rendererMemoryMb, result: report.result ?? report.error, remoteRequests: (report.requests ?? []).filter((request) => request.url || request.permission), console: (report.console ?? []).filter((line) => !/^(0|info|debug|verbose)/.test(line)) })}`);
  }
}
