/**
 * A small shell word parser for the command inspector (0028 section 3). It splits a command line into simple
 * commands at `;`, `&&`, `||`, `|`, `&`, newlines and parentheses, removes quotes and escapes, finds the
 * commands inside `$(...)`, backticks, process substitutions and heredoc bodies, and drops redirections.
 * A word that depends on a variable, a substitution, a glob or a brace expansion is marked `dynamic`: its
 * value is not known before the shell runs. Anything it cannot read throws `ShellParseError`.
 */

export interface ShellWord {
  readonly text: string;
  /** The value depends on expansion the parser cannot evaluate. */
  readonly dynamic: boolean;
}

export interface SimpleCommand {
  readonly words: readonly ShellWord[];
}

export class ShellParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShellParseError';
  }
}

const MAX_DEPTH = 12;
const MAX_LENGTH = 100_000;
const NAME_CHAR = /[A-Za-z0-9_]/;
const SPECIAL_PARAMETER = /[@*#?$!\-0-9]/;
const DOUBLE_QUOTE_ESCAPES = '$`"\\';

interface State {
  readonly src: string;
  pos: number;
  readonly out: SimpleCommand[];
  depth: number;
}

interface WordBuilder {
  text: string;
  /** The characters that were not quoted, for glob and brace detection. */
  bare: string;
  dynamic: boolean;
}

interface Heredoc {
  readonly delimiter: string;
  readonly stripTabs: boolean;
  readonly expands: boolean;
}

/** Every simple command of `source`, nested ones included, in reading order. */
export function parseShell(source: string): SimpleCommand[] {
  if (source.length > MAX_LENGTH) throw new ShellParseError('command is too long to read');
  const out: SimpleCommand[] = [];
  parseList({ src: source, pos: 0, out, depth: 0 }, false);
  return out;
}

/** Parses a nested list at the cursor of the same state, which ends at the matching `)`. */
function parseNested(state: State): void {
  state.depth++;
  try {
    parseList(state, true);
  } finally {
    state.depth--;
  }
}

function parseList(state: State, insideSubstitution: boolean): void {
  if (state.depth > MAX_DEPTH) throw new ShellParseError('commands are nested too deeply');
  const { src } = state;
  let words: ShellWord[] = [];
  let word: WordBuilder | null = null;
  let skipNextWord = false;
  let parentheses = 0;
  const heredocs: Heredoc[] = [];

  const endWord = (): void => {
    if (word === null) return;
    const finished = finishWord(word);
    word = null;
    if (skipNextWord) skipNextWord = false;
    else words.push(finished);
  };
  const endCommand = (): void => {
    endWord();
    if (words.length > 0) state.out.push({ words });
    words = [];
  };
  const builder = (): WordBuilder => (word ??= { text: '', bare: '', dynamic: false });

  while (state.pos < src.length) {
    const ch = src[state.pos]!;
    if (ch === '\n') {
      endCommand();
      state.pos++;
      readHeredocBodies(state, heredocs.splice(0));
    } else if (ch === ' ' || ch === '\t' || ch === '\r') {
      endWord();
      state.pos++;
    } else if (ch === '#' && word === null) {
      while (state.pos < src.length && src[state.pos] !== '\n') state.pos++;
    } else if (ch === ';') {
      endCommand();
      state.pos++;
    } else if (ch === '|') {
      endCommand();
      state.pos++;
      if (src[state.pos] === '|' || src[state.pos] === '&') state.pos++;
    } else if (ch === '&') {
      if (src[state.pos + 1] === '>') {
        word = dropFileDescriptor(word);
        state.pos += src[state.pos + 2] === '>' ? 3 : 2;
        skipNextWord = true;
      } else {
        endCommand();
        state.pos++;
        if (src[state.pos] === '&') state.pos++;
      }
    } else if (ch === '(') {
      endCommand();
      state.pos++;
      parentheses++;
    } else if (ch === ')') {
      endCommand();
      state.pos++;
      if (parentheses > 0) parentheses--;
      else if (insideSubstitution) return;
    } else if (ch === '<' || ch === '>') {
      word = dropFileDescriptor(word);
      endWord();
      const operator = readRedirection(state);
      if (operator.processSubstitution) parseNested(state);
      else if (operator.heredoc) {
        const heredoc = readHeredocDelimiter(state, operator.stripTabs);
        if (heredoc !== undefined) heredocs.push(heredoc);
      } else skipNextWord = true;
    } else {
      readWordPart(state, builder(), ch);
    }
  }
  if (insideSubstitution) throw new ShellParseError('unterminated command substitution');
  endCommand();
}

/** A word of only digits before a redirection operator is the file descriptor, not an argument. */
function dropFileDescriptor(word: WordBuilder | null): WordBuilder | null {
  return word !== null && /^[0-9]+$/.test(word.bare) && word.bare === word.text ? null : word;
}

function finishWord(word: WordBuilder): ShellWord {
  const glob = /[*?[]/.test(word.bare);
  const brace = word.bare.includes('{') && word.bare.length > 1 && (word.bare.includes(',') || word.bare.includes('..'));
  return { text: word.text, dynamic: word.dynamic || glob || brace };
}

interface RedirectionOperator {
  readonly processSubstitution: boolean;
  readonly heredoc: boolean;
  readonly stripTabs: boolean;
}

/** Consumes one redirection operator at the cursor. */
function readRedirection(state: State): RedirectionOperator {
  const { src } = state;
  const first = src[state.pos]!;
  state.pos++;
  if (src[state.pos] === '(') {
    state.pos++;
    return { processSubstitution: true, heredoc: false, stripTabs: false };
  }
  if (first === '<' && src.startsWith('<<<', state.pos - 1)) {
    state.pos += 2;
    return { processSubstitution: false, heredoc: false, stripTabs: false };
  }
  if (first === '<' && src[state.pos] === '<') {
    state.pos++;
    const stripTabs = src[state.pos] === '-';
    if (stripTabs) state.pos++;
    return { processSubstitution: false, heredoc: true, stripTabs };
  }
  if (src[state.pos] === first || src[state.pos] === '&' || src[state.pos] === '|' || (first === '<' && src[state.pos] === '>')) state.pos++;
  return { processSubstitution: false, heredoc: false, stripTabs: false };
}

function readHeredocDelimiter(state: State, stripTabs: boolean): Heredoc | undefined {
  const { src } = state;
  while (src[state.pos] === ' ' || src[state.pos] === '\t') state.pos++;
  let delimiter = '';
  let quoted = false;
  while (state.pos < src.length && !/[\s;&|()<>]/.test(src[state.pos]!)) {
    const ch = src[state.pos]!;
    if (ch === "'" || ch === '"') {
      const end = src.indexOf(ch, state.pos + 1);
      if (end < 0) throw new ShellParseError('unterminated quote in a heredoc delimiter');
      delimiter += src.slice(state.pos + 1, end);
      state.pos = end + 1;
      quoted = true;
    } else if (ch === '\\') {
      delimiter += src[state.pos + 1] ?? '';
      state.pos += 2;
      quoted = true;
    } else {
      delimiter += ch;
      state.pos++;
    }
  }
  return delimiter === '' ? undefined : { delimiter, stripTabs, expands: !quoted };
}

/** Skips the bodies that follow a newline. The body of an unquoted heredoc can hold command substitutions. */
function readHeredocBodies(state: State, heredocs: readonly Heredoc[]): void {
  const { src } = state;
  for (const heredoc of heredocs) {
    const bodyStart = state.pos;
    let lineStart = state.pos;
    let bodyEnd = src.length;
    let next = src.length;
    while (lineStart < src.length) {
      const lineEnd = src.indexOf('\n', lineStart);
      const end = lineEnd < 0 ? src.length : lineEnd;
      const line = heredoc.stripTabs ? src.slice(lineStart, end).replace(/^\t+/, '') : src.slice(lineStart, end);
      if (line === heredoc.delimiter) {
        bodyEnd = lineStart;
        next = lineEnd < 0 ? src.length : lineEnd + 1;
        break;
      }
      lineStart = lineEnd < 0 ? src.length : lineEnd + 1;
    }
    if (heredoc.expands) scanExpansions(state, src.slice(bodyStart, bodyEnd));
    state.pos = next;
  }
}

function scanExpansions(state: State, body: string): void {
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (ch === '\\') i++;
    else if (ch === '$' && body[i + 1] === '(') {
      const inner: State = { src: body, pos: i + 2, out: state.out, depth: state.depth + 1 };
      parseList(inner, true);
      i = inner.pos - 1;
    } else if (ch === '`') {
      const end = body.indexOf('`', i + 1);
      if (end < 0) throw new ShellParseError('unterminated backtick in a heredoc');
      parseBacktick(state, body.slice(i + 1, end));
      i = end;
    }
  }
}

function parseBacktick(state: State, raw: string): void {
  const inner = raw.replace(/\\([`$\\])/g, '$1');
  parseList({ src: inner, pos: 0, out: state.out, depth: state.depth + 1 }, false);
}

/** Reads one character or one quoted or expanded part of a word and appends it to `word`. */
function readWordPart(state: State, word: WordBuilder, ch: string): void {
  const { src } = state;
  if (ch === "'") {
    const end = src.indexOf("'", state.pos + 1);
    if (end < 0) throw new ShellParseError('unterminated single quote');
    word.text += src.slice(state.pos + 1, end);
    state.pos = end + 1;
  } else if (ch === '"') {
    state.pos++;
    readDoubleQuoted(state, word);
  } else if (ch === '\\') {
    const next = src[state.pos + 1];
    state.pos += 2;
    if (next !== undefined && next !== '\n') word.text += next;
  } else if (ch === '$') {
    readDollar(state, word, false);
  } else if (ch === '`') {
    const end = findBacktickEnd(src, state.pos + 1);
    parseBacktick(state, src.slice(state.pos + 1, end));
    word.dynamic = true;
    state.pos = end + 1;
  } else {
    word.text += ch;
    word.bare += ch;
    state.pos++;
  }
}

function findBacktickEnd(src: string, from: number): number {
  for (let i = from; i < src.length; i++) {
    if (src[i] === '\\') i++;
    else if (src[i] === '`') return i;
  }
  throw new ShellParseError('unterminated backtick');
}

function readDoubleQuoted(state: State, word: WordBuilder): void {
  const { src } = state;
  while (state.pos < src.length) {
    const ch = src[state.pos]!;
    if (ch === '"') {
      state.pos++;
      return;
    }
    if (ch === '\\') {
      const next = src[state.pos + 1];
      state.pos += 2;
      if (next === undefined) break;
      if (next === '\n') continue;
      word.text += DOUBLE_QUOTE_ESCAPES.includes(next) ? next : `\\${next}`;
    } else if (ch === '$') {
      readDollar(state, word, true);
    } else if (ch === '`') {
      const end = findBacktickEnd(src, state.pos + 1);
      parseBacktick(state, src.slice(state.pos + 1, end));
      word.dynamic = true;
      state.pos = end + 1;
    } else {
      word.text += ch;
      state.pos++;
    }
  }
  throw new ShellParseError('unterminated double quote');
}

/** A `$` outside single quotes: command substitution, arithmetic, parameter expansion, ANSI-C string or variable. */
function readDollar(state: State, word: WordBuilder, quoted: boolean): void {
  const { src } = state;
  const next = src[state.pos + 1];
  if (next === '(') {
    word.dynamic = true;
    if (src[state.pos + 2] === '(') {
      const end = skipBalanced(src, state.pos + 1, '(', ')');
      scanExpansions(state, src.slice(state.pos + 3, end - 2));
      state.pos = end;
      return;
    }
    state.pos += 2;
    parseNested(state);
  } else if (next === '{') {
    word.dynamic = true;
    skipParameterExpansion(state, quoted);
  } else if (next === '"' && !quoted) {
    state.pos++;
  } else if (next === "'" && !quoted) {
    const end = findAnsiCEnd(src, state.pos + 2);
    const body = src.slice(state.pos + 2, end);
    word.text += body;
    word.bare += body;
    if (body.includes('\\')) word.dynamic = true;
    state.pos = end + 1;
  } else if (next !== undefined && (NAME_CHAR.test(next) || SPECIAL_PARAMETER.test(next))) {
    word.dynamic = true;
    word.text += '$';
    state.pos++;
  } else {
    word.text += '$';
    state.pos++;
  }
}

function findAnsiCEnd(src: string, from: number): number {
  for (let i = from; i < src.length; i++) {
    if (src[i] === '\\') i++;
    else if (src[i] === "'") return i;
  }
  throw new ShellParseError('unterminated $-quoted string');
}

/** Index after the group that opens at `open`, counting nested pairs and skipping quoted text. */
function skipBalanced(src: string, open: number, left: string, right: string): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i]!;
    if (ch === '\\') i++;
    else if (ch === "'" || ch === '"') {
      const end = ch === "'" ? src.indexOf("'", i + 1) : findDoubleEnd(src, i + 1);
      if (end < 0) throw new ShellParseError('unterminated quote');
      i = end;
    } else if (ch === left) depth++;
    else if (ch === right && --depth === 0) return i + 1;
  }
  throw new ShellParseError('unbalanced parentheses');
}

function findDoubleEnd(src: string, from: number): number {
  for (let i = from; i < src.length; i++) {
    if (src[i] === '\\') i++;
    else if (src[i] === '"') return i;
  }
  return -1;
}

/**
 * Skips `${...}`; command substitutions inside it are found like any other. Inside double quotes a single
 * quote is an ordinary character.
 */
function skipParameterExpansion(state: State, insideDoubleQuotes: boolean): void {
  const { src } = state;
  let depth = 0;
  let i = state.pos + 1;
  for (; i < src.length; i++) {
    const ch = src[i]!;
    if (ch === '\\') i++;
    else if (ch === '$' && src[i + 1] === '(') {
      const inner: State = { src, pos: i + 2, out: state.out, depth: state.depth + 1 };
      parseList(inner, true);
      i = inner.pos - 1;
    } else if (ch === '`') {
      const end = findBacktickEnd(src, i + 1);
      parseBacktick(state, src.slice(i + 1, end));
      i = end;
    } else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) {
      state.pos = i + 1;
      return;
    } else if (ch === "'" && !insideDoubleQuotes) {
      const end = src.indexOf("'", i + 1);
      if (end < 0) throw new ShellParseError('unterminated quote');
      i = end;
    }
  }
  throw new ShellParseError('unterminated parameter expansion');
}
