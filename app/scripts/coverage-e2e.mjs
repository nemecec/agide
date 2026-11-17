// Runs the Playwright end-to-end tests against a build with source maps and prints the coverage they reach:
// the renderer through `page.coverage`, the main process through NODE_V8_COVERAGE. Not a CI gate.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import MCR from 'monocart-coverage-reports';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(appDir, 'coverage-e2e');
const AREAS = ['src/core', 'src/main', 'src/preload', 'src/shared', 'src/renderer'];

function run(command, args, env = {}) {
  const result = spawnSync(command, args, { cwd: appDir, stdio: 'inherit', env: { ...process.env, ...env } });
  return result.status ?? 1;
}

// `--reuse` rebuilds the report from the raw data of the last run.
const reuse = process.argv.includes('--reuse');
let testStatus = 0;
if (!reuse) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  if (run('pnpm', ['exec', 'electron-vite', 'build', '--sourcemap']) !== 0) process.exit(1);
  testStatus = run('pnpm', ['exec', 'playwright', 'test'], { AGIDE_E2E_COVERAGE_DIR: dir });
}

const jsonFiles = (sub) => (existsSync(join(dir, sub)) ? readdirSync(join(dir, sub)).filter((f) => f.endsWith('.json')).map((f) => join(dir, sub, f)) : []);

async function report(name, entries, sourceFilter) {
  const mcr = MCR({
    name,
    outputDir: join(dir, 'report', name),
    baseDir: appDir,
    reports: ['json-summary', 'lcovonly'],
    logging: 'error',
    sourceFilter,
  });
  await mcr.add(entries);
  return mcr.generate();
}

const rendererEntries = jsonFiles('renderer').flatMap((file) => JSON.parse(readFileSync(file, 'utf8')));
// Node's coverage entries carry no source text; the built bundle is read from disk so its source map can resolve.
const builtFile = (url) => (url.startsWith('file://') && url.includes('/out/') ? fileURLToPath(url) : undefined);
const mainEntries = jsonFiles('main')
  .flatMap((file) => JSON.parse(readFileSync(file, 'utf8')).result ?? [])
  .filter((entry) => builtFile(entry.url) !== undefined)
  .map((entry) => ({ ...entry, source: readFileSync(builtFile(entry.url), 'utf8') }));
const inApp = (path) => path.startsWith('src/') || path.includes('/src/');

const results = {
  renderer: rendererEntries.length > 0 ? await report('renderer', rendererEntries, inApp) : undefined,
  main: mainEntries.length > 0 ? await report('main', mainEntries, inApp) : undefined,
};

const pct = (part) => (part && part.total > 0 ? `${part.pct.toFixed(1)}%` : '-');
const rows = [];
for (const [process, result] of Object.entries(results)) {
  if (!result) continue;
  const files = (result.files ?? []).map((file) => ({ path: relative(appDir, join(appDir, file.sourcePath)), summary: file.summary }));
  for (const area of AREAS) {
    const own = files.filter((file) => file.path.startsWith(`${area}/`));
    if (own.length === 0) continue;
    const sum = (key) => own.reduce((acc, file) => ({ covered: acc.covered + (file.summary[key]?.covered ?? 0), total: acc.total + (file.summary[key]?.total ?? 0) }), { covered: 0, total: 0 });
    const part = (key) => {
      const s = sum(key);
      return { ...s, pct: s.total === 0 ? 100 : (s.covered / s.total) * 100 };
    };
    rows.push({ process, area, files: own.length, functions: pct(part('functions')), branches: pct(part('branches')), lines: pct(part('lines')) });
  }
}
console.log('\nEnd-to-end coverage (V8, mapped to source)');
console.table(rows);
if (!rendererEntries.length) console.log('No renderer coverage was collected.');
if (!mainEntries.length) console.log('No main-process coverage was collected.');
console.log(`Reports: ${relative(appDir, join(dir, 'report'))}/`);
process.exit(testStatus);
