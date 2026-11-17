import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { renderBlocksMarkdown } from './docs';

const DOC = join(import.meta.dirname, '..', '..', '..', '..', 'docs', 'blocks.md');

it('keeps docs/blocks.md equal to what the schemas generate', () => {
  const text = renderBlocksMarkdown();
  expect(text, 'lists the first-party pane types').toContain('`agide/surface-host`');
  if (existsSync(DOC)) expect(readFileSync(DOC, 'utf8'), 'docs/blocks.md is out of date; run pnpm blocks-docs').toBe(text);
});
