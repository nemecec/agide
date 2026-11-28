import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The barrier against the class of host-side lookups that code an agent writes can influence (0040 section 6): the
 * app starts a program on the host through `isolation/hostTools.ts` or by an absolute path, nowhere else. This scan
 * reads the sources (TypeScript and JavaScript) of `src/core`, `src/main` and `src/preload` that are not tests and
 * fails when a file that can start a process is not in the allow-list, starts one with a program that is not the one
 * the list names for it, takes a spawner as a value (an alias, `.call`, `.apply`, `.bind`, an optional call, a
 * destructuring or the namespace itself), loads `child_process` or `node-pty` by `require`, `import()`, `module.require`
 * or a re-export, evaluates code (`eval`, `Function`), changes the command object that a spawn reads, or builds or
 * passes on a `HostTools` outside the files that wire it. A scan of the text cannot be complete: it stops the
 * spellings that code written by accident has, and the review of each change does the rest.
 */

const SOURCE_ROOT = join(import.meta.dirname, '..', '..');
const ROOTS = ['core', 'main', 'preload'];

interface Allowed {
  /** Path below `src`. */
  readonly file: string;
  /** The first arguments of the spawn calls the file may make. None: the file mentions `child_process` and makes no call. */
  readonly calls: readonly RegExp[];
  readonly reason: string;
  /** For each identifier that a call may take its program from: the only declarations of it the file may have (a pattern that every declaration matches). */
  readonly declared?: Readonly<Record<string, RegExp>>;
  /** Modules the file may name in a `require` call: the text of a stand-in program that a test writes to a file holds one. */
  readonly requires?: readonly string[];
}

const COMMAND_FILE = /^command\.file$/;

/** The files that build a `HostTools`: the module, the profile wiring and the two providers that make one over their own registry when they get none. */
const HOST_TOOLS_BUILDERS = ['core/isolation/hostTools.ts', 'core/isolation/profileHostTools.ts', 'core/isolation/SrtProvider.ts', 'core/isolation/ContainerProvider.ts'];

const ALLOWED: readonly Allowed[] = [
  { file: 'core/isolation/hostTools.ts', calls: [/^file$/, /^systemTool\(name\)$/], reason: 'the module itself: `file` is an absolute path (checked in `spawnFile`) that `HostTools.require` found outside the agent-writable directories, or a fixed system path' },
  { file: 'core/session/PtySessionService.ts', calls: [COMMAND_FILE], declared: { command: /^const command = await prepared\.ptyCommand\(/ }, reason: 'spawns the command of an isolation provider after `requireAbsoluteFile`; the providers found srt, docker and claude through `hostTools`' },
  { file: 'core/swarm/runtime/StreamAgentRuntime.ts', calls: [COMMAND_FILE], declared: { command: /^const command = await request\.environment\.processCommand\(/ }, reason: 'spawns the command of an isolation provider after `requireAbsoluteFile`' },
  { file: 'core/review/capture/runProcess.ts', calls: [COMMAND_FILE], declared: { command: /^command: ProcessCommand$/ }, reason: 'spawns the command of the check that `toolCommand` built, after `requireAbsoluteFile`' },
  { file: 'core/isolation/signalTable.ts', calls: [/^'\/bin\/sh'$/], reason: 'a fixed absolute path to the system shell, to read the signal table of the system' },
  { file: 'main/profileLauncher.ts', calls: [/^command$/], reason: 'starts the app itself: `command` is `process.execPath`, passed in by `main/index`' },
  { file: 'core/isolation/ptyHarness.ts', calls: [COMMAND_FILE], reason: 'test support: runs the command of the provider under test' },
  { file: 'core/isolation/isolationProviderContract.ts', calls: [/^'sleep'$/], reason: 'test support: a child that outlives a call, in the contract tests of the providers' },
  { file: 'core/isolation/testRuntimes.ts', calls: [/^'docker'$/], reason: 'test support: asks whether a local docker engine can run the container tests' },
  { file: 'core/isolation/fakeSrt.ts', calls: [], requires: ['node:child_process'], reason: 'test support: the source text of a stand-in srt that tests write to a file; the app never runs it' },
  { file: 'core/review/capture/gitFixtures.ts', calls: [/^'git'$/], reason: 'test support: makes repositories for tests' },
  { file: 'core/swarm/manager/testRig.ts', calls: [/^'git'$/], reason: 'test support: makes repositories for tests' },
  { file: 'core/tasks/fixtures/gitRepo.ts', calls: [/^'git'$/], reason: 'test support: makes repositories for tests' },
  { file: 'core/permissions/fixtures/fake-claude-gate.mjs', calls: [/^'\/bin\/sh'$/], reason: 'fixture: a stand-in for claude that tests run as a program; the app never loads it' },
  { file: 'core/agents/fixtures/fake-claude-agents.mjs', calls: [/^'\/bin\/sh'$/], reason: 'fixture: a stand-in for claude that tests run as a program; the app never loads it' },
  { file: 'core/session/fixtures/fake-claude.mjs', calls: [/^'\/bin\/sh'$/], reason: 'fixture: a stand-in for claude that tests run as a program; the app never loads it' },
  { file: 'core/inbox/fixtures/fake-claude-hooks.mjs', calls: [/^'\/bin\/sh'$/], reason: 'fixture: a stand-in for claude that tests run as a program; the app never loads it' },
  { file: 'core/swarm/fixtures/standIn.mjs', calls: [/^process\.execPath$/, /^'ps'$/], reason: 'fixture: a child process that tests start and look up by its command line; the app never loads it' },
];

const SPAWNERS = ['execFile', 'execFileSync', 'spawn', 'spawnSync', 'exec', 'execSync', 'fork'];
/** Uses of `HostTools` as a value that build or pass on the class: `new (HostTools)`, an alias, an argument, `Reflect.construct`, a subclass. */
const HOST_TOOLS_VALUE = /new\s*\(\s*HostTools\b|(?<![=!<>])=\s*HostTools\b|Reflect\s*\.\s*construct\s*\(\s*HostTools\b|[(,[]\s*HostTools\s*[,)\]]|extends\s+HostTools\b|\breturn\s+HostTools\b/;
const MODULES = /^(?:node:)?(?:child_process|node-pty)$/;

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

/** The names a file binds to `child_process` and `node-pty`: the functions it imports by name, and the namespaces (or default imports) it takes them from. */
function bindings(source: string): { readonly names: string[]; readonly namespaces: string[] } {
  const names = new Set<string>();
  const namespaces = new Set<string>();
  for (const match of source.matchAll(/import\s+(type\s+)?([^;]*?)\s+from\s+['"](?:node:)?(child_process|node-pty)['"]/g)) {
    if (match[1] !== undefined) continue;
    const clause = match[2] ?? '';
    const namespace = /\*\s+as\s+(\w+)/.exec(clause)?.[1] ?? /^(\w+)\s*(?:,|$)/.exec(clause)?.[1];
    if (namespace !== undefined) {
      namespaces.add(namespace);
      for (const spawner of SPAWNERS) names.add(`${namespace}.${spawner}`);
    }
    for (const specifier of /\{([^}]*)\}/.exec(clause)?.[1]?.split(',') ?? []) {
      const trimmed = specifier.trim();
      if (trimmed === '' || trimmed.startsWith('type ')) continue;
      const [imported, local = imported] = trimmed.split(/\s+as\s+/);
      if (imported !== undefined && SPAWNERS.includes(imported)) names.add(local!);
    }
  }
  return { names: [...names], namespaces: [...namespaces] };
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

const escaped = (name: string): string => name.replace(/\./g, '\\.');
const lineOf = (source: string, index: number): number => source.slice(0, index).split('\n').length;

/** Every declaration, assignment and destructuring of `name` in the file, as text that begins at the declaration. */
function declarations(source: string, name: string): string[] {
  const found: string[] = [];
  const patterns: [RegExp, number][] = [
    [new RegExp(`\\b(?:const|let|var)\\s+${name}\\b[^;\\n]*`, 'g'), 0],
    [new RegExp(`[(,]\\s*(${name}\\s*\\??:\\s*[\\w.<>\\[\\]| ]+?)\\s*[,)=]`, 'g'), 1],
    [new RegExp(`\\{[^{}]*\\b${name}\\b[^{}]*\\}\\s*=[^=]`, 'g'), 0],
    [new RegExp(`(?<!(?:const|let|var)\\s+)(?<![\\w.$])${name}\\s*=(?![=>])`, 'g'), 0],
    [new RegExp(`(?<![\\w.$])${name}\\s*=>`, 'g'), 0],
  ];
  for (const [pattern, group] of patterns) for (const match of source.matchAll(pattern)) found.push((match[group] ?? '').trim());
  // A parameter without a type, of an arrow function, a function or a method: `(command) =>`, `forEach((x, command) => ...)`, `run(command) {`.
  for (const match of source.matchAll(/(\b[\w$]+\s*)?\(([^()]*)\)\s*(?::[^=;{]+)?(?:=>|\{)/g)) {
    if (/^(?:if|while|for|switch|with|catch)\s*$/.test(match[1] ?? '')) continue;
    for (const parameter of (match[2] ?? '').split(',')) if (new RegExp(`^(?:\\.\\.\\.)?${name}\\s*(?:=|$)`).test(parameter.trim())) found.push(`${parameter.trim()} (a parameter without a type)`);
  }
  return found;
}

/** What is wrong with the process starts of one source file, as lines for a message. */
export function violations(file: string, original: string, allowed: readonly Allowed[] = ALLOWED): string[] {
  const source = stripComments(original);
  const entry = allowed.find((candidate) => candidate.file === file);
  const found: string[] = [];
  const withoutTypes = source.replace(/import\s+type\s+[^;]*;/g, '');
  if (/child_process|node-pty/.test(withoutTypes) && entry === undefined) found.push(`${file}: refers to child_process or node-pty and is not in the allow-list`);
  // The module that is loaded by another route than an import statement, or by a name the scan cannot read.
  for (const match of source.matchAll(/(?<![\w.$])(require|import)\s*\(/g)) {
    const argument = firstArgument(source, match.index + match[0].length - 1);
    if (/^\w+\??:\s/.test(argument)) continue;
    const literal = /^(['"`])(.*)\1$/s.exec(argument);
    if (literal === null || (literal[1] === '`' && literal[2]!.includes('${'))) found.push(`${file}:${lineOf(source, match.index)}: ${match[1]}(${argument}) loads a module by a name the scan cannot read`);
    else if (MODULES.test(literal[2]!) && !(entry?.requires ?? []).includes(literal[2]!)) found.push(`${file}:${lineOf(source, match.index)}: ${match[1]}(${argument}) loads a module that starts programs outside the import statement`);
  }
  if (/getBuiltinModule|createRequire/.test(source)) found.push(`${file}: getBuiltinModule or createRequire can load child_process by a computed name`);
  if (/\bmodule\s*\.\s*require\b|\bmainModule\b/.test(source)) found.push(`${file}: module.require or process.mainModule can load child_process`);
  if (/\._load\b/.test(source)) found.push(`${file}: Module._load (through module.constructor) can load child_process`);
  if (/\.\s*(?:binding|_linkedBinding|execve)\s*\(|\bprocess\s*\[\s*['"`](?:binding|_linkedBinding|execve)\b/.test(source)) found.push(`${file}: process.binding, process._linkedBinding or process.execve starts or replaces a program without child_process`);
  if (/worker_threads/.test(source) && /\beval\s*:\s*(?!false\b)/.test(source)) found.push(`${file}: a Worker started with eval runs code that the scan cannot read`);
  if (/(?:\bfrom\s+|\b(?:require|import)\s*\(\s*)['"`](?:node:)?vm['"`]/.test(source)) found.push(`${file}: node:vm runs code that the scan cannot read`);
  if (/new\s*\(\s*[\w$.()]*\.\s*constructor\s*\)/.test(source)) found.push(`${file}: new on the constructor of another object builds a class that the scan cannot name`);
  if (/\.\s*(?:require|import)\s*\(\s*(['"`])(?:node:)?(?:child_process|node-pty)\1/.test(source)) found.push(`${file}: a require method loads a module that starts programs`);
  if (/export\s+(?!type\b)[^;]*?\bfrom\s+['"](?:node:)?(?:child_process|node-pty)['"]/.test(source)) found.push(`${file}: re-exports child_process or node-pty, so its importers start programs without naming the module`);
  const code = source.replace(/import\s+(?!type\b)[^;]*?\s+from\s+['"][^'"]+['"];?/g, (statement) => statement.replace(/[^\n]/g, ' '));
  // The same text with the inside of every string blanked, so a word in a message or a quoted name is not a use of the function.
  const bare = code.replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g, (text) => `${text[0]}${text.slice(1, -1).replace(/[^\n]/g, ' ')}${text[0]}`);
  const exportsFrom = /export\s+[^;]*?from\s+['"][^'"]*['"];?/g;
  if ((/new\s+HostTools\s*\(/.test(bare) || HOST_TOOLS_VALUE.test(bare.replace(exportsFrom, ''))) && !HOST_TOOLS_BUILDERS.includes(file)) found.push(`${file}: builds or passes on the HostTools class, which only the wiring of the profile and the providers do`);
  if (/^(?:core|main)\//.test(file) && /(?<![\w.$])eval\s*\(|(?<![\w.$])(?:new\s+)?Function\s*\(/.test(bare)) found.push(`${file}: eval or Function runs code that the scan cannot read`);
  const { names, namespaces } = bindings(source);
  for (const namespace of namespaces) {
    for (const match of bare.matchAll(new RegExp(`(?<![\\w.$])${namespace}(?![\\w$])(?!\\.\\w)`, 'g'))) found.push(`${file}:${lineOf(code, match.index)}: ${namespace} is used as a value (a destructuring, an index or the namespace itself)`);
    for (const match of code.matchAll(new RegExp(`\\{[^{}]*\\}\\s*=\\s*${namespace}\\b`, 'g'))) found.push(`${file}:${lineOf(code, match.index)}: a destructuring of ${namespace} takes a spawner out of the namespace`);
  }
  for (const name of names) {
    for (const match of bare.matchAll(new RegExp(`(?<!typeof\\s+)(?<![\\w.$])${escaped(name)}(?![\\w$])(?!\\s*\\()`, 'g'))) {
      const prefix = bare.slice(bare.lastIndexOf('\n', match.index - 1) + 1, match.index);
      const key = /^\s*\??\s*:/.test(bare.slice(match.index + match[0].length)) && /(?:^|[{,;])\s*(?:readonly\s+)?$/.test(prefix);
      if (!key) found.push(`${file}:${lineOf(code, match.index)}: ${name} is used as a value (an alias, .call, .apply, .bind or an optional call)`);
    }
    for (const match of code.matchAll(new RegExp(`(?<![\\w.$])${escaped(name)}\\s*\\(`, 'g'))) {
      const argument = firstArgument(code, match.index + match[0].length - 1);
      // A method or a function that has the name of the import is a declaration: its first parameter has a type.
      if (/^\w+\??:\s/.test(argument)) continue;
      if (entry === undefined || !entry.calls.some((pattern) => pattern.test(argument))) found.push(`${file}:${lineOf(code, match.index)}: ${name}(${argument}...) starts a program that does not come from hostTools or an allow-listed absolute path`);
    }
  }
  for (const [identifier, pattern] of Object.entries(entry?.declared ?? {})) {
    const changes = [
      ...bare.matchAll(new RegExp(`(?<![\\w.$])${identifier}\\s*(?:\\.\\s*\\w+|\\[[^\\]]*\\])\\s*=(?![=>])`, 'g')),
      // On the text with its strings, since `Object['assign']` names the method in one.
      ...code.matchAll(new RegExp(`(?:Object|Reflect)\\s*(?:\\.\\s*|\\[\\s*['"\`])(?:assign|defineProperty|defineProperties|set)['"\`]?\\s*\\]?\\s*\\(\\s*${identifier}\\b`, 'g')),
    ];
    for (const match of changes) found.push(`${file}:${lineOf(code, match.index)}: a member of ${identifier} is changed, so the program of the spawn need not be the one it was declared with`);
    for (const match of bare.matchAll(new RegExp(`(?<![=!<>])=\\s*${identifier}\\s*(?=[;,)}\\n]|$)`, 'g'))) found.push(`${file}:${lineOf(code, match.index)}: ${identifier} is taken under another name, whose members the scan does not follow`);
    const own = declarations(code, identifier);
    if (own.length === 0) found.push(`${file}: no declaration of ${identifier} was found, so the scan cannot tell where the program of a call comes from`);
    for (const declaration of own) if (!pattern.test(declaration)) found.push(`${file}: ${identifier} is declared as "${declaration}", which is not the form this file may take its program from`);
  }
  return found;
}

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sources(path);
    return /\.([cm]?tsx?|[cm]?js)$/.test(entry.name) && !/\.(test|spec)\.[cm]?[jt]sx?$/.test(entry.name) && !/\.d\.[cm]?ts$/.test(entry.name) ? [path] : [];
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
    expect(violations('core/other.ts', promisified, [listed]).map((line) => line.replace(/^core\/other\.ts:\d+: /, '')), 'a spawner passed on as a value is a violation also in a listed file').toEqual([expect.stringContaining('execFile is used as a value')]);
    expect(violations('core/session/PtySessionService.ts', bare).filter((line) => line.includes('execFile(')).length, 'a bare name is a violation also in a file that is listed for other calls').toBe(1);
  });

  describe('spellings that take a spawner without a direct call', () => {
    const listed: Allowed = { file: 'core/other.ts', calls: [/^'git'$/, /^command\.file$/, /^x$/], requires: [], reason: 'a reason of more than twenty characters' };
    const imports = "import { spawn, execFile } from 'node:child_process';\nimport * as nodePty from 'node-pty';\nimport cp from 'node:child_process';\n";
    const spellings: [string, string][] = [
      ['an alias by assignment', "const start = nodePty.spawn;\nstart('git', [], {});"],
      ['an alias of a named import', 'const start = spawn;\nstart(program, []);'],
      ['an alias in an object', 'const tools = { run: spawn };'],
      ['an alias through a conditional', 'const start = flag ? spawn : execFile;'],
      ['.call', "spawn.call(undefined, 'git', []);"],
      ['.apply', "execFile.apply(undefined, ['git', []]);"],
      ['.bind', "const start = spawn.bind(undefined);\nstart('git', []);"],
      ['an optional call', "spawn?.('git', []);"],
      ['a namespace member with .call', "cp.execFile.call(undefined, 'git', []);"],
      ['a namespace member as a value', 'const start = cp.spawn;'],
      ['a destructuring from a namespace', "const { spawn: start } = nodePty;\nstart('git');"],
      ['a destructuring from a default import', "const { execFile: run } = cp;\nrun('git');"],
      ['an index into a namespace', "cp['execFile']('git', []);"],
      ['the namespace handed on', 'use(nodePty);'],
      ['require of child_process', "require('node:child_process').execFileSync('git');"],
      ['require of node-pty', "const pty = require('node-pty');"],
      ['require of a name that is built', "require('child' + '_process').execFileSync('git');"],
      ['import() of child_process', "import('node:child_process').then((module) => module.execFile('git', []));"],
      ['getBuiltinModule', "process.getBuiltinModule('child' + '_process').execFileSync('git');"],
      ['createRequire', "createRequire(import.meta.url)('node:child_process');"],
      ['a spawn of a member of an object that did not come from the provider', "const command = { file: 'git' };\nspawn(command.file, []);"],
      ['a spawn of a member whose object is assigned later', "let command;\ncommand = { file: 'git' };\nspawn(command.file, []);"],
      ['a HostTools built outside the wiring', "new HostTools({ appPath, excluded: () => [] });"],
    ];
    it.each(spellings)('flags %s, in a file that is not listed and in one that is', (_name, body) => {
      expect(violations('core/other.ts', imports + body, []).length, 'outside the allow-list').toBeGreaterThan(0);
      const entry: Allowed = { ...listed, declared: { command: /^command: ProcessCommand$/ } };
      expect(violations('core/other.ts', imports + body, [entry]).length, 'inside a listed file').toBeGreaterThan(0);
    });

    /** Spellings whose own rule must fire: the other rules (a file that is not listed, a declaration that is missing) would flag the sample as well. */
    const targeted: [string, string, string][] = [
      ['a re-export of a spawner', "export { execFileSync as launch } from 'node:child_process';", 're-exports child_process or node-pty'],
      ['a re-export of the whole module', "export * from 'node-pty';", 're-exports child_process or node-pty'],
      ['module.require', "const cp = module.require('node:child_process');", 'module.require or process.mainModule'],
      ['process.mainModule.require', "process.mainModule.require('child' + '_process');", 'module.require or process.mainModule'],
      ['a require method with the module name', "loader.require('node:child_process');", 'a require method loads'],
      ['a template with an interpolation as the module name', "const cp = await import(`node:${'child'}_process`);", 'by a name the scan cannot read'],
      ['eval', "eval('req' + 'uire')('node:child_process');", 'eval or Function'],
      ['new Function', "new Function('return process')();", 'eval or Function'],
      ['Function without new', "Function('return 1')();", 'eval or Function'],
      ['Object.assign onto the command that a spawn reads', "Object.assign(command, { file: 'git' });\nspawn(command.file, []);", 'a member of command is changed'],
      ['a member of the command assigned', "command.file = 'git';\nspawn(command.file, []);", 'a member of command is changed'],
      ['Reflect.set on the command', "Reflect.set(command, 'file', 'git');\nspawn(command.file, []);", 'a member of command is changed'],
      ['HostTools in parentheses', "new (HostTools)({ excluded: () => [] });", 'builds or passes on the HostTools class'],
      ['an alias of HostTools', "const Tools = HostTools;\nconst made = new Tools({ excluded: () => [] });", 'builds or passes on the HostTools class'],
      ['Reflect.construct of HostTools', "Reflect.construct(HostTools, [{ excluded: () => [] }]);", 'builds or passes on the HostTools class'],
      ['HostTools handed on', 'build(HostTools);', 'builds or passes on the HostTools class'],
      ['a subclass of HostTools', 'class Mine extends HostTools {}', 'builds or passes on the HostTools class'],
      ['HostTools returned from a function', 'function tools() {\n  return HostTools;\n}', 'builds or passes on the HostTools class'],
      ['a callback parameter without a type that shadows the command', "list.forEach((command) => spawn(command.file, []));\nconst command = await prepared.ptyCommand({});", 'a parameter without a type'],
      ['a single parameter without parentheses that shadows the command', "list.map(command => spawn(command.file, []));\nconst command = await prepared.ptyCommand({});", 'which is not the form this file may take its program from'],
      ['a method parameter without a type', "class A { run(command) { spawn(command.file, []); } }\nconst command = await prepared.ptyCommand({});", 'a parameter without a type'],
      ['a bracket assignment to the command', "command['file'] = 'git';\nspawn(command.file, []);", 'a member of command is changed'],
      ['an alias of the command whose member is changed', "const c = command;\nc.file = 'git';\nspawn(command.file, []);", 'command is taken under another name'],
      ['Object.assign named with brackets', "Object['assign'](command, { file: 'git' });\nspawn(command.file, []);", 'a member of command is changed'],
      ['module.constructor._load', "module.constructor._load('node:child_process');", 'Module._load'],
      ['process.binding', "process.binding('spawn_sync').spawn({ file: 'git' });", 'process.binding, process._linkedBinding or process.execve'],
      ['process._linkedBinding', "process._linkedBinding('x');", 'process.binding, process._linkedBinding or process.execve'],
      ['process.execve', "process.execve('/bin/sh', ['sh']);", 'process.binding, process._linkedBinding or process.execve'],
      ['a Worker started with eval', "import { Worker } from 'node:worker_threads';\nnew Worker(code, { eval: true });", 'a Worker started with eval'],
      ['node:vm', "import { runInThisContext } from 'node:vm';\nrunInThisContext(code);", 'node:vm runs code'],
      ['new on the constructor of the shared tools', 'new (hostTools().constructor)({ excluded: () => [] });', 'new on the constructor of another object'],
    ];
    it.each(targeted)('flags %s with its own rule, in a file that is not listed and in one that is', (_name, body, rule) => {
      const entry: Allowed = { ...listed, declared: { command: body.includes('prepared.ptyCommand') ? /^const command = await prepared\.ptyCommand\(/ : /^command: ProcessCommand$/ } };
      // A changed member, an alias or another declaration of the command matters only where a spawn of `command.file` is allowed: elsewhere any mention of child_process is flagged.
      const lists: Allowed[][] = /^a member of|^command is taken|parameter without a type|not the form/.test(rule) ? [[entry]] : [[], [entry]];
      for (const allowed of lists) expect(violations('core/other.ts', imports + body, allowed).some((line) => line.includes(rule)), `${allowed.length === 0 ? 'outside' : 'inside'} the allow-list: ${rule}`).toBe(true);
    });

    it('flags a computed name given to import() and a program name of a call that has no declaration to check', () => {
      expect(violations('core/other.ts', 'const m = await import(name);', [listed]).length, 'a variable').toBe(1);
      const entry: Allowed = { ...listed, declared: { command: /^command: ProcessCommand$/ } };
      expect(violations('core/other.ts', "import { spawn } from 'node:child_process';\nspawn(command.file, []);", [entry]), 'no declaration of command').toEqual([expect.stringContaining('no declaration of command')]);
    });

    it('accepts the declared form and nothing else', () => {
      const entry: Allowed = { ...listed, declared: { command: /^command: ProcessCommand$/ } };
      const head = "import { spawn } from 'node:child_process';\n";
      expect(violations('core/other.ts', `${head}export function run(command: ProcessCommand, ring: Ring) {\n  spawn(command.file, []);\n}`, [entry]), 'a parameter of the declared type').toEqual([]);
      const provider: Allowed = { ...listed, declared: { command: /^const command = await prepared\.ptyCommand\(/ } };
      expect(violations('core/other.ts', `${head}const command = await prepared.ptyCommand({ sessionId });\nspawn(command.file, []);`, [provider]), 'the value the provider returned').toEqual([]);
      expect(violations('core/other.ts', `${head}const command = await other.make({});\nspawn(command.file, []);`, [provider]).length, 'a value from anywhere else').toBe(1);
    });
  });

  it('accepts the listed call in the listed file and nothing else there', () => {
    const entry: Allowed = { file: 'core/x.ts', calls: [COMMAND_FILE], reason: 'a reason of more than twenty characters' };
    expect(violations('core/x.ts', "import { spawn } from 'node:child_process';\nspawn(command.file, [], {});", [entry]), 'the listed call').toEqual([]);
    expect(violations('core/x.ts', "import { spawn } from 'node:child_process';\nspawn(command.file, []);\nspawn('git', []);", [entry]).length, 'another call in the same file').toBe(1);
    expect(violations('core/x.ts', "import { spawn } from 'node:child_process';\nclass A { spawn(request: Request) { return spawn(command.file, []); } }", [entry]), 'a method of the same name is a declaration').toEqual([]);
  });

  it('accepts HostTools as a type, a word in a string and a .require method of another object', () => {
    const typed = "import type { HostTools } from './hostTools';\nexport interface O { readonly hostTools?: HostTools; tools: () => HostTools, other: HostTools | undefined }\nconst text = 'new HostTools(x)';\nthis.require(id);\nexport { HostTools } from './hostTools';";
    expect(violations('core/other.ts', typed, []), 'types, strings, a method named require and a re-export of the class are no use').toEqual([]);
  });

  it('flags eval below src/core and src/main only, and reads a template without an interpolation as a literal name', () => {
    expect(violations('preload/other.ts', "eval('1');", []), 'the preload scripts are outside this rule').toEqual([]);
    expect(violations('core/other.ts', 'const m = await import(`node:path`);', []), 'a template without an interpolation').toEqual([]);
  });

  it('scans the module forms of TypeScript and leaves out declaration files', () => {
    const root = mkdtempSync(join(tmpdir(), 'guard-sources-'));
    try {
      for (const name of ['a.ts', 'b.mts', 'c.cts', 'd.tsx', 'e.mjs', 'f.d.ts', 'g.d.mts', 'h.test.mts', 'i.json']) writeFileSync(join(root, name), '');
      expect(sources(root).map((path) => relative(root, path)).sort(), 'the sources the guard reads').toEqual(['a.ts', 'b.mts', 'c.cts', 'd.tsx', 'e.mjs']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('ignores a mention in a comment and a type-only import', () => {
    expect(violations('core/other.ts', "// uses child_process.execFile('git')\n/* spawn('x') child_process */\nimport type { ChildProcess } from 'node:child_process';\nexport type P = ChildProcess;"), 'comments and types start nothing').toEqual([]);
  });

  it('does not take a method of the same name on another object for a start', () => {
    const listed: Allowed = { file: 'core/other.ts', calls: [], reason: 'a reason of more than twenty characters' };
    expect(violations('core/other.ts', "import { execFile } from 'node:child_process';\nconst x = db.execFile; regex.exec('a'); this.spawn(a);\nexport type Run = typeof execFile;\ninterface Options { readonly execFile?: Run; spawn: Run }", [listed]), 'only a call or a value of the imported name is a start').toEqual([]);
  });
});
