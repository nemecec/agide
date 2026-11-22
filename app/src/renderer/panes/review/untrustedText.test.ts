import { describe, expect, it } from 'vitest';

const SOURCES = import.meta.glob<string>(['./*.ts', './*.tsx', '!./untrustedText.test.ts', '../inbox/ReviewCardActions.tsx'], { query: '?raw', import: 'default', eager: true });

describe('untrusted text in the review code', () => {
  it('never writes markup or sets HTML from agent text', () => {
    expect(Object.keys(SOURCES).length, 'the scan reads the review sources').toBeGreaterThan(5);
    const offenders = Object.entries(SOURCES)
      .filter(([, text]) => /dangerouslySetInnerHTML|\.innerHTML|insertAdjacentHTML|document\.write|outerHTML/.test(text))
      .map(([path]) => path);
    expect(offenders, 'files that write markup').toEqual([]);
  });
});
