import { describe, expect, it } from 'vitest';
import { compileGlob, firstMatch, matchesGlob } from './glob';

describe('policy globs', () => {
  it.each([
    ['a name without a slash matches at any depth', 'package.json', 'package.json', true],
    ['a name without a slash matches inside a directory', 'package.json', 'apps/web/package.json', true],
    ['a name without a slash does not match a longer name', 'package.json', 'apps/web/package.json.bak', false],
    ['a leading slash anchors at the root', '/package.json', 'package.json', true],
    ['an anchored name does not match deeper', '/package.json', 'apps/package.json', false],
    ['a leading ./ is dropped', './src/a.ts', 'src/a.ts', true],
    ['a star stays inside one directory', 'src/*.ts', 'src/a.ts', true],
    ['a star does not cross a slash', 'src/*.ts', 'src/deep/a.ts', false],
    ['a double star crosses directories', 'src/**/a.ts', 'src/x/y/a.ts', true],
    ['a double star followed by a slash also matches no directory', 'src/**/a.ts', 'src/a.ts', true],
    ['a trailing double star matches everything below', 'docs/**', 'docs/a/b.md', true],
    ['a trailing double star does not match a sibling', 'docs/**', 'docsx/a.md', false],
    ['a question mark is one character', 'src/?.ts', 'src/a.ts', true],
    ['a question mark is not a slash', 'src?a.ts', 'src/a.ts', false],
    ['braces alternate', '*.{ts,tsx}', 'App.tsx', true],
    ['braces do not match other endings', '*.{ts,tsx}', 'App.js', false],
    ['a dot is a dot', 'a.ts', 'abts', false],
    ['regular expression characters are literal', 'src/(a)+[b].ts', 'src/(a)+[b].ts', true],
    ['a comma outside braces is a comma', 'a,b.ts', 'a,b.ts', true],
    ['a closing brace without an opening one is literal', 'a}.ts', 'a}.ts', true],
    ['an unclosed brace still compiles and matches its first alternative', 'x{a,b', 'xa', true],
  ])('%s', (_name, glob, path, expected) => {
    expect(matchesGlob(path, glob), `${glob} against ${path}`).toBe(expected);
  });

  it('compares case-sensitively unless asked not to', () => {
    expect(matchesGlob('README.MD', '*.md'), 'case-sensitive by default').toBe(false);
    expect(matchesGlob('README.MD', '*.md', true), 'case-insensitive on request').toBe(true);
    expect(compileGlob('*.md'), 'the compiled pattern is reused').toBe(compileGlob('*.md'));
    expect(compileGlob('*.md', true), 'the two modes are different patterns').not.toBe(compileGlob('*.md'));
  });

  it('returns the first glob that matches, or nothing', () => {
    expect(firstMatch('src/a.ts', ['docs/**', 'src/**', '*.ts']), 'the first match in list order').toBe('src/**');
    expect(firstMatch('src/a.ts', ['docs/**']), 'no match').toBeUndefined();
    expect(firstMatch('src/a.ts', []), 'an empty list').toBeUndefined();
  });
});
