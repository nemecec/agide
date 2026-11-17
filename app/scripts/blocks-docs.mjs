// Writes docs/blocks.md from the block manifest and layout schemas.
// Usage: pnpm blocks-docs
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadTs } from './lib/loadTs.mjs';

const DOC = fileURLToPath(new URL('../../docs/blocks.md', import.meta.url));
const { modules, close } = await loadTs(['/src/core/blocks/docs.ts']);
try {
  writeFileSync(DOC, modules[0].renderBlocksMarkdown());
  console.log('wrote docs/blocks.md');
} finally {
  await close();
}
