// Ports one theme of a VS Code extension package (.vsix) or a theme file to an Agide theme file, with the importer
// the app uses. The ported built-in themes of core/theme/builtin come from this script.
// Usage: node scripts/port-vscode-theme.mjs <package-or-file> --label <theme label> --id <id> --name <name> --url <source url> --out <file>
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { loadTs } from './lib/loadTs.mjs';

const args = process.argv.slice(2);
const input = args[0];
const option = (name) => {
  const at = args.indexOf(`--${name}`);
  return at < 0 ? undefined : args[at + 1];
};
if (!input || !option('id') || !option('out')) {
  console.error('usage: node scripts/port-vscode-theme.mjs <package-or-file> --label <label> --id <id> --name <name> --url <url> --out <file>');
  process.exit(2);
}

const { modules, close } = await loadTs(['/src/core/theme/vscode/import.ts']);
const [{ importVsCodeTheme }] = modules;
try {
  const result = importVsCodeTheme({
    bytes: readFileSync(input),
    fileName: basename(input),
    themeLabel: option('label'),
    existingIds: new Set(),
    now: new Date(),
    importer: 'Agide',
    id: option('id'),
    name: option('name'),
    url: option('url'),
    sourceKind: 'builtin',
  });
  if (!result.ok) {
    console.error(JSON.stringify(result.issues, null, 2));
    process.exitCode = 1;
  } else {
    writeFileSync(option('out'), `${JSON.stringify(result.theme, null, 2)}\n`);
    console.log(`wrote ${option('out')}; clamp adjustments: ${result.adjustments.map((a) => `${a.token} ${a.from} to ${a.to}`).join(', ') || 'none'}; warnings: ${result.warnings.length}`);
  }
} finally {
  await close();
}
