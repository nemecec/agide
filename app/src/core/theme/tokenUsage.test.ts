import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { builtinTheme, DEFAULT_APPEARANCE, resolveTheme } from './index';

const RENDERER = fileURLToPath(new URL('../../renderer', import.meta.url));
const SOURCE = /\.(css|tsx?)$/;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return SOURCE.test(name) && !name.includes('.test.') ? [path] : [];
  });
}

function emittedVariables(): Set<string> {
  const names = new Set<string>();
  for (const id of ['agide-light', 'agide-dark', 'system']) {
    const theme = builtinTheme(id);
    if (!theme) throw new Error(`built-in theme ${id} is missing`);
    for (const dark of [false, true]) {
      for (const highContrast of [false, true]) {
        const resolved = resolveTheme({ theme, appearance: { ...DEFAULT_APPEARANCE, dark, highContrast } });
        Object.keys(resolved.variables).forEach((name) => names.add(name));
      }
    }
  }
  return names;
}

describe('token names in the renderer', () => {
  it('reads only --agide-* variables that every built-in theme defines', () => {
    const defined = emittedVariables();
    const unknown: string[] = [];
    for (const file of sources(RENDERER)) {
      for (const match of readFileSync(file, 'utf8').matchAll(/var\((--agide-[A-Za-z0-9-]+)/g)) {
        const name = match[1] ?? '';
        if (!defined.has(name)) unknown.push(`${relative(RENDERER, file)}: ${name}`);
      }
    }
    expect(unknown, 'stylesheet and component reads of --agide-* names that no theme defines').toEqual([]);
  });
});
