import { describe, expect, it } from 'vitest';
import { parseShell, ShellParseError } from './parse';

const texts = (source: string): string[][] => parseShell(source).map((command) => command.words.map((word) => word.text));

describe('shell parser', () => {
  it('splits at every command separator', () => {
    expect(texts('a; b && c || d | e & f\ng'), 'separators').toEqual([['a'], ['b'], ['c'], ['d'], ['e'], ['f'], ['g']]);
  });

  it('removes quotes and escapes and joins quoted parts into one word', () => {
    expect(texts(`g'i't "pu"sh a\\ b`), 'quoting').toEqual([['git', 'push', 'a b']]);
  });

  it('finds commands inside substitutions, backticks, subshells and process substitution', () => {
    expect(texts('echo $(git push) `git push` "$(git push)" (git push) <(git push)').filter((words) => words[0] === 'git').length, 'nested git commands').toBe(5);
  });

  it('marks words that depend on variables, globs and brace expansion as dynamic', () => {
    const [command] = parseShell('git $SUB pu* {push,fetch} "${X}" push');
    expect(command?.words.map((word) => word.dynamic), 'dynamic flags').toEqual([false, true, true, true, true, false]);
  });

  it('drops redirections and their targets', () => {
    expect(texts('git push > out.txt 2>&1 < in &> all'), 'redirections').toEqual([['git', 'push']]);
  });

  it('skips a quoted heredoc body and reads the substitutions of an unquoted one', () => {
    expect(texts("cat <<'EOF'\ngit push\nit's\nEOF\nls"), 'quoted body').toEqual([['cat'], ['ls']]);
    expect(texts('cat <<EOF\n$(git push)\nEOF').some((words) => words[0] === 'git'), 'unquoted body substitution').toBe(true);
    expect(texts('git commit -m "$(cat <<\'EOF\'\nmessage with \' quote\nEOF\n)"')[0], 'commit message heredoc').toEqual(['cat']);
  });

  it('ignores comments', () => {
    expect(texts('ls # git push'), 'comment').toEqual([['ls']]);
  });

  it('refuses text it cannot read', () => {
    for (const source of ["echo 'open", 'echo "open', 'echo $(open', 'echo `open']) {
      expect(() => parseShell(source), source).toThrow(ShellParseError);
    }
  });
});

const raw = String.raw;

describe('shell parser: quoting and expansion', () => {
  const dynamicOf = (source: string): boolean[] => parseShell(source)[0]!.words.map((word) => word.dynamic);

  it('keeps a backslash that has no meaning inside double quotes and drops one that has', () => {
    expect(texts(raw`echo "a\"b" "a\$b" "a\nb" "a\\b"`), 'double quote escapes').toEqual([['echo', 'a"b', 'a$b', raw`a\nb`, raw`a\b`]]);
  });

  it('joins a line continuation outside and inside quotes', () => {
    expect(texts('git pu\\\nsh'), 'continuation outside quotes').toEqual([['git', 'push']]);
    expect(texts('echo "a\\\nb"'), 'continuation inside quotes').toEqual([['echo', 'ab']]);
  });

  it('finds commands in backticks inside double quotes and in the body of an unquoted heredoc', () => {
    expect(texts('echo "`git push`"').some((words) => words[0] === 'git'), 'backtick in quotes').toBe(true);
    expect(texts('cat <<EOF\n`git push`\nEOF').some((words) => words[0] === 'git'), 'backtick in heredoc').toBe(true);
  });

  it('reads the commands of a parameter expansion and marks the word dynamic', () => {
    expect(texts('echo ${X:-$(git push)}').some((words) => words[0] === 'git'), 'substitution inside expansion').toBe(true);
    expect(dynamicOf('echo ${X}'), 'expansion is dynamic').toEqual([false, true]);
    expect(dynamicOf("echo ${X:-'a}b'}"), 'quoted brace inside expansion').toEqual([false, true]);
  });

  it('marks arithmetic and special parameters dynamic, and an ANSI-C string only when it holds an escape', () => {
    expect(dynamicOf('echo $((1+2))'), 'arithmetic').toEqual([false, true]);
    expect(dynamicOf('echo $1 $? $@'), 'special parameters').toEqual([false, true, true, true]);
    expect(dynamicOf(raw`echo $'plain' $'a\tb'`), 'ANSI-C').toEqual([false, false, true]);
    expect(texts("echo $'git'"), 'ANSI-C text').toEqual([['echo', 'git']]);
  });

  it('keeps a lone dollar sign as text', () => {
    expect(texts('echo a$ $'), 'lone dollar').toEqual([['echo', 'a$', '$']]);
  });

  it('refuses unbalanced and unterminated forms', () => {
    for (const source of ["echo $'open", 'echo $((1+2', 'echo ${X', "echo ${X:-'open}", 'cat <<"EOF', 'echo `a', 'echo $(echo "open)']) {
      expect(() => parseShell(source), source).toThrow(ShellParseError);
    }
  });

  it('refuses a command that is too long or nested too deeply to read', () => {
    expect(() => parseShell('a'.repeat(100_001)), 'too long').toThrow(/too long/);
    expect(() => parseShell(`${'echo $('.repeat(20)}x${')'.repeat(20)}`), 'too deep').toThrow(/nested too deeply/);
  });
});

describe('shell parser: redirections and heredocs', () => {
  it('drops a here-string and its word and keeps the command', () => {
    expect(texts('git push <<< text'), 'here-string').toEqual([['git', 'push']]);
  });

  it('drops a descriptor number before a redirection but keeps a numeric argument', () => {
    expect(texts('echo 2 >out'), 'argument 2 stays').toEqual([['echo', '2']]);
    expect(texts('echo 2>out'), 'descriptor 2 goes').toEqual([['echo']]);
    expect(texts('git push &>> all'), 'append both').toEqual([['git', 'push']]);
  });

  it('ends a heredoc at its delimiter with leading tabs removed for <<-', () => {
    expect(texts('cat <<-EOF\n\tgit push\n\tEOF\nls'), 'tab stripped heredoc').toEqual([['cat'], ['ls']]);
  });

  it('reads two heredocs of one line and the commands after them', () => {
    expect(texts("cat <<A <<'B'\none\nA\nthree\nB\nls"), 'two bodies').toEqual([['cat'], ['ls']]);
  });

  it('reads a heredoc without a closing delimiter as running to the end', () => {
    expect(texts("cat <<'EOF'\nrest of the text"), 'unclosed body').toEqual([['cat']]);
  });

  it('takes an escaped delimiter as quoting the body, so no substitution in it runs', () => {
    expect(texts('cat <<\\EOF\n$(git push)\nEOF').some((words) => words[0] === 'git'), 'escaped delimiter is quoted').toBe(false);
  });

  it('keeps a redirection without a delimiter from swallowing the next line', () => {
    expect(texts('cat <<\nls'), 'no delimiter').toEqual([['cat'], ['ls']]);
  });

  it('reads the pipe-and operator and subshell parentheses as separators', () => {
    expect(texts('a |& b; (c) ; d'), 'separators').toEqual([['a'], ['b'], ['c'], ['d']]);
  });
});
