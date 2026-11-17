import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const CORE = import.meta.dirname;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

describe('src/core', () => {
  it('imports neither electron nor code from main, preload or renderer', () => {
    const offenders = sourceFiles(CORE).filter((file) =>
      /from ['"](electron|.*\/(main|preload|renderer)\/.*)['"]/.test(readFileSync(file, 'utf8')),
    );
    expect(offenders, 'core files with Electron or app-layer imports').toEqual([]);
  });
});
