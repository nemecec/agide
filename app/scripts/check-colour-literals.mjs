// Fails when a stylesheet or component of the renderer holds a colour literal that the allowlist does not cover,
// or when an allowlisted file holds none any more (the allowlist shrinks as files move to tokens).
// Usage: pnpm check:colours [--list]   (--list prints the files that hold a literal, for writing the allowlist)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadTs } from './lib/loadTs.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ALLOWLIST = fileURLToPath(new URL('./colour-literal-allowlist.json', import.meta.url));

const { modules, close } = await loadTs(['/src/core/theme/colourLiterals.ts']);
const [{ checkColourLiterals }] = modules;
try {
  const allowlist = process.argv.includes('--list') ? [] : JSON.parse(readFileSync(ALLOWLIST, 'utf8')).files;
  const report = checkColourLiterals(ROOT, `${ROOT}src/renderer`, allowlist);
  for (const line of report.violations) console.error(process.argv.includes('--list') ? line : `colour literal: ${line}`);
  for (const file of report.stale) console.error(`not on the allowlist any more: remove ${file}`);
  process.exitCode = report.violations.length > 0 || report.stale.length > 0 ? (process.argv.includes('--list') ? 0 : 1) : 0;
  if (process.exitCode === 0 && !process.argv.includes('--list')) console.log('no colour literal outside the allowlist');
} finally {
  await close();
}
