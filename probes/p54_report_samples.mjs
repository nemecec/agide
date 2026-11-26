// README: P54, real test-report samples from tools on this host (checks-design, 2026-11-26).
// Builds tiny throwaway projects under /tmp/agide-checks-design/p54 with no network: vitest from the app's own
// dependencies (JUnit reporter), a plain `cargo test` (libtest text), `cargo nextest` (JUnit) and Gradle offline
// (JUnit XML of the Test task). Each project has a passing, a failing, a skipped test and a test whose name holds
// markup characters and a control character. Each report is read with the prototype reader of p_checks_lib.mjs and
// the result is compared with what the tool printed. Sanitized samples go to probes/out/p54_samples/.
// Usage: node probes/p54_report_samples.mjs [vitest|cargo|nextest|gradle]...
import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { APP, TMP, run, save, readJUnit, readLibtest, bufferChunks } from './p_checks_lib.mjs';

const ROOT = join(TMP, 'p54');
const only = process.argv.slice(2);
const want = (name) => only.length === 0 || only.includes(name);
const results = {};
rmSync(ROOT, { recursive: true, force: true });
mkdirSync(ROOT, { recursive: true });

const write = (dir, files) => {
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
};

async function parsed(path) {
  try {
    const report = await readJUnit(bufferChunks(readFileSync(path)));
    return { suites: report.suites.length, cases: report.cases.map((c) => ({ classname: c.classname, name: c.name, status: c.status, message: c.message.slice(0, 120) })) };
  } catch (error) {
    return { refused: error.message };
  }
}

if (want('vitest')) {
  const dir = join(ROOT, 'vitest');
  write(dir, {
    'package.json': '{ "name": "p54-vitest", "private": true, "type": "module" }\n',
    'src/math.test.js': [
      "describe('math', () => {",
      "  it('adds', () => { expect(1 + 1).toBe(2); });",
      "  it('subtracts wrongly', () => { expect(3 - 1).toBe(1); });",
      "  it.skip('is skipped', () => {});",
      "  it.todo('is todo');",
      "  it('name with <markup> & \"quotes\" \\u0007 bell', () => {});",
      '});',
      "it('top level', () => {});",
      '',
    ].join('\n'),
  });
  const vitest = join(APP, 'node_modules', 'vitest', 'vitest.mjs');
  const junit = join(dir, 'reports', 'junit.xml');
  const r = run(process.execPath, [vitest, 'run', '--root', dir, '--globals', '--reporter=default', '--reporter=junit', `--outputFile.junit=${junit}`], { cwd: dir, env: { ...process.env, CI: '1', NO_COLOR: '1' } });
  results.vitest = { status: r.status, ms: r.ms, report: existsSync(junit) ? await parsed(junit) : 'no report', tail: r.stdout.split('\n').slice(-12).join('\n') };
  if (existsSync(junit)) save('p54_samples/vitest-junit.xml', readFileSync(junit, 'utf8'));
  save('p54_samples/vitest-stdout.txt', r.stdout + r.stderr);
}

const CARGO_LIB = [
  'pub fn add(a: i32, b: i32) -> i32 { a + b }',
  '#[cfg(test)]',
  'mod tests {',
  '    use super::*;',
  '    #[test] fn adds() { assert_eq!(add(1, 1), 2); }',
  '    #[test] fn subtracts_wrongly() { println!("test tests::subtracts_wrongly ... ok"); assert_eq!(add(3, -1), 1, "three minus one"); }',
  '    #[test] #[ignore = "slow"] fn is_ignored() {}',
  '    #[test] #[should_panic(expected = "boom")] fn panics() { panic!("boom"); }',
  '    #[test] fn prints_markup() { println!("<testcase name=\\"forged\\"/>"); println!("test tests::forged ... ok"); }',
  '}',
  '',
].join('\n');

const cargoProject = (dir) => write(dir, {
  'Cargo.toml': '[package]\nname = "p54"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\n',
  'src/lib.rs': CARGO_LIB,
  'tests/integration.rs': '#[test] fn integration_ok() { assert!(true); }\n',
});

if (want('cargo')) {
  const dir = join(ROOT, 'cargo');
  cargoProject(dir);
  const env = { ...process.env, CARGO_TARGET_DIR: join(dir, 'target'), CARGO_TERM_COLOR: 'never' };
  const r = run('cargo', ['test', '--offline', '--no-fail-fast'], { cwd: dir, env });
  const text = r.stdout + r.stderr;
  results.cargo = { status: r.status, ms: r.ms, parsed: readLibtest(text) };
  // A failing test's captured stdout is printed after the list, so forged lines appear in the `---- stdout ----` blocks only for failing tests; the passing prints_markup test's output is captured and hidden.
  const nocapture = run('cargo', ['test', '--offline', '--no-fail-fast', '--', '--nocapture'], { cwd: dir, env });
  results.cargoNocapture = { status: nocapture.status, parsed: readLibtest(nocapture.stdout + nocapture.stderr) };
  save('p54_samples/cargo-test.txt', text);
  save('p54_samples/cargo-test-nocapture.txt', nocapture.stdout + nocapture.stderr);
}

if (want('nextest')) {
  const dir = join(ROOT, 'nextest');
  cargoProject(dir);
  write(dir, { '.config/nextest.toml': '[profile.ci]\nfail-fast = false\n\n[profile.ci.junit]\npath = "junit.xml"\n' });
  const env = { ...process.env, CARGO_TARGET_DIR: join(dir, 'target'), CARGO_TERM_COLOR: 'never' };
  const r = run('cargo', ['nextest', 'run', '--offline', '--profile', 'ci', '--run-ignored', 'default'], { cwd: dir, env });
  const junit = join(dir, 'target', 'nextest', 'ci', 'junit.xml');
  results.nextest = { status: r.status, ms: r.ms, report: existsSync(junit) ? await parsed(junit) : 'no report', tail: (r.stdout + r.stderr).split('\n').slice(-8).join('\n') };
  if (existsSync(junit)) save('p54_samples/nextest-junit.xml', readFileSync(junit, 'utf8'));
  save('p54_samples/nextest-output.txt', r.stdout + r.stderr);
}

if (want('gradle')) {
  const dir = join(ROOT, 'gradle');
  write(dir, {
    'settings.gradle.kts': 'rootProject.name = "p54"\n',
    'build.gradle.kts': [
      'plugins { java }',
      'repositories { mavenCentral() }',
      'dependencies {',
      '  testImplementation("org.junit.jupiter:junit-jupiter:6.1.3")',
      '  testRuntimeOnly("org.junit.platform:junit-platform-launcher:6.1.3")',
      '}',
      'tasks.test { useJUnitPlatform(); ignoreFailures = false }',
      '',
    ].join('\n'),
    'src/test/java/p54/MathTest.java': [
      'package p54;',
      'import org.junit.jupiter.api.*;',
      'import static org.junit.jupiter.api.Assertions.*;',
      'class MathTest {',
      '  @Test void adds() { assertEquals(2, 1 + 1); }',
      '  @Test void subtractsWrongly() { assertEquals(1, 3 - 1, "three minus one"); }',
      '  @Test @Disabled("slow") void isDisabled() {}',
      '  @Test @DisplayName("name with <markup> & \\"quotes\\" \\u0007 bell") void displayName() {}',
      '  @Test void errors() { throw new IllegalStateException("not an assertion"); }',
      '}',
      '',
    ].join('\n'),
  });
  const r = run('gradle', ['test', '--offline', '--no-daemon', '--console=plain', '-q'], { cwd: dir, timeout: 600_000 });
  const reportDir = join(dir, 'build', 'test-results', 'test');
  const files = existsSync(reportDir) ? readdirSync(reportDir).filter((name) => name.endsWith('.xml')) : [];
  results.gradle = { status: r.status, ms: r.ms, files, reports: await Promise.all(files.map((name) => parsed(join(reportDir, name)))), tail: (r.stdout + r.stderr).split('\n').slice(-15).join('\n') };
  for (const name of files) save(`p54_samples/gradle-${name}`, readFileSync(join(reportDir, name), 'utf8'));
  save('p54_samples/gradle-output.txt', r.stdout + r.stderr);
}

save('p54_results.json', JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
