import { describe, expect, it } from 'vitest';
import { ENVIRONMENT_PATTERNS, environmentNotRunReason, findEnvironmentProblem, findUnconfirmedProblem } from './environmentErrors';

/** The pattern that decides alone, else the one the base run has to confirm. */
const find = (output: string, confined = true): string | undefined => (findEnvironmentProblem(output, { confined }) ?? findUnconfirmedProblem(output))?.id;

describe('environment problems in the output of a failed check', () => {
  it.each([
    ['error: rustup could not choose a version of cargo to run, because one wasn\'t specified explicitly', 'rustup.no_version'],
    ['bash: pnpm: command not found', 'command.not_found'],
    ['/usr/bin/env: node: No such file or directory', 'shell.no_such_file'],
    ['sh: 1: cargo: not found', 'shell.no_such_file'],
    ['Error: spawn cargo ENOENT', 'spawn.enoent'],
    ['exec: "go": executable file not found in $PATH', 'exec.not_found'],
    ['The operation couldn\'t be completed. Unable to locate a Java Runtime.', 'java.not_found'],
    ['ERROR: JAVA_HOME is not set and no \'java\' command could be found in your PATH.', 'java.not_found'],
    ['ERROR: JAVA_HOME is set to an invalid directory: /Library/Java/gone', 'java.not_found'],
    ['pyenv: version `3.11.4\' is not installed (set by /w/.python-version)', 'pyenv.version_missing'],
    ['N/A: version "v18.19.0 -> N/A" is not yet installed.', 'nvm.version_missing'],
    ['N/A: version v20 is not yet installed.', 'nvm.version_missing'],
    ['The JAVA_HOME environment variable is not defined correctly,', 'java.home_undefined'],
    ['Error: JAVA_HOME is not defined correctly. We cannot execute /x/bin/java', 'java.home_undefined'],
    ['Please set the JAVA_HOME variable in your environment to match the', 'java.home_undefined'],
    ['> Could not resolve org.slf4j:slf4j-api:2.0.17.', 'gradle.could_not_resolve'],
    ['> Could not resolve all files for configuration \':compileClasspath\'.', 'gradle.could_not_resolve'],
    ['> Could not resolve all dependencies for configuration \':runtimeClasspath\'.', 'gradle.could_not_resolve'],
    ['[ERROR] Failed to execute goal on project app: Could not resolve dependencies for project g:app:jar:1.0:', 'gradle.could_not_resolve'],
    ['Could not GET \'https://repo.example.invalid/x.pom\'', 'gradle.could_not_get'],
    ['warning: spurious network error (3 tries remaining): [56] Failure when receiving data from the peer (CONNECT tunnel failed, response 403)', 'proxy.connect_refused'],
    ['curl: (56) CONNECT tunnel failed, response 401', 'proxy.connect_refused'],
    ['Connection blocked by network allowlist', 'proxy.connect_refused'],
    ['HTTP/1.1 403 Forbidden\r\nX-Proxy-Error: blocked-by-allowlist', 'proxy.connect_refused'],
    ['proxy answered 403 for registry.example.invalid', 'proxy.denied_status'],
    ['403 from the proxy', 'proxy.denied_status'],
    ['curl: (7) Failed to connect: Connection refused', 'connection.refused'],
    ['Error: connect ECONNREFUSED 127.0.0.1:4873', 'connection.refused'],
    ['java.net.UnknownHostException: repo.maven.apache.org', 'java.unknown_host'],
    ['npm ERR! code ENOTFOUND', 'dns.not_found'],
    ['getaddrinfo EAI_AGAIN registry.npmjs.org', 'dns.not_found'],
    ['Temporary failure in name resolution', 'dns.not_found'],
    ['connect: Network is unreachable', 'network.unreachable'],
    ['npm ERR! 401 Unauthorized - GET https://registry.example.invalid/x', 'http.denied_status'],
    ['HTTP/1.1 403 whatever', 'http.denied_status'],
    ['error: status code 401', 'http.denied_status'],
    ['Received HTTP code 403 from proxy', 'http.denied_status'],
    ['401 Unauthorized', 'http.denied_status'],
    ['Unauthorized', 'http.unauthorized'],
    ['request failed: Forbidden', 'http.forbidden'],
    ['npm ERR! Error: EPERM: operation not permitted, mkdir', 'sandbox.eperm'],
    ['EROFS: read-only file system, open', 'sandbox.erofs'],
    ['cannot create /x: Operation not permitted', 'sandbox.not_permitted'],
    ['touch: /x: Read-only file system', 'sandbox.read_only'],
  ])('finds %j as %s', (output, id) => {
    expect(find(output), `the pattern that matches ${output}`).toBe(id);
  });

  it.each([
    'expected 3 but got 4',
    'AssertionError: expected true to be false',
    'FAILED tests/test_x.py::test_user - assert 403 == 404',
    'test result: FAILED. 2 passed; 1 failed; 0 ignored',
    'line 401: syntax error',
    'processed 4031 records',
    'error[E0308]: mismatched types',
    'FAIL src/user.test.ts > rejects an empty name',
    'X [ERROR] Could not resolve "./missing" [plugin vite:import-analysis]',
    'Could not resolve "./missing" from "src/index.js" (rollup)',
    'java.lang.IllegalArgumentException: Could not resolve placeholder \'server.port\' in value "${server.port}"',
    "> Could not get unknown property 'foo' for project ':app' of type org.gradle.api.Project.",
    'could not get the lock in time',
    'CONNECT was answered with 200',
    'the proxy setting is 4031',
  ])('leaves %j a failure of the code', (output) => {
    expect(find(output), 'no environment pattern matches').toBeUndefined();
  });

  it('matches without regard to case', () => {
    expect(find('COMMAND NOT FOUND'), 'upper case').toBe('command.not_found');
    expect(find('COULD NOT RESOLVE ALL FILES FOR CONFIGURATION :X'), 'upper case, a Gradle message').toBe('gradle.could_not_resolve');
  });

  it.each(['curl: (7) Failed to connect: Connection refused', 'connect ECONNREFUSED 127.0.0.1:1', 'java.net.UnknownHostException: x', 'ENOTFOUND', 'Network is unreachable', 'HTTP code 403', 'Unauthorized', 'Forbidden', 'a 403 from the proxy'])('leaves %j to the base run: it does not decide alone, and the base has to show it too', (output) => {
    expect(findEnvironmentProblem(output, { confined: true }), 'a test can print this word').toBeUndefined();
    expect(findUnconfirmedProblem(output)?.needsBase, 'but it is named for the base run to confirm').toBe(true);
  });

  it('decides at once for a missing toolchain, a Gradle resolution failure and a sandbox denial', () => {
    for (const output of ['sh: pnpm: command not found', 'Could not resolve org.x:y:1.0', 'CONNECT tunnel failed, response 403', 'EPERM', 'Operation not permitted']) {
      expect(findEnvironmentProblem(output, { confined: true }), `${output} ends the run`).toBeDefined();
      expect(findUnconfirmedProblem(output), `${output} needs no base`).toBeUndefined();
    }
  });

  it('counts the sandbox patterns only for a confined check, the others always', () => {
    expect(find('EPERM', false), 'a plain process that prints EPERM is a test failure').toBeUndefined();
    expect(find('Operation not permitted', false), 'also the words').toBeUndefined();
    expect(find('command not found', false), 'a missing program is an environment problem when unconfined too').toBe('command.not_found');
    expect(find('Could not resolve org.x:y:1.0', false), 'and dependencies').toBe('gradle.could_not_resolve');
  });

  it('names the problem and the base in the reason and holds no text of the check, which the reviewer reads as the measurement of the app', () => {
    const entry = ENVIRONMENT_PATTERNS.find((candidate) => candidate.id === 'connection.refused')!;
    expect(environmentNotRunReason(entry, { sameOnBase: true }), 'problem, base, code, where the evidence is').toBe('dependencies could not be fetched or the network is not available (connection.refused); the base commit fails the same way; the code was not tested; the end of the output shows what matched');
    expect(environmentNotRunReason(entry), 'without a base the sentence leaves the base out').toBe('dependencies could not be fetched or the network is not available (connection.refused); the code was not tested; the end of the output shows what matched');
  });

  it('uses the table it is given, so a pattern can be added without code', () => {
    const extra = [{ id: 'x.vpn', kind: 'dependencies' as const, pattern: /vpn is down/i, reason: 'the vpn is down' }];
    expect(findEnvironmentProblem('The VPN is down', { confined: true, patterns: extra })?.id, 'the extra pattern').toBe('x.vpn');
    expect(findEnvironmentProblem('command not found', { confined: true, patterns: extra }), 'the default table is replaced').toBeUndefined();
  });

  it('gives every pattern an id of its own and a reason, and every reason says the code was not tested', () => {
    expect(new Set(ENVIRONMENT_PATTERNS.map((entry) => entry.id)).size, 'unique ids').toBe(ENVIRONMENT_PATTERNS.length);
    for (const entry of ENVIRONMENT_PATTERNS) expect(environmentNotRunReason(entry), `the reason of ${entry.id}`).toMatch(/\(.+\); the code was not tested; the end of the output shows what matched$/);
  });
});
