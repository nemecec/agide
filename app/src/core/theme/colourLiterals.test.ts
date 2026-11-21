import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkColourLiterals, colourLiteralsIn } from './colourLiterals';

describe('colourLiteralsIn', () => {
  it('finds hex values of every legal length and colour functions', () => {
    const css = 'a { color: #fff; background: #1e1e1e; border-color: #1e1e1e80; box-shadow: 0 0 1px rgb(0 0 0 / 5%); fill: hsl(0 0% 0%); }';
    expect(colourLiteralsIn(css, 'css'), 'literals found').toEqual(['#fff', '#1e1e1e', '#1e1e1e80', 'rgb(', 'hsl(']);
  });

  it('finds colour names in colour properties only', () => {
    expect(colourLiteralsIn('a { color: white; border: 1px solid red; }', 'css'), 'names in colour properties').toEqual(['white', 'red']);
    expect(colourLiteralsIn('.white { content: "red"; font-family: tan; }', 'css'), 'names elsewhere are not colours').toEqual([]);
  });

  it('allows tokens, aliases, color-mix of variables and keywords', () => {
    const css = 'a { color: var(--agide-text-primary); background: color-mix(in srgb, var(--accent) 16%, transparent); border: 1px solid currentColor; }';
    expect(colourLiteralsIn(css, 'css'), 'no literal').toEqual([]);
  });

  it('ignores comments, id selectors that are not hex and HTML entities', () => {
    expect(colourLiteralsIn('/* #fff */ #root { margin: 0 } a::before { content: "&#123;" }', 'css'), 'comment, id selector and entity').toEqual([]);
    expect(colourLiteralsIn("// #fff in a comment\nconst hash = '#pane=tree';", 'code'), 'comment and hash route').toEqual([]);
    expect(colourLiteralsIn("const colour = '#5b7fa6';", 'code'), 'a literal in code').toEqual(['#5b7fa6']);
  });
});

describe('checkColourLiterals', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'agide-colours-'));
    mkdirSync(join(root, 'src', 'renderer', 'testing'), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));
  const write = (file: string, text: string) => writeFileSync(join(root, 'src', 'renderer', file), text);
  const check = (allowlist: string[]) => checkColourLiterals(root, join(root, 'src', 'renderer'), allowlist);

  it('reports a file with a literal that the allowlist does not cover', () => {
    write('a.css', 'a { color: #fff }');
    write('b.css', 'a { color: var(--fg) }');
    expect(check([]).violations, 'violations').toEqual(['src/renderer/a.css: #fff']);
  });

  it('accepts an allowlisted file and reports it as stale once it has no literal', () => {
    write('a.css', 'a { color: #fff }');
    expect(check(['src/renderer/a.css']), 'covered by the allowlist').toEqual({ violations: [], stale: [] });
    write('a.css', 'a { color: var(--fg) }');
    expect(check(['src/renderer/a.css']).stale, 'the allowlist must shrink').toEqual(['src/renderer/a.css']);
  });

  it('skips tests and the testing directory', () => {
    write('a.test.ts', "const x = '#fff';");
    write('testing/data.ts', "const x = '#fff';");
    expect(check([]).violations, 'test files may hold literals').toEqual([]);
  });
});
