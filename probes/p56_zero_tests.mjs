// README: P56, what test tools do when they find no tests (checks-design, 2026-11-26).
// For vitest (the app's own), cargo test, cargo nextest and Gradle offline: the exit status and whether a report is
// written when the project has no tests, when a filter matches nothing, and when every test is skipped. Throwaway
// projects under /tmp/agide-checks-design/p56; results in probes/out/p56_results.json.
// Usage: node probes/p56_zero_tests.mjs [vitest|cargo|nextest|gradle]...
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP, TMP, run, save, readJUnit, readLibtest, bufferChunks } from './p_checks_lib.mjs';

const ROOT = join(TMP, 'p56');
const only = process.argv.slice(2);
const want = (name) => only.length === 0 || only.includes(name);
const results = {};
mkdirSync(ROOT, { recursive: true });

const write = (dir, files) => {
  rmSync(dir, { recursive: true, force: true });
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
};
const lastLines = (text, count = 4) => text.split('\n').map((line) => line.trim()).filter(Boolean).slice(-count).join(' | ').slice(0, 400);
const count = async (path) => {
  if (!existsSync(path)) return 'no report';
  try {
    const report = await readJUnit(bufferChunks(readFileSync(path)));
    return `${report.cases.length} cases (${report.cases.filter((c) => c.status === 'passed').length} passed)`;
  } catch (error) {
    return `refused: ${error.message}`;
  }
};

if (want('vitest')) {
  const vitest = join(APP, 'node_modules', 'vitest', 'vitest.mjs');
  const cases = {
    no_test_files: { 'src/index.js': 'export const x = 1;\n' },
    filter_matches_nothing: { 'src/a.test.js': "it('adds', () => { expect(1 + 1).toBe(2); });\n" },
    every_test_skipped: { 'src/a.test.js': "it.skip('adds', () => {});\n" },
    empty_test_file: { 'src/a.test.js': '// no tests\n' },
  };
  for (const [name, files] of Object.entries(cases)) {
    const dir = join(ROOT, 'vitest', name);
    write(dir, { 'package.json': '{ "name": "p56", "private": true, "type": "module" }\n', ...files });
    const junit = join(dir, 'junit.xml');
    const extra = name === 'filter_matches_nothing' ? ['-t', 'nothing matches this'] : [];
    const r = run(process.execPath, [vitest, 'run', '--root', dir, '--globals', '--reporter=default', '--reporter=junit', `--outputFile.junit=${junit}`, ...extra], { cwd: dir, env: { ...process.env, CI: '1', NO_COLOR: '1' } });
    results[`vitest.${name}`] = { status: r.status, report: await count(junit), output: lastLines(r.stdout + r.stderr) };
  }
}

const cargoFiles = (lib) => ({ 'Cargo.toml': '[package]\nname = "p56"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\n', 'src/lib.rs': lib });
const WITH_TEST = 'pub fn one() -> i32 { 1 }\n#[cfg(test)] mod tests { #[test] fn adds() { assert_eq!(super::one(), 1); } }\n';
const ALL_IGNORED = 'pub fn one() -> i32 { 1 }\n#[cfg(test)] mod tests { #[test] #[ignore] fn adds() {} }\n';
const NO_TEST = 'pub fn one() -> i32 { 1 }\n';

if (want('cargo') || want('nextest')) {
  const cases = { no_tests: [NO_TEST, []], filter_matches_nothing: [WITH_TEST, ['nothing_matches_this']], every_test_ignored: [ALL_IGNORED, []] };
  for (const [name, [lib, filter]] of Object.entries(cases)) {
    const dir = join(ROOT, 'cargo', name);
    write(dir, { ...cargoFiles(lib), '.config/nextest.toml': '[profile.ci.junit]\npath = "junit.xml"\n' });
    const env = { ...process.env, CARGO_TARGET_DIR: join(ROOT, 'cargo-target'), CARGO_TERM_COLOR: 'never' };
    if (want('cargo')) {
      const r = run('cargo', ['test', '--offline', ...filter], { cwd: dir, env });
      const parsed = readLibtest(r.stdout + r.stderr);
      results[`cargo.${name}`] = { status: r.status, runs: parsed.runs, results: parsed.results.map((x) => `${x.passed}p ${x.failed}f ${x.ignored}i ${x.filteredOut}filtered`), output: lastLines(r.stdout, 2) };
    }
    if (want('nextest')) {
      rmSync(join(ROOT, 'cargo-target', 'nextest'), { recursive: true, force: true });
      const r = run('cargo', ['nextest', 'run', '--offline', '--profile', 'ci', ...(filter.length ? ['-E', `test(${filter[0]})`] : [])], { cwd: dir, env });
      results[`nextest.${name}`] = { status: r.status, report: await count(join(ROOT, 'cargo-target', 'nextest', 'ci', 'junit.xml')), output: lastLines(r.stdout + r.stderr, 3) };
    }
  }
}

if (want('gradle')) {
  const build = 'plugins { java }\nrepositories { mavenCentral() }\ndependencies {\n  testImplementation("org.junit.jupiter:junit-jupiter:6.1.3")\n  testRuntimeOnly("org.junit.platform:junit-platform-launcher:6.1.3")\n}\ntasks.test { useJUnitPlatform() }\n';
  const cases = {
    no_test_sources: [{ 'src/main/java/p56/One.java': 'package p56; public class One { public int one() { return 1; } }\n' }, []],
    test_class_without_tests: [{ 'src/test/java/p56/OneTest.java': 'package p56; class OneTest { void helper() {} }\n' }, []],
    filter_matches_nothing: [{ 'src/test/java/p56/OneTest.java': 'package p56; import org.junit.jupiter.api.Test; class OneTest { @Test void adds() {} }\n' }, ['--tests', 'NothingMatches']],
    every_test_disabled: [{ 'src/test/java/p56/OneTest.java': 'package p56; import org.junit.jupiter.api.*; class OneTest { @Test @Disabled void adds() {} }\n' }, []],
  };
  for (const [name, [files, args]] of Object.entries(cases)) {
    const dir = join(ROOT, 'gradle', name);
    write(dir, { 'settings.gradle.kts': 'rootProject.name = "p56"\n', 'build.gradle.kts': build, ...files });
    const r = run('gradle', ['test', '--offline', '--no-daemon', '--console=plain', ...args], { cwd: dir, timeout: 600_000 });
    const reportDir = join(dir, 'build', 'test-results', 'test');
    const reports = existsSync(reportDir) ? readdirSync(reportDir).filter((file) => file.endsWith('.xml')) : [];
    results[`gradle.${name}`] = { status: r.status, reports: await Promise.all(reports.map((file) => count(join(reportDir, file)))), output: lastLines((r.stdout + r.stderr).replace(/BUILD (SUCCESSFUL|FAILED) in .*/g, 'BUILD $1').replace(/Actionable tasks.*/g, ''), 6) };
  }
}

save('p56_results.json', JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
