import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { POLICY_PATH } from '../policy/schema';
import { REASON_CATALOGUE, type ReasonId } from '../reasonCatalogue';
import { computeRung, rungIndex } from '../rungs';
import type { Rung, StoredReason } from '../schemas';
import { assess, ids, otherChangeset, reasonOf, type FileSpec, type InputOptions } from './ruleFixtures';

/** Every reason of the catalogue that the rules own: a diff that triggers it and one that does not (0040 sections 7 and 19). */

/**
 * Placeholder secrets of the secret detector's tests. They are put together from parts or made at run time from the hash
 * of a label, so that the source holds no secret-shaped literal for secret scanners and their generic detectors to flag.
 */
const derived = (label: string, length: number): string => createHash('sha256').update(label).digest('base64url').slice(0, length);
const base64url = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url');
const AWS_KEY_ID = ['AKIA', 'ABCDEFGHIJKLMNOP'].join('');
const AWS_TEMP_KEY_ID = ['ASIA', 'ABCDEFGHIJKLMNOP'].join('');
const SLACK_TOKEN = ['xoxb', '1234567890', 'abcdefghij'].join('-');
const JWT = [base64url({ alg: 'HS256' }), base64url({ sub: '1234567890' }), derived('jwt signature', 43)].join('.');
const RANDOM_LITERAL = derived('long random literal', 24);
const PASSWORD_VALUE = `${derived('password literal', 20)}#$x`;

type Row = readonly [name: string, options: InputOptions, expected: boolean];

function table(id: ReasonId, rows: readonly Row[]): void {
  describe(id, () => {
    it.each(rows)('%s', (_name, options, expected) => {
      expect(ids(assess(options)).includes(id), `${id} is ${expected ? 'raised' : 'not raised'}`).toBe(expected);
    });
  });
}

const touch = (...paths: string[]): InputOptions => ({ files: paths.map((path) => ({ path, add: ['x'] })) });
const lines = (count: number, prefix = 'line'): string[] => Array.from({ length: count }, (_, i) => `${prefix} ${i}`);
const one = (spec: FileSpec, rest: InputOptions = {}): InputOptions => ({ files: [spec], ...rest });

describe('check reasons', () => {
  table('check.none', [
    ['no check command in the policy', { policy: { check: undefined } }, true],
    ['a check command exists', {}, false],
  ]);
  table('check.failed', [
    ['the check failed and the base passed', { check: { checkpoint: 'failed', base: 'passed' } }, true],
    ['the check failed and no base run exists', { check: { checkpoint: 'failed' } }, true],
    ['the check failed and the base did not run', { check: { checkpoint: 'failed', base: 'not_run' } }, true],
    ['the check failed on the base too', { check: { checkpoint: 'failed', base: 'failed' } }, false],
    ['the check passed', { check: { checkpoint: 'passed' } }, false],
    ['the check was not run yet', {}, false],
  ]);
  table('check.base_red', [
    ['failed on both', { check: { checkpoint: 'failed', base: 'failed' } }, true],
    ['not run on the checkpoint, failed on the base', { check: { checkpoint: 'not_run', base: 'failed' } }, true],
    ['failed only on the checkpoint', { check: { checkpoint: 'failed', base: 'passed' } }, false],
    ['passed on the checkpoint, failed on the base: the change made the base green', { check: { checkpoint: 'passed', base: 'failed' } }, false],
    ['timed out on the checkpoint, failed on the base', { check: { checkpoint: 'timed_out', base: 'failed' } }, false],
    ['failed on the checkpoint, the base did not run', { check: { checkpoint: 'failed', base: 'not_run' } }, false],
  ]);
  it('gives check.base_red the rung of check.failed, with a card text that says the base fails and the user decides', () => {
    const red = reasonOf(assess({ check: { checkpoint: 'failed', base: 'failed' } }), 'check.base_red')!;
    const own = reasonOf(assess({ check: { checkpoint: 'failed', base: 'passed' } }), 'check.failed')!;
    expect([red.minRung, red.source, red.hard], 'rung C from the check, not hard').toEqual(['C', 'check', false]);
    expect(red.minRung, 'the same rung as a failure the base does not share').toBe(own.minRung);
    expect(red.subject, 'the card says that the check fails on the base commit as well, why that matters and that the user decides').toMatch(/fails on the base commit as well.*cannot tell good changes from bad.*user decides/);
  });
  it('raises no check reason for a checkpoint that passes, whatever the base did', () => {
    for (const base of [undefined, 'passed', 'failed', 'timed_out', 'not_run'] as const) {
      const reasons = ids(assess({ check: { checkpoint: 'passed', ...(base === undefined ? {} : { base }) } }));
      expect(reasons.filter((id) => id.startsWith('check.')), `no check reason for base ${base}`).toEqual([]);
    }
  });
  it('keeps a changeset whose check did not pass at rung C or higher for every combination of outcomes, so no base run lowers the rung', () => {
    const outcomes = ['passed', 'failed', 'timed_out', 'not_run', 'running'] as const;
    for (const checkpoint of outcomes.filter((outcome) => outcome !== 'passed' && outcome !== 'running')) {
      for (const base of [undefined, ...outcomes]) {
        const reasons = assess({ check: { checkpoint, ...(base === undefined ? {} : { base }) } });
        expect(rungIndex(computeRungOf(reasons) as Rung), `rung of a checkpoint that ${checkpoint} with a base that ${base ?? 'is missing'}`).toBeGreaterThanOrEqual(rungIndex('C'));
      }
    }
  });
  table('check.timed_out', [
    ['timed out', { check: { checkpoint: 'timed_out' } }, true],
    ['passed', { check: { checkpoint: 'passed' } }, false],
  ]);
  table('check.not_run', [
    ['not run', { check: { checkpoint: 'not_run' } }, true],
    ['passed', { check: { checkpoint: 'passed' } }, false],
  ]);

  it('keeps the output tail of a failed check as untrusted text', () => {
    const reason = reasonOf(assess({ check: { checkpoint: 'failed' } }), 'check.failed')!;
    expect(reason.evidence['outputTail'], 'the tail is marked as untrusted').toMatchObject({ untrusted: true, text: 'FAIL x' });
    expect([reason.minRung, reason.source], 'rung C from the check').toEqual(['C', 'check']);
  });

  it('adds retry.limit when the send-backs are used up and the check still fails', () => {
    expect(ids(assess({ check: { checkpoint: 'failed' }, attempt: 2 })), 'attempt 2 of limit 2').toContain('retry.limit');
    expect(ids(assess({ check: { checkpoint: 'failed' }, attempt: 1 })), 'one send-back is left').not.toContain('retry.limit');
    expect(ids(assess({ check: { checkpoint: 'passed' }, attempt: 2 })), 'a passing check needs no send-back').not.toContain('retry.limit');
    expect(ids(assess({ check: { checkpoint: 'failed', base: 'failed' }, attempt: 2 })), 'a failure the base shares is not sent back').not.toContain('retry.limit');
  });
});

describe('size reasons', () => {
  const big = (count: number, name = 'src/a.ts'): InputOptions => ({ files: [{ path: name, add: lines(count) }] });
  table('size.medium', [
    ['exactly the small threshold in lines', big(150), false],
    ['one line over the small threshold', big(151), true],
    ['over the large threshold becomes size.large only', big(601), false],
    ['more files than the small threshold', { files: Array.from({ length: 9 }, (_, i) => ({ path: `src/f${i}.ts`, add: ['x'] })) }, true],
  ]);
  table('size.large', [
    ['at the large threshold', big(600), false],
    ['over the large threshold', big(601), true],
    ['over the large file count', { files: Array.from({ length: 26 }, (_, i) => ({ path: `src/f${i}.ts`, add: ['x'] })) }, true],
  ]);

  it('counts generated files at a tenth of their lines', () => {
    const generated = { files: [{ path: 'src/gen/api.ts', add: lines(1_500) }], policy: { paths: { generated: ['src/gen/**'] } } };
    expect(ids(assess(generated)).filter((id) => id.startsWith('size.')), 'a generated file of 1,500 lines counts as 150').toEqual([]);
    expect(ids(assess({ files: generated.files })), 'the same file is large without the policy entry').toContain('size.large');
  });

  it('adds the merged changesets of the agent to size.run and ignores the superseded and the rejected', () => {
    const merged = (seed: string) => otherChangeset(seed, { added: 500, removed: 0, fileCount: 4, mergedCommit: 'a'.repeat(40), state: 'accepted' });
    const small = { files: [{ path: 'src/a.ts', add: lines(300) }] };
    expect(ids(assess({ ...small, runChangesets: [merged('m1'), merged('m2')] })), 'two merged parts of 500 and the new 300 pass the run threshold of 1,200').toContain('size.run');
    expect(ids(assess({ ...small, runChangesets: [merged('m1')] })), '800 lines are below the run threshold').not.toContain('size.run');
    const superseded = otherChangeset('s1', { added: 900, fileCount: 4, state: 'superseded' });
    const rejected = otherChangeset('r1', { added: 900, fileCount: 4, state: 'rejected' });
    expect(ids(assess({ ...small, runChangesets: [superseded, rejected, merged('m1')] })), 'a superseded changeset repeats the new work and a rejected one is gone').not.toContain('size.run');
  });

  it('adds the latest changesets of the other agents to size.swarm', () => {
    const others = [otherChangeset('o1', { agent: 'b', added: 900, fileCount: 10 }), otherChangeset('o2', { agent: 'c', added: 900, fileCount: 10 })];
    expect(ids(assess({ files: [{ path: 'src/a.ts', add: lines(300) }], swarmChangesets: others })), '2,100 lines pass the swarm threshold of 2,000').toContain('size.swarm');
    expect(ids(assess({ files: [{ path: 'src/a.ts', add: lines(300) }], swarmChangesets: others.slice(0, 1) })), '1,200 lines do not').not.toContain('size.swarm');
  });

  table('size.too_many_files', [
    ['2,001 files', { files: Array.from({ length: 2_001 }, (_, i) => ({ path: `f${i}.txt`, kind: 'large' as const })) }, true],
    ['2,000 files', { files: Array.from({ length: 2_000 }, (_, i) => ({ path: `f${i}.txt`, kind: 'large' as const })) }, false],
  ]);
  table('diffusion.dirs', [
    ['five top-level directories', touch('a/x.ts', 'b/x.ts', 'c/x.ts', 'd/x.ts', 'e/x.ts'), true],
    ['four top-level directories', touch('a/x.ts', 'b/x.ts', 'c/x.ts', 'd/x.ts'), false],
    ['root files count as one place', touch('a/x.ts', 'b/x.ts', 'c/x.ts', 'd/x.ts', 'README.md', 'LICENSE'), true],
    ['many files in one directory', touch('a/x.ts', 'a/y.ts', 'a/b/z.ts'), false],
  ]);
});

describe('file reasons', () => {
  table('file.large_unreviewed', [
    ['a large file', one({ path: 'data.csv', kind: 'large', added: 9_000 }), true],
    ['a text file', one({ path: 'a.txt', add: ['x'] }), false],
  ]);
  it('puts a large file at rung D, because no hunk is stored and the secret detectors cannot read it', () => {
    const reasons = assess(one({ path: 'data.csv', kind: 'large', added: 9_000 }));
    expect(reasonOf(reasons, 'file.large_unreviewed')?.minRung, 'a person looks at it at D').toBe('D');
    expect(computeRungOf(reasons), 'the changeset is at D').toBe('D');
  });
  table('file.binary', [
    ['a binary file', one({ path: 'logo.png', kind: 'binary' }), true],
    ['a text file', one({ path: 'a.txt', add: ['x'] }), false],
  ]);
  table('file.exec_bit', [
    ['an added executable bit', one({ path: 'run.sh', oldMode: '100644', newMode: '100755' }), true],
    ['a new executable file', one({ path: 'run.sh', status: 'A', newMode: '100755' }), true],
    ['an executable file edited and still executable', one({ path: 'run.sh', oldMode: '100755', newMode: '100755', add: ['x'] }), false],
    ['a removed executable bit', one({ path: 'run.sh', oldMode: '100755', newMode: '100644' }), false],
  ]);
  table('file.symlink', [
    ['a new symlink', one({ path: 'link', status: 'A', kind: 'symlink', newMode: '120000', add: ['../../etc/passwd'] }), true],
    ['a type change', one({ path: 'was-a-file', status: 'T', kind: 'symlink', newMode: '120000', oldMode: '100644', add: ['target'] }), true],
    ['a text file', one({ path: 'a.txt', add: ['x'] }), false],
  ]);
  table('file.submodule', [
    ['a submodule', one({ path: 'vendor/lib', kind: 'submodule', newMode: '160000' }), true],
    ['a text file', one({ path: 'a.txt', add: ['x'] }), false],
  ]);
  table('file.odd_name', [
    ['an odd name', one({ path: 'bad\nname.txt', oddName: true, add: ['x'] }), true],
    ['an ordinary name', one({ path: 'good name.txt', add: ['x'] }), false],
  ]);

  it('shows an odd name escaped in the subject and keeps the link target as untrusted text', () => {
    const odd = assess(one({ path: `bad\nname${String.fromCharCode(0x202e)}.txt`, oddName: true, add: ['x'] }));
    expect(reasonOf(odd, 'file.odd_name')!.subject, 'newline and bidirectional control written out').toBe('bad\\nname\\u202e.txt');
    const link = reasonOf(assess(one({ path: 'link', status: 'A', kind: 'symlink', newMode: '120000', add: ['/etc/passwd'] })), 'file.symlink')!;
    expect(link.evidence['target'], 'the target is agent text').toMatchObject({ untrusted: true, text: '/etc/passwd' });
  });
});

describe('path reasons', () => {
  table('path.sensitive', [
    ['a file under a sensitive glob', one({ path: 'src/auth/login.ts', add: ['x'] }, { policy: { paths: { sensitive: ['src/auth/**'] } } }), true],
    ['a file outside it', one({ path: 'src/ui/button.ts', add: ['x'] }, { policy: { paths: { sensitive: ['src/auth/**'] } } }), false],
    ['the old path of a rename', one({ path: 'src/ui/new.ts', oldPath: 'src/auth/old.ts', status: 'R' }, { policy: { paths: { sensitive: ['src/auth/**'] } } }), true],
  ]);
  table('path.migration', [
    ['a migration file', one({ path: 'db/migration/V2__a.sql', add: ['x'] }, { policy: { paths: { migrations: ['db/migration/**', '**/*.avsc'] } } }), true],
    ['a schema file at any depth', one({ path: 'schemas/deep/a.avsc', add: ['x'] }, { policy: { paths: { migrations: ['**/*.avsc'] } } }), true],
    ['another file', one({ path: 'db/readme.md', add: ['x'] }, { policy: { paths: { migrations: ['db/migration/**'] } } }), false],
  ]);
  table('path.protected', [
    ['a hook in .git', touch('.git/hooks/pre-commit'), true],
    ['a file in .husky', touch('.husky/pre-push'), true],
    ['an editor directory', touch('.vscode/tasks.json'), true],
    ['a shell profile', touch('.zshrc'), true],
    ['a nested .idea', touch('sub/.idea/workspace.xml'), true],
    ['a similar name', touch('src/git/hooks.ts', 'docs/vscode.md'), false],
  ]);
  table('path.outside_owns', [
    ['a file outside the owned paths', { ...touch('src/other/x.ts'), owns: ['src/mine/**'] }, true],
    ['a file inside', { ...touch('src/mine/x.ts'), owns: ['src/mine/**'] }, false],
    ['an agent that owns nothing may write anywhere', touch('src/other/x.ts'), false],
  ]);
  table('path.overlap', [
    ['a path another agent changed', { ...touch('src/shared.ts'), otherAgentsPaths: { b: ['src/shared.ts'] } }, true],
    ['a path nobody else changed', { ...touch('src/mine.ts'), otherAgentsPaths: { b: ['src/theirs.ts'] } }, false],
  ]);
  table('policy.changed', [
    ['the policy file', touch(POLICY_PATH), true],
    ['another file in .agide', touch('.agide/notes.md'), false],
  ]);
});

describe('configuration reasons', () => {
  table('config.agent', [
    ['CLAUDE.md at the root', touch('CLAUDE.md'), true],
    ['AGENTS.md in a subdirectory', touch('packages/a/AGENTS.md'), true],
    ['a case variant', touch('docs/claude.MD'), true],
    ['a Claude settings file', touch('.claude/settings.json'), true],
    ['a nested Claude directory', touch('app/.claude/skills/x.md'), true],
    ['the MCP configuration', touch('.mcp.json'), true],
    ['an agents directory', touch('.agents/a.md'), true],
    ['a readme', touch('README.md', 'docs/claude-notes.md'), false],
  ]);
  table('config.git', [
    ['.gitattributes', touch('.gitattributes'), true],
    ['a nested .gitattributes', touch('sub/.gitattributes'), true],
    ['.gitmodules', touch('.gitmodules'), true],
    ['a githooks directory', touch('.githooks/pre-commit'), true],
    ['a husky directory', touch('.husky/pre-commit'), true],
    ['.gitignore', touch('.gitignore'), false],
  ]);
  table('config.ci', [
    ['a workflow', touch('.github/workflows/ci.yml'), true],
    ['a composite action', touch('.github/actions/setup/action.yml'), true],
    ['a Jenkinsfile', touch('Jenkinsfile'), true],
    ['a CircleCI file', touch('.circleci/config.yml'), true],
    ['the code owners file', touch('.github/CODEOWNERS'), false],
  ]);
  table('config.test_lint', [
    ['a vitest configuration', touch('vitest.config.ts'), true],
    ['a tsconfig variant', touch('packages/a/tsconfig.build.json'), true],
    ['conftest.py', touch('tests/conftest.py'), true],
    ['a file named in the check command', one({ path: 'scripts/run-tests.sh', add: ['x'] }, { policy: { check: { command: ['./scripts/run-tests.sh'] } } }), true],
    ['a file named in the check setup', one({ path: 'scripts/setup.sh', add: ['x'] }, { policy: { check: { setup: ['scripts/setup.sh'], command: ['pnpm', 'test'] } } }), true],
    ['a glob of paths.testConfig', one({ path: 'quality/rules.yml', add: ['x'] }, { policy: { paths: { testConfig: ['quality/**'] } } }), true],
    ['a script in package.json with its block visible', one({ path: 'package.json', bodies: [' {\n   "scripts": {\n-    "test": "vitest run",\n+    "test": "echo ok",\n   }'] }), true],
    ['a script line in package.json without the block', one({ path: 'package.json', bodies: ['-    "test": "vitest run --coverage",\n+    "test": "exit 0"'] }), true],
    ['a one-word script value with the block out of the hunk', one({ path: 'package.json', bodies: ['     "lint": "eslint",\n     "typecheck": "tsc",\n     "build": "vite",\n-    "test": "jest",\n+    "test": "true",'] }), true],
    ['a dependency in package.json', one({ path: 'package.json', bodies: [' {\n   "dependencies": {\n+    "left-pad": "^1.3.0",\n   }'] }), false],
    ['a source file', touch('src/a.ts'), false],
  ]);
  table('deps.changed', [
    ['a lock file', touch('pnpm-lock.yaml'), true],
    ['a Gradle build file', touch('service/build.gradle.kts'), true],
    ['the version catalogue', touch('gradle/libs.versions.toml'), true],
    ['a requirements file', touch('requirements-dev.txt'), true],
    ['a dependency in package.json', one({ path: 'package.json', bodies: [' {\n   "devDependencies": {\n+    "vitest": "5.1.0",\n   }'] }), true],
    ['a dependency line in package.json without the block', one({ path: 'package.json', bodies: ['+    "left-pad": "^1.3.0",'] }), true],
    ['the name in package.json', one({ path: 'package.json', bodies: ['-  "name": "old",\n+  "name": "new",'] }), false],
    ['a source file', touch('src/a.ts'), false],
  ]);
  table('build.changed', [
    ['a Dockerfile', touch('Dockerfile.dev'), true],
    ['a Makefile', touch('sub/Makefile'), true],
    ['a file of paths.build', one({ path: 'tools/build.py', add: ['x'] }, { policy: { paths: { build: ['tools/**'] } } }), true],
    ['a source file', touch('src/a.ts'), false],
  ]);

  it('reports a script change of package.json as config.test_lint and not as deps.changed', () => {
    const reasons = assess(one({ path: 'package.json', bodies: [' {\n   "scripts": {\n-    "test": "vitest run",\n+    "test": "echo ok",\n   }'] }));
    expect([ids(reasons).includes('config.test_lint'), ids(reasons).includes('deps.changed')], 'script change only').toEqual([true, false]);
  });
});

describe('test reasons', () => {
  const testBody = (lines: string[]): FileSpec => ({ path: 'src/a.test.ts', bodies: [lines.join('\n')] });
  table('tests.deleted', [
    ['a deleted test file', one({ path: 'src/a.test.ts', status: 'D', removed: 5 }), true],
    ['a test file renamed out of the test paths', one({ path: 'src/a.ts', oldPath: 'src/a.test.ts', status: 'R' }), true],
    ['a test file renamed within the test paths', one({ path: 'src/b.test.ts', oldPath: 'src/a.test.ts', status: 'R' }), false],
    ['a deleted source file', one({ path: 'src/a.ts', status: 'D', removed: 5 }), false],
    ['a deleted file of a policy test glob', one({ path: 'qa/case1.txt', status: 'D' }, { policy: { paths: { tests: ['qa/**'] } } }), true],
  ]);
  table('tests.skipped', [
    ['a skipped test', one(testBody(['+  it.skip("x", () => {})'])), true],
    ['a focused test', one(testBody(['+  describe.only("x", () => {})'])), true],
    ['a disabled JUnit test', one({ path: 'src/test/kotlin/AThing.kt', add: ['@Disabled'] }), true],
    ['a skipped pytest', one({ path: 'tests/test_a.py', add: ['@pytest.mark.skip(reason="x")'] }), true],
    ['an ignored Rust test', one({ path: 'tests/a.rs', add: ['#[ignore]'] }), true],
    ['a Go skip', one({ path: 'a_test.go', add: ['\tt.Skip("later")'] }), true],
    ['a marker in a source file', one({ path: 'src/a.ts', add: ['promise.skip("x")'] }), false],
    ['a marker on a context line', one(testBody([' it.skip("old", () => {})', '+  it("new", () => {})'])), false],
    ['a marker on a removed line', one(testBody(['-  it.skip("old", () => {})', '+  it("new", () => {})'])), false],
    ['a marker that moved', one(testBody(['-  it.skip("old", () => {})', '+  it.skip("old", () => {})'])), false],
  ]);
  table('tests.weakened', [
    ['assertions removed and none added', one(testBody(['-  expect(a).toBe(1)', '-  expect(b).toBe(2)', '+  run()'])), true],
    ['assertions replaced one for one', one(testBody(['-  expect(a).toBe(1)', '+  expect(a).toBe(2)'])), false],
    ['assertions added', one(testBody(['+  expect(a).toBe(1)'])), false],
    ['assertions removed from a source file', one({ path: 'src/a.ts', bodies: ['-  assert(a)'] }), false],
    ['a Kotlin verify removed', one({ path: 'src/test/kotlin/AThing.kt', bodies: ['-  verify(mock).call()\n+  call()'] }), true],
  ]);
  table('tests.missing', [
    ['a source file changed and no test did', touch('src/a.ts'), true],
    ['a source file and its test changed', touch('src/a.ts', 'src/a.test.ts'), false],
    ['only documentation changed', touch('README.md'), false],
    ['only a source file was deleted', one({ path: 'src/a.ts', status: 'D', removed: 3 }), false],
    ['only a test changed', touch('src/a.test.ts'), false],
  ]);
});

describe('secret.added', () => {
  const secrets: [name: string, line: string][] = [
    ['an RSA private key header', '-----BEGIN RSA PRIVATE KEY-----'],
    ['an OpenSSH private key header', '-----BEGIN OPENSSH PRIVATE KEY-----'],
    ['an AWS access key id', `const id = "${AWS_KEY_ID}";`],
    ['an AWS temporary access key id', `const id = "${AWS_TEMP_KEY_ID}";`],
    ['a GitHub token', `token: ghp_${'a1B2c3D4e5'.repeat(4)}`],
    ['a fine-grained GitHub token', `x = github_pat_${'A1b2C3d4E5f6G7h8I9j0K1'}_rest`],
    ['a Slack token', `SLACK=${SLACK_TOKEN}`],
    ['an Anthropic key', `key = "sk-ant-${'api03-Abcdefghijklmnopqrstuv'}"`],
    ['an OpenAI key', `OPENAI=sk-proj-${'Abcdefghijklmnopqrstuvwxyz012345'}`],
    ['a JWT', `auth: ${JWT}`],
    ['a long random literal assigned to a secret name', `const apiSecret = "${RANDOM_LITERAL}";`],
    ['a password literal', `password: '${PASSWORD_VALUE}'`],
  ];
  it.each(secrets)('flags %s on an added line', (_name, line) => {
    const reasons = assess(one({ path: 'src/config.ts', add: ['ok', line] }));
    const found = reasonOf(reasons, 'secret.added');
    expect(found, 'the secret is flagged').toBeDefined();
    expect([found!.minRung, found!.hard, found!.evidence['line']], 'rung E, hard, on line 2').toEqual(['E', true, 2]);
  });

  it.each([
    ['a removed line', one({ path: 'a.ts', bodies: [`-const id = "${AWS_KEY_ID}";\n+const id = process.env.ID;`] })],
    ['a context line', one({ path: 'a.ts', bodies: [` const id = "${AWS_KEY_ID}";\n+const x = 1;`] })],
    ['a low-entropy placeholder', one({ path: 'a.ts', add: ['const apiSecret = "aaaaaaaaaaaaaaaaaaaaaaaa";'] })],
    ['a short value', one({ path: 'a.ts', add: ['token = "abc123"'] })],
    ['an environment reference', one({ path: 'a.ts', add: ['const token = process.env.API_TOKEN;'] })],
    ['a name without a secret word', one({ path: 'a.ts', add: [`const colour = "${RANDOM_LITERAL}";`] })],
    ['a large file that was not read', one({ path: 'a.ts', kind: 'large', bodies: [] })],
  ])('does not flag %s', (_name, options) => {
    expect(ids(assess(options)), 'no secret reason').not.toContain('secret.added');
  });

  it('reads the added lines of a symbolic link', () => {
    const reasons = assess(one({ path: 'src/link', kind: 'symlink', add: [`const id = "${AWS_KEY_ID}";`] }));
    expect(ids(reasons), 'the link text is searched').toContain('secret.added');
  });

  it('never puts the matched text into the reasons', () => {
    const secret = 'ghp_' + 'Zx9Qw8Er7Ty6Ui5Op4As3Df2Gh1Jk0LmNbVc';
    const serialized = JSON.stringify(assess(one({ path: 'src/config.ts', add: [`const t = "${secret}";`] })));
    expect(serialized.includes(secret), 'the token text is not in any reason').toBe(false);
    expect(serialized.includes('Zx9Qw8Er'), 'no part of the token is in any reason').toBe(false);
    expect(serialized.includes('github-token'), 'the detector id is').toBe(true);
  });
});

describe('telemetry and claim reasons', () => {
  table('run.incomplete', [
    ['a failed run', { telemetry: { endState: 'failed' as const } }, true],
    ['a stopped run', { telemetry: { endState: 'stopped' as const } }, true],
    ['a finished run', { telemetry: { endState: 'done' as const } }, false],
    ['a run that is still going', { telemetry: { endState: 'running' as const } }, false],
  ]);
  table('run.background_stopped', [
    ['a stopped task', { telemetry: { backgroundStopped: 1 } }, true],
    ['no stopped task', { telemetry: { backgroundStopped: 0 } }, false],
  ]);
  table('run.retries', [
    ['a retry', { telemetry: { retries: 1 } }, true],
    ['no retry', { telemetry: { retries: 0 } }, false],
  ]);
  table('run.denials', [
    ['a denial', { telemetry: { denials: 1, deniedTools: ['Bash'] } }, true],
    ['no denial', { telemetry: { denials: 0 } }, false],
  ]);
  table('run.tool_errors', [
    ['at the threshold', { telemetry: { toolErrors: 10 } }, true],
    ['below it', { telemetry: { toolErrors: 9 } }, false],
  ]);
  table('claim.missing', [
    ['no claim', { claim: null }, true],
    ['an empty result text', { claim: { source: 'result' as const, text: '  ' } }, true],
    ['a result text', { claim: { source: 'result' as const, text: 'did it' } }, false],
  ]);
  const outcome = (patch: Record<string, unknown>) => ({ claim: { source: 'report_outcome' as const, summary: 's', confidence: 'high' as const, testsRun: [], unverified: [], ...patch } });
  table('claim.unverified', [
    ['an item the agent could not verify', outcome({ unverified: ['the migration'] }), true],
    ['no item', outcome({}), false],
  ]);
  table('claim.low_confidence', [
    ['low confidence', outcome({ confidence: 'low' }), true],
    ['high confidence', outcome({}), false],
  ]);

  it('takes the denial rung from the threshold and keeps agent text in evidence as untrusted', () => {
    expect(reasonOf(assess({ telemetry: { denials: 4 } }), 'run.denials')!.minRung, 'below the threshold of five').toBe('B');
    expect(reasonOf(assess({ telemetry: { denials: 5 } }), 'run.denials')!.minRung, 'at the threshold').toBe('C');
    const item = reasonOf(assess(outcome({ unverified: ['the migration'] })), 'claim.unverified')!;
    expect(JSON.stringify(item.evidence), 'the listed item is marked untrusted').toContain('"untrusted":true');
  });

  it('does not use a claim of passing tests as an input: a failing check still gives check.failed', () => {
    const reasons = assess({ ...outcome({ testsRun: ['pnpm test'] }), check: { checkpoint: 'failed' } });
    expect(ids(reasons), 'the claim does not hide the failure').toContain('check.failed');
  });
});

describe('policy.invalid', () => {
  it('is raised for a policy that did not validate and not for one that did', () => {
    expect(ids(assess({ policySource: 'invalid', policyErrors: ['a: bad'] })), 'invalid policy').toContain('policy.invalid');
    expect(ids(assess({ policySource: 'base' })), 'valid policy').not.toContain('policy.invalid');
  });
});

describe('policy rungs', () => {
  const touchDeps = touch('pnpm-lock.yaml');
  it('raises or lowers a reason that is not hard', () => {
    expect(reasonOf(assess({ ...touchDeps, policy: { rungs: { 'deps.changed': 'D' } } }), 'deps.changed')!.minRung, 'raised to D').toBe('D');
    expect(reasonOf(assess({ ...touchDeps, policy: { rungs: { 'deps.changed': 'A' } } }), 'deps.changed')!.minRung, 'lowered to A').toBe('A');
  });

  it('only raises a hard reason and never lowers it below its default', () => {
    const hard = touch('CLAUDE.md');
    expect(reasonOf(assess({ ...hard, policy: { rungs: { 'config.agent': 'A' } } }), 'config.agent')!.minRung, 'a hard reason stays at E').toBe('E');
    const migration = (rung: 'A' | 'E') => reasonOf(assess({ files: [{ path: 'db/m.sql', add: ['x'] }], policy: { paths: { migrations: ['db/**'] }, rungs: { 'path.migration': rung } } }), 'path.migration')!;
    expect([migration('A').minRung, migration('E').minRung], 'D by default, raised to E, never below D').toEqual(['D', 'E']);
    expect(migration('A').hard, 'still hard').toBe(true);
  });

  it('ignores an id the catalogue does not know', () => {
    expect(() => assess({ ...touchDeps, policy: { rungs: { 'made.up': 'E' } } }), 'unknown ids do no harm').not.toThrow();
  });
});

describe('accumulation', () => {
  const three = (policy: InputOptions['policy'] = {}): InputOptions => ({
    files: [{ path: 'a.png', kind: 'binary' }, { path: 'b.png', kind: 'binary' }, { path: 'c.png', kind: 'binary' }],
    policy: { check: undefined, ...policy },
    claim: { source: 'result', text: 'x' },
  });
  const rungOf = (options: InputOptions): string => computeRungOf(assess(options));

  it('raises the unit one rung when the threshold of reasons sits at the highest rung', () => {
    const reasons = assess(three());
    expect(ids(reasons).filter((id) => id === 'file.binary' || id === 'check.none'), 'four reasons at B').toHaveLength(4);
    const accumulate = reasonOf(reasons, 'accumulate')!;
    expect([accumulate.minRung, accumulate.source], 'one rung above B').toEqual(['C', 'rule']);
    expect(accumulate.evidence, 'the counted ids and rung').toMatchObject({ atRung: 'B', reasonIds: ['check.none', 'file.binary'] });
    expect(rungOf(three()), 'the unit is at C').toBe('C');
  });

  it('does not accumulate below the threshold, below the top rung or at E', () => {
    const two = { files: [{ path: 'a.png', kind: 'binary' as const }], policy: { check: undefined } };
    expect(ids(assess(two)), 'two reasons at B are below three').not.toContain('accumulate');
    const mixed = { files: [{ path: 'a.png', kind: 'binary' as const }, { path: 'b.png', kind: 'binary' as const }, { path: 'src/auth/x.ts', add: ['x'] }], policy: { check: undefined, paths: { sensitive: ['src/auth/**'] } } };
    expect(ids(assess(mixed)), 'three reasons but only one at the top rung D').not.toContain('accumulate');
    const atE = { files: ['CLAUDE.md', '.gitattributes', '.husky/x'].map((path) => ({ path, add: ['x'] })), policy: { check: undefined } };
    expect(ids(assess(atE)), 'nothing sits above E').not.toContain('accumulate');
  });

  it('accumulates at exactly the threshold and not one reason below it', () => {
    const binaries = (count: number): InputOptions => ({ files: Array.from({ length: count }, (_, i) => ({ path: `${i}.png`, kind: 'binary' as const })), claim: { source: 'result', text: 'x' } });
    expect(ids(assess(binaries(3))), 'a check is configured, so three binary files are exactly three reasons at B').toContain('accumulate');
    expect(ids(assess(binaries(2))), 'two reasons are one fewer than the threshold').not.toContain('accumulate');
  });

  it('follows the accumulate threshold of the policy and adds the reason once', () => {
    expect(ids(assess(three({ thresholds: { accumulate: 5 } }))), 'five are needed').not.toContain('accumulate');
    expect(ids(assess(three({ thresholds: { accumulate: 2 } }))).filter((id) => id === 'accumulate'), 'once per assessment').toHaveLength(1);
  });

  it('is not counted again by a second assessment of the same facts', () => {
    expect(ids(assess(three())).filter((id) => id === 'accumulate'), 'one accumulate reason').toHaveLength(1);
  });
});

describe('hard floors', () => {
  const stored = (reasons: ReturnType<typeof assess>): StoredReason[] => reasons.map((reason) => ({ ...reason, changesetId: 'cs_aaaaaaaaaaaaaaaa', createdAt: '2026-11-21T10:00:00.000Z' }));

  it('sets the floor from the hard reasons of the rules', () => {
    const reasons = stored(assess({ files: [{ path: 'CLAUDE.md', add: ['x'] }, { path: 'src/a.ts', add: ['x'] }] }));
    expect(computeRung(reasons), 'config.agent is hard at E').toEqual({ rung: 'E', floor: 'E' });
    const soft = stored(assess({ files: [{ path: 'pnpm-lock.yaml', add: ['x'] }] }));
    expect(computeRung(soft).floor, 'a soft reason sets no floor').toBe('A');
  });

  it('keeps the hard reasons of the catalogue hard in what the rules produce', () => {
    const everything = assess({
      files: [{ path: '.git/hooks/x', add: ['x'] }, { path: 'CLAUDE.md', add: ['x'] }, { path: '.gitattributes', add: ['x'] }, { path: POLICY_PATH, add: ['x'] }, { path: 'db/m.sql', add: [AWS_KEY_ID] }],
      policy: { paths: { migrations: ['db/**'] } },
    });
    for (const reason of everything) expect(reason.hard, `${reason.id} is ${REASON_CATALOGUE[reason.id as ReasonId].hard ? 'hard' : 'soft'} in the catalogue`).toBe(REASON_CATALOGUE[reason.id as ReasonId].hard);
    for (const id of ['path.protected', 'config.agent', 'config.git', 'policy.changed', 'path.migration', 'secret.added']) expect(ids(everything), `${id} is raised`).toContain(id);
  });
});

function computeRungOf(reasons: ReturnType<typeof assess>): string {
  return computeRung(reasons.map((reason) => ({ ...reason, changesetId: 'cs_aaaaaaaaaaaaaaaa', createdAt: '2026-11-21T10:00:00.000Z' }))).rung;
}
