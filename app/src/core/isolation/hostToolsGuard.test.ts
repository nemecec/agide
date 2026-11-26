import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The barrier against the class of host-side lookups that code an agent writes can influence (0040 section 6): the
 * app starts a program on the host through `isolation/hostTools.ts` or by an absolute path, nowhere else. This scan
 * reads the sources of `src/core`, `src/main` and `src/preload` that are not tests and fails when a file that can
 * start a process is not in the allow-list, or starts one with a program that is not the one the list names for it.
 */

const SOURCE_ROOT = join(import.meta.dirname, '..', '..');
const ROOTS = ['core', 'main', 'preload'];

interface Allowed {
  /** Path below `src`. */
  readonly file: string;
  /** The first arguments of the spawn calls the file may make. None: the file mentions `child_process` and makes no call. */
  readonly calls: readonly RegExp[];
  readonly reason: string;
}

const COMMAND_FILE = /^command\.file$/;

const ALLOWED: readonly Allowed[] = [
  { file: 'core/isolation/hostTools.ts', calls: [/^file$/, /^systemTool\(name\)$/], reason: 'the module itself: `file` is an absolute path (checked in `spawnFile`) that `HostTools.require` found outside the agent-writable directories, or a fixed system path' },
  { file: 'core/session/PtySessionService.ts', calls: [COMMAND_FILE], reason: 'spawns the command of an isolation provider after `requireAbsoluteFile`; the providers found srt, docker and claude through `hostTools`' },
  { file: 'core/swarm/runtime/StreamAgentRuntime.ts', calls: [COMMAND_FILE], reason: 'spawns the command of an isolation provider after `requireAbsoluteFile`' },
  { file: 'core/review/capture/runProcess.ts', calls: [COMMAND_FILE], reason: 'spawns the command of the check that `toolCommand` built, after `requireAbsoluteFile`' },
  { file: 'core/isolation/signalTable.ts', calls: [/^'\/bin\/sh'$/], reason: 'a fixed absolute path to the system shell, to read the signal table of the system' },
  { file: 'main/profileLauncher.ts', calls: [/^command$/], reason: 'starts the app itself: `command` is `process.execPath`, passed in by `main/index`' },
  { file: 'core/isolation/ptyHarness.ts', calls: [COMMAND_FILE], reason: 'test support: runs the command of the provider under test' },
  { file: 'core/isolation/isolationProviderContract.ts', calls: [/^'sleep'$/], reason: 'test support: a child that outlives a call, in the contract tests of the providers' },
  { file: 'core/isolation/testRuntimes.ts', calls: [/^'docker'$/], reason: 'test support: asks whether a local docker engine can run the container tests' },
  { file: 'core/isolation/fakeSrt.ts', calls: [], reason: 'test support: the source text of a stand-in srt that tests write to a file; the app never runs it' },
  { file: 'core/review/capture/gitFixtures.ts', calls: [/^'git'$/], reason: 'test support: makes repositories for tests' },
  { file: 'core/swarm/manager/testRig.ts', calls: [/^'git'$/], reason: 'test support: makes repositories for tests' },
  { file: 'core/tasks/fixtures/gitRepo.ts', calls: [/^'git'$/], reason: 'test support: makes repositories for tests' },
];

const SPAWNERS = ['execFile', 'execFileSync', 'spawn', 'spawnSync', 'exec', 'execSync', 'fork'];

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

/** The names a file binds to the process-starting functions of `child_process` and `node-pty`, as call prefixes. */
function spawnNames(source: string): string[] {
  const names = new Set<string>();
  for (const match of source.matchAll(/import\s+(type\s+)?([^;]*?)\s+from\s+['"](?:node:)?(child_process|node-pty)['"]/g)) {
    if (match[1] !== undefined) continue;
    const clause = match[2] ?? '';
    const namespace = /\*\s+as\s+(\w+)/.exec(clause)?.[1] ?? /^(\w+)\s*(?:,|$)/.exec(clause)?.[1];
    if (namespace !== undefined) for (const spawner of SPAWNERS) names.add(`${namespace}.${spawner}`);
    for (const specifier of /\{([^}]*)\}/.exec(clause)?.[1]?.split(',') ?? []) {
      const trimmed = specifier.trim();
      if (trimmed === '' || trimmed.startsWith('type ')) continue;
      const [imported, local = imported] = trimmed.split(/\s+as\s+/);
      if (imported !== undefined && SPAWNERS.includes(imported)) names.add(local!);
    }
  }
  return [...names];
}

/** The text of the first argument of a call whose name ends at `open` (the index of its parenthesis). */
function firstArgument(source: string, open: number): string {
  let depth = 0;
  let quote = '';
  for (let index = open + 1; index < source.length; index++) {
    const char = source[index]!;
    if (quote !== '') {
      if (char === '\\') index++;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === "'" || char === '"' || char === '`') quote = char;
    else if (char === '(' || char === '[' || char === '{') depth++;
    else if (char === ')' || char === ']' || char === '}') {
      if (depth === 0) return source.slice(open + 1, index).trim();
      depth--;
    } else if (char === ',' && depth === 0) return source.slice(open + 1, index).trim();
  }
  return source.slice(open + 1).trim();
}

/** What is wrong with the process starts of one source file, as lines for a message. */
export function violations(file: string, original: string, allowed: readonly Allowed[] = ALLOWED): string[] {
  const source = stripComments(original);
  const entry = allowed.find((candidate) => candidate.file === file);
  const found: string[] = [];
  const withoutTypes = source.replace(/import\s+type\s+[^;]*;/g, '');
  if (/child_process/.test(withoutTypes) && entry === undefined) found.push(`${file}: refers to child_process and is not in the allow-list`);
  for (const name of spawnNames(source)) {
    // A spawner handed on as a value (`promisify(execFile)`) starts programs through a call this scan does not see.
    if (new RegExp(`\\(\\s*${name.replace('.', '\\.')}\\s*[,)]`).test(source)) found.push(`${file}: ${name} is passed on as a value`);
    for (const match of source.matchAll(new RegExp(`(?<![\\w.])${name.replace('.', '\\.')}\\s*\\(`, 'g'))) {
      const argument = firstArgument(source, match.index + match[0].length - 1);
      // A method or a function that has the name of the import is a declaration: its first parameter has a type.
      if (/^\w+\??:\s/.test(argument)) continue;
      const line = source.slice(0, match.index).split('\n').length;
      if (entry === undefined || !entry.calls.some((pattern) => pattern.test(argument))) found.push(`${file}:${line}: ${name}(${argument}...) starts a program that does not come from hostTools or an allow-listed absolute path`);
    }
  }
  return found;
}

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [path] : [];
  });
}

describe('host-side process starts', () => {
  it('start only through hostTools or an absolute path the allow-list names', () => {
    const found = ROOTS.flatMap((root) => sources(join(SOURCE_ROOT, root))).flatMap((path) => violations(relative(SOURCE_ROOT, path), readFileSync(path, 'utf8')));
    expect(found, 'every start of a program on the host is through the module, or listed with its reason').toEqual([]);
  });

  it('has an allow-list whose files exist and that gives each entry a reason', () => {
    const existing = new Set(ROOTS.flatMap((root) => sources(join(SOURCE_ROOT, root))).map((path) => relative(SOURCE_ROOT, path)));
    for (const entry of ALLOWED) {
      expect(existing.has(entry.file), `${entry.file} exists`).toBe(true);
      expect(entry.reason.length, `${entry.file} has a reason`).toBeGreaterThan(20);
    }
  });

  it('flags the forms it exists to stop', () => {
    const bare = "import { execFile } from 'node:child_process';\nexecFile('git', ['status']);";
    const variable = "import { spawn } from 'node:child_process';\nspawn(program, args);";
    const aliased = "import { execFileSync as run } from 'node:child_process';\nrun(`ps`, []);";
    const namespace = "import * as cp from 'node:child_process';\ncp.spawnSync(name, []);";
    const defaulted = "import cp from 'child_process';\ncp.execFile(\"docker\", []);";
    const pty = "import * as nodePty from 'node-pty';\nnodePty.spawn(command.file, []);";
    const required = "const { execFile } = require('node:child_process');";
    const promisified = "import { execFile } from 'node:child_process';\nconst run = promisify(execFile);";
    expect([bare, variable, aliased, namespace, defaulted, pty, required, promisified].map((source) => violations('core/other.ts', source).length > 0), 'each is a violation outside the allow-list').toEqual([true, true, true, true, true, true, true, true]);
    const listed: Allowed = { file: 'core/other.ts', calls: [/^x$/], reason: 'a reason of more than twenty characters' };
    expect(violations('core/other.ts', promisified, [listed]), 'a spawner passed on as a value is a violation also in a listed file').toEqual(['core/other.ts: execFile is passed on as a value']);
    expect(violations('core/session/PtySessionService.ts', bare).length, 'a bare name is a violation also in a file that is listed for other calls').toBe(1);
  });

  it('accepts the listed call in the listed file and nothing else there', () => {
    const entry: Allowed = { file: 'core/x.ts', calls: [COMMAND_FILE], reason: 'a reason of more than twenty characters' };
    expect(violations('core/x.ts', "import { spawn } from 'node:child_process';\nspawn(command.file, [], {});", [entry]), 'the listed call').toEqual([]);
    expect(violations('core/x.ts', "import { spawn } from 'node:child_process';\nspawn(command.file, []);\nspawn('git', []);", [entry]).length, 'another call in the same file').toBe(1);
    expect(violations('core/x.ts', "import { spawn } from 'node:child_process';\nclass A { spawn(request: Request) { return spawn(command.file, []); } }", [entry]), 'a method of the same name is a declaration').toEqual([]);
  });

  it('ignores a mention in a comment and a type-only import', () => {
    expect(violations('core/other.ts', "// uses child_process.execFile('git')\n/* spawn('x') child_process */\nimport type { ChildProcess } from 'node:child_process';\nexport type P = ChildProcess;"), 'comments and types start nothing').toEqual([]);
  });

  it('does not take a method of the same name on another object for a start', () => {
    const listed: Allowed = { file: 'core/other.ts', calls: [], reason: 'a reason of more than twenty characters' };
    expect(violations('core/other.ts', "import { execFile } from 'node:child_process';\nconst x = db.execFile; regex.exec('a'); this.spawn(a);\nexport { execFile };", [listed]), 'only a call of the imported name is a start').toEqual([]);
  });
});
