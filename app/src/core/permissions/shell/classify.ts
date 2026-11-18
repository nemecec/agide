import type { ActionClassId } from '../types';
import { parseShell, ShellParseError, type ShellWord } from './parse';

/** One class a command line falls into. A command line can have several, one per simple command. */
export interface ClassHit {
  readonly classId: ActionClassId;
  readonly reason?: string;
  /** Who or what the action reaches: a remote and branch, a host. */
  readonly audience?: string;
  /** A force push or a deletion: the class's hard floor applies. */
  readonly hard?: boolean;
}

const OPAQUE: ClassHit = { classId: 'shell.opaque', reason: 'command the gate cannot read' };
const MAX_DEPTH = 4;

const RESERVED = new Set(['{', '}', '!', 'if', 'then', 'else', 'elif', 'fi', 'while', 'until', 'do', 'done', 'coproc']);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*\+?=/;
const GIT_ALIAS_INJECTION = /^GIT_CONFIG_(KEY_[0-9]+|PARAMETERS)=.*alias\./i;
const ALIAS_OPAQUE: ClassHit = { classId: 'shell.opaque', reason: 'a git alias set outside the command the gate reads' };
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh']);

/** Wrapper programs and the options of each that take a value. The wrapped command is classified in their place. */
const WRAPPERS: Readonly<Record<string, readonly string[]>> = {
  env: ['-u', '--unset', '-C', '--chdir'],
  command: [],
  builtin: [],
  exec: ['-a'],
  nohup: [],
  time: ['-f', '--format', '-o', '--output'],
  timeout: ['-s', '--signal', '-k', '--kill-after'],
  nice: ['-n', '--adjustment'],
  stdbuf: ['-i', '-o', '-e'],
  noglob: [],
  sudo: ['-u', '-g', '-h', '-p', '-C', '-D', '-R', '-T', '-U', '-r', '-t'],
  xargs: ['-n', '-I', '-L', '-P', '-s', '-d', '-E', '-a', '-J', '-l'],
  watch: ['-n', '--interval', '-d'],
};

export const basename = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

/** The classes of every command of a Bash input. A command the parser cannot read is `shell.opaque`. */
export function classifyBash(command: string): ClassHit[] {
  try {
    return classifySource(command, 0);
  } catch (error) {
    if (error instanceof ShellParseError) return [OPAQUE];
    throw error;
  }
}

function classifySource(source: string, depth: number): ClassHit[] {
  if (depth > MAX_DEPTH) return [OPAQUE];
  return parseShell(source).flatMap((simple) => classifySimple(simple.words, depth));
}

function classifySimple(words: readonly ShellWord[], depth: number): ClassHit[] {
  let i = 0;
  for (;;) {
    const word = words[i];
    if (word === undefined) return [];
    if (!word.dynamic && ASSIGNMENT.test(word.text)) {
      if (GIT_ALIAS_INJECTION.test(word.text)) return [ALIAS_OPAQUE];
      i++;
    } else if (!word.dynamic && RESERVED.has(word.text)) {
      i++;
    } else if (!word.dynamic && word.text === 'function') {
      i += 2;
    } else if (word.dynamic) {
      return [OPAQUE];
    } else {
      const name = basename(word.text);
      const options = WRAPPERS[name];
      if (options === undefined) return classifyProgram(name, words.slice(i + 1), depth);
      if (name === 'env') {
        const opaque = envOpaque(options, words, i + 1);
        if (opaque !== undefined) return [opaque];
      }
      i = skipWrapper(name, options, words, i + 1);
    }
  }
}

/** `env -S` splits a string into a command the gate cannot read; an env assignment can define a git alias. */
function envOpaque(takesValue: readonly string[], words: readonly ShellWord[], from: number): ClassHit | undefined {
  for (let i = from; i < words.length; i++) {
    const { text, dynamic } = words[i]!;
    if (dynamic || text === '--') return undefined;
    if (GIT_ALIAS_INJECTION.test(text)) return ALIAS_OPAQUE;
    if (text === '--split-string' || text.startsWith('--split-string=') || /^-[a-zA-Z]*S/.test(text)) return { classId: 'shell.opaque', reason: 'env -S runs a string the gate cannot read' };
    if (takesValue.includes(text)) i++;
    else if (!text.startsWith('-') && !ASSIGNMENT.test(text)) return undefined;
  }
  return undefined;
}

/** Index of the wrapped command after the wrapper's own options and operands. */
function skipWrapper(name: string, takesValue: readonly string[], words: readonly ShellWord[], from: number): number {
  let i = from;
  let durationPending = name === 'timeout';
  for (; i < words.length; i++) {
    const word = words[i]!;
    if (word.dynamic) return i;
    if (word.text === '--') return i + 1;
    if (word.text.startsWith('-') && word.text.length > 1) {
      if (takesValue.includes(word.text)) i++;
      continue;
    }
    if (name === 'env' && ASSIGNMENT.test(word.text)) continue;
    if (durationPending) {
      durationPending = false;
      continue;
    }
    if (name === 'nice' && /^[0-9]+$/.test(word.text)) continue;
    return i;
  }
  return i;
}

function classifyProgram(name: string, args: readonly ShellWord[], depth: number): ClassHit[] {
  if (SHELLS.has(name)) return classifyShell(args, depth);
  switch (name) {
    case 'eval':
      return [{ classId: 'shell.opaque', reason: 'eval runs text the gate cannot read' }];
    case 'source':
    case '.':
      return args[0] !== undefined && !args[0].dynamic && /(^|\/)activate$/.test(args[0].text) ? [] : [{ classId: 'shell.opaque', reason: 'sourced file the gate cannot read' }];
    case 'git':
      return classifyGit(args);
    case 'gh':
      return classifyGh(args);
    case 'curl':
      return classifyCurl(args);
    case 'wget':
      return classifyWget(args);
    case 'ssh':
    case 'scp':
    case 'sftp':
    case 'mosh':
      return [{ classId: 'remote.shell', audience: firstPositional(args) }];
    case 'rsync':
      return args.some((arg) => /^rsync:\/\//.test(arg.text) || /^[^/\s-][^/\s]*:/.test(arg.text)) ? [{ classId: 'remote.shell', audience: firstRemote(args) }] : [];
    case 'find':
      return classifyFind(args, depth);
    default:
      return classifyPublisher(name, args);
  }
}

function firstPositional(args: readonly ShellWord[]): string {
  return args.find((arg) => !arg.text.startsWith('-'))?.text ?? '';
}

function firstRemote(args: readonly ShellWord[]): string {
  return args.find((arg) => /^rsync:\/\//.test(arg.text) || /^[^/\s-][^/\s]*:/.test(arg.text))?.text ?? '';
}

/** `sh -c 'string'` is classified one level deeper; a shell reading a script from stdin cannot be read. */
function classifyShell(args: readonly ShellWord[], depth: number): ClassHit[] {
  if (args.length === 0 || args.every((arg) => arg.text === '-s' || arg.text === '-')) {
    return [{ classId: 'shell.opaque', reason: 'a shell that reads its script from input' }];
  }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg.dynamic) return [OPAQUE];
    if (/^-[a-zA-Z]*c[a-zA-Z]*$/.test(arg.text)) {
      const script = args[i + 1];
      if (script === undefined || script.dynamic) return [OPAQUE];
      return classifySource(script.text, depth + 1);
    }
    if (!arg.text.startsWith('-')) return [];
  }
  return [];
}

function classifyFind(args: readonly ShellWord[], depth: number): ClassHit[] {
  const hits: ClassHit[] = [];
  for (let i = 0; i < args.length; i++) {
    if (!['-exec', '-execdir', '-ok', '-okdir'].includes(args[i]!.text)) continue;
    const rest: ShellWord[] = [];
    for (let j = i + 1; j < args.length && args[j]!.text !== ';' && args[j]!.text !== '+'; j++) rest.push(args[j]!);
    hits.push(...classifySimple(rest, depth + 1));
  }
  return hits;
}

const GIT_OPTIONS_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env', '--attr-source']);
const GIT_FORCE_FLAGS = /^(--force|--force-with-lease(=.*)?|--force-if-includes|--delete|--mirror|--prune)$/;

function classifyGit(args: readonly ShellWord[]): ClassHit[] {
  let i = 0;
  for (; i < args.length; i++) {
    const word = args[i]!;
    if (word.dynamic) return [OPAQUE];
    const text = word.text;
    if (!text.startsWith('-')) break;
    if (text === '-c' || (text.startsWith('-c') && text.length > 2 && !text.startsWith('--'))) {
      const setting = text === '-c' ? args[i + 1]?.text : text.slice(2);
      if (setting === undefined || /^alias\./i.test(setting)) return [{ classId: 'shell.opaque', reason: 'a git alias set on the command line' }];
      if (text === '-c') i++;
    } else if (text === '--config-env' || text.startsWith('--config-env=')) {
      const setting = text === '--config-env' ? args[i + 1]?.text : text.slice('--config-env='.length);
      if (setting === undefined || /^alias\./i.test(setting)) return [{ classId: 'shell.opaque', reason: 'a git alias set on the command line' }];
      if (text === '--config-env') i++;
    } else if (GIT_OPTIONS_WITH_VALUE.has(text)) {
      i++;
    }
  }
  const sub = args[i];
  if (sub === undefined) return [];
  if (sub.dynamic) return [OPAQUE];
  const rest = args.slice(i + 1);
  if (sub.text === 'config' && rest.some((arg) => /^alias\./i.test(arg.text))) return [{ classId: 'shell.opaque', reason: 'a git alias written to the configuration' }];
  switch (sub.text) {
    case 'push':
      return [classifyPush(rest)];
    case 'send-email':
      return [{ classId: 'remote.shell', audience: 'email' }];
    case 'fetch':
    case 'pull':
    case 'ls-remote':
    case 'clone':
      return [{ classId: 'read' }];
    default:
      return [];
  }
}

function classifyPush(args: readonly ShellWord[]): ClassHit {
  const positional = args.filter((arg) => !arg.text.startsWith('-'));
  const hard =
    args.some((arg) => GIT_FORCE_FLAGS.test(arg.text) || arg.text === '-f' || arg.text === '-d' || /^-[a-zA-Z]*[fd][a-zA-Z]*$/.test(arg.text)) ||
    positional.slice(1).some((arg) => arg.text.startsWith('+') || arg.text.startsWith(':'));
  const audience = positional.map((arg) => arg.text).join(' ');
  return { classId: 'git.push', ...(audience === '' ? {} : { audience }), ...(hard ? { hard: true } : {}) };
}

const GH_OPTIONS_WITH_VALUE = new Set([
  '-R', '--repo', '--hostname', '-b', '--body', '-t', '--title', '-B', '--base', '-H', '--head', '-a', '--assignee',
  '-l', '--label', '-m', '--milestone', '-r', '--reviewer', '-p', '--project', '-q', '--jq', '-X', '--method', '-f',
  '--raw-field', '-F', '--field', '--input', '--cache', '--body-file', '--template',
]);
const GH_READ_VERBS = new Set(['view', 'list', 'diff', 'checks', 'status', 'checkout', 'download', 'watch', 'clone', 'search', 'browse', 'ls', 'get']);
const GH_LOCAL_GROUPS = new Set(['auth', 'config', 'completion', 'help', 'version', 'status', 'browse', 'search', 'cache']);
const GH_COMMENT_VERBS: Readonly<Record<string, readonly string[]>> = { pr: ['comment'], issue: ['comment'] };
const GH_CREATE_VERBS: Readonly<Record<string, readonly string[]>> = { pr: ['create', 'edit'], issue: ['create', 'edit'] };

function classifyGh(args: readonly ShellWord[]): ClassHit[] {
  const positional: ShellWord[] = [];
  for (let i = 0; i < args.length && positional.length < 2; i++) {
    const word = args[i]!;
    if (word.dynamic) return [OPAQUE];
    if (word.text.startsWith('-')) {
      if (GH_OPTIONS_WITH_VALUE.has(word.text)) i++;
    } else positional.push(word);
  }
  const group = positional[0]?.text;
  const verb = positional[1]?.text;
  if (group === undefined || GH_LOCAL_GROUPS.has(group)) return [];
  if (group === 'api') return [classifyGhApi(args.slice(args.findIndex((arg) => arg.text === 'api') + 1))];
  if (group === 'alias' || group === 'extension') return [{ classId: 'shell.opaque', reason: 'gh alias or extension the gate cannot read' }];
  if (verb === undefined) return [];
  if (group === 'label') return [{ classId: 'github.create' }];
  if (group === 'gist') return GH_READ_VERBS.has(verb) ? [{ classId: 'read' }] : [{ classId: 'github.create' }];
  if (GH_COMMENT_VERBS[group]?.includes(verb)) return [{ classId: 'github.comment' }];
  if (GH_CREATE_VERBS[group]?.includes(verb)) return [{ classId: 'github.create' }];
  if (group === 'pr' && verb === 'review') {
    const approves = args.some((arg) => ['--approve', '-a', '--request-changes', '-r'].includes(arg.text));
    return [{ classId: approves ? 'github.approve' : 'github.comment' }];
  }
  return GH_READ_VERBS.has(verb) ? [{ classId: 'read' }] : [{ classId: 'github.approve' }];
}

function classifyGhApi(args: readonly ShellWord[]): ClassHit {
  let method: string | undefined;
  let hasFields = false;
  let mutation = false;
  let path: string | undefined;
  const noteField = (word: ShellWord | undefined): void => {
    hasFields = true;
    const value = word?.text;
    if (value === undefined || word?.dynamic === true || value.includes('=@') || /\bmutation\b/i.test(value)) mutation = true;
  };
  for (let i = 0; i < args.length; i++) {
    const { text, dynamic } = args[i]!;
    if (dynamic && text.startsWith('-')) return OPAQUE;
    if (text === '-X' || text === '--method') method = args[++i]?.text;
    else if (text.startsWith('--method=')) method = text.slice('--method='.length);
    else if (/^-X./.test(text)) method = text.slice(2);
    else if (['-f', '-F', '--field', '--raw-field'].includes(text)) noteField(args[++i]);
    else if (/^--(field|raw-field)=/.test(text)) noteField(args[i]);
    else if (/^-[fF]./.test(text)) noteField(args[i]);
    else if (text === '--input') {
      hasFields = true;
      mutation = true;
      i++;
    } else if (text.startsWith('--input=')) {
      hasFields = true;
      mutation = true;
    } else if (['-H', '--header', '-q', '--jq', '-t', '--template', '--hostname', '--cache', '-p', '--preview'].includes(text)) i++;
    else if (!text.startsWith('-') && path === undefined) path = text;
  }
  if (path === 'graphql') return mutation ? { classId: 'github.approve', reason: 'GraphQL mutation' } : { classId: 'read' };
  const verb = (method ?? (hasFields ? 'POST' : 'GET')).toUpperCase();
  if (verb === 'GET' || verb === 'HEAD') return { classId: 'read' };
  return /\/comments(\/[0-9]+)?$/.test(path ?? '') ? { classId: 'github.comment' } : { classId: 'github.approve' };
}

function urlHost(args: readonly ShellWord[]): string | undefined {
  const url = args.find((arg) => /^[a-z][a-z0-9+.-]*:\/\//i.test(arg.text));
  if (url === undefined) return undefined;
  try {
    return new URL(url.text).host;
  } catch {
    return undefined;
  }
}

function classifyCurl(args: readonly ShellWord[]): ClassHit[] {
  const audience = urlHost(args);
  const place = audience === undefined ? {} : { audience };
  let write = false;
  for (let i = 0; i < args.length; i++) {
    const text = args[i]!.text;
    if (text === '-X' || text === '--request') {
      if (!/^(GET|HEAD)$/i.test(args[i + 1]?.text ?? '')) write = true;
    } else if (text.startsWith('--request=')) {
      if (!/^(GET|HEAD)$/i.test(text.slice('--request='.length))) write = true;
    } else if (/^--(data|form|upload-file|json)/.test(text)) {
      write = true;
    } else if (text.startsWith('-') && !text.startsWith('--')) {
      const cluster = text.slice(1);
      const x = cluster.indexOf('X');
      if (/[dFT]/.test(cluster)) write = true;
      if (x >= 0) {
        const attached = cluster.slice(x + 1);
        const method = attached === '' ? args[i + 1]?.text ?? '' : attached;
        if (!/^(GET|HEAD)$/i.test(method)) write = true;
      }
    }
  }
  return [write ? { classId: 'http.write', ...place } : { classId: 'read', ...place }];
}

function classifyWget(args: readonly ShellWord[]): ClassHit[] {
  const audience = urlHost(args);
  const place = audience === undefined ? {} : { audience };
  const write = args.some((arg) => /^--(post-data|post-file|body-data|body-file)/.test(arg.text) || (/^--method(=|$)/.test(arg.text) && !/=(GET|HEAD)$/i.test(arg.text)));
  return [write ? { classId: 'http.write', ...place } : { classId: 'read', ...place }];
}

const PUBLISH_VERBS: Readonly<Record<string, readonly string[]>> = {
  npm: ['publish'],
  pnpm: ['publish'],
  yarn: ['publish'],
  cargo: ['publish'],
  twine: ['upload'],
  uv: ['publish'],
  poetry: ['publish'],
  gem: ['push'],
  docker: ['push'],
  mvn: ['deploy'],
  gradle: ['publish'],
  gradlew: ['publish'],
};

function classifyPublisher(name: string, args: readonly ShellWord[]): ClassHit[] {
  const verbs = PUBLISH_VERBS[name];
  if (verbs === undefined) return [];
  const window = args.slice(0, 6).filter((arg) => !arg.dynamic);
  const publishes = window.some((arg) => verbs.some((verb) => (name === 'gradle' || name === 'gradlew' ? arg.text.startsWith(verb) : arg.text === verb)));
  return publishes ? [{ classId: 'package.publish' }] : [];
}
