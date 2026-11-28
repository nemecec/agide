// P70: bundle Monaco into an electron-vite renderer and measure the output.
//
// Usage: node probes/p70_monaco_build.mjs <scratch project> [csp]
//
// The scratch project is a directory outside the repository with monaco-editor, shiki and @shikijs/monaco
// installed (see notes/probes-m8-editor.md). The script copies the renderer sources of probes/p70_monaco_src
// into it, writes one entry per variant, builds each variant with the electron-vite of app/node_modules and
// prints the sizes of the output and a scan for eval and new Function. Nothing is written to the repository.
//
// P70_MINIFY=1 builds with minification (electron-vite leaves the renderer unminified by default);
// P70_VARIANTS=core,shiki limits the variants.
//
// Variants:
//   baseline  an empty renderer (the load cost without an editor)
//   core      the editor API, every editor contribution of editor.main except the language services, the Monarch
//             languages TypeScript, Kotlin, Rust, Java, Python, YAML, Markdown and shell, and the JSON mode
//   full      import * from 'monaco-editor': every Monarch language, the TypeScript, CSS, HTML and JSON services
//   shiki     core without the Monarch languages and the JSON mode, plus shiki (JavaScript regular expression
//             engine) and @shikijs/monaco with the same languages and JSON

import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const scratch = resolve(process.argv[2] ?? '/tmp/agide-editor-design/scratch');
const APP_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:";
const csp = process.argv[3] ?? APP_CSP;
const electronVite = await import(pathToFileURL(join(here, '..', 'app', 'node_modules', 'electron-vite', 'dist', 'index.js')).href);

const MONARCH = ['typescript', 'kotlin', 'rust', 'java', 'python', 'yaml', 'markdown', 'shell'];

/**
 * The non-language imports of editor.main.js, rewritten as file paths in the scratch project (the package's
 * export map adds `.js` to every subpath, so a CSS file cannot be named through it), plus the chosen Monarch languages.
 */
function coreModule() {
  const vs = join(scratch, 'node_modules', 'monaco-editor', 'esm', 'vs');
  const main = readFileSync(join(vs, 'editor', 'editor.main.js'), 'utf8');
  const kept = main
    .split('\n')
    .filter((line) => /^import '/.test(line) && !line.includes('languages/definitions'))
    .map((line) => line.replace(/'(\.\.?\/[^']+)'/, (_, path) => JSON.stringify(join(vs, 'editor', path))));
  const languages = MONARCH.map((language) => `import 'monaco-editor/languages/definitions/${language}/register.js';`);
  return { core: [...kept, ...languages, "import 'monaco-editor/languages/features/json/register.js';", "export * from 'monaco-editor/editor/editor.api.js';", ''].join('\n'), plain: [...kept, "export * from 'monaco-editor/editor/editor.api.js';", ''].join('\n') };
}

const WORKER_SETUP = (workers) => `
const workers = { count: 0, labels: new Set() };
self.MonacoEnvironment = {
  getWorker(_id, label) {
    workers.count += 1;
    workers.labels.add(label);
${workers.map(([label, name]) => `    if (label === '${label}') return new ${name}();`).join('\n')}
    return new EditorWorker();
  },
};
`;

const ENTRIES = {
  baseline: `const startedAt = performance.now();
window.__probe = { done: true, result: { variant: 'baseline', moduleEvaluatedMs: Math.round(startedAt * 10) / 10 } };
`,
  core: `import * as monaco from './monaco-core.js';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import JsonWorker from 'monaco-editor/languages/features/json/json.worker.js?worker';
import { runScenario } from './scenarios.js';
const startedAt = performance.now();
${WORKER_SETUP([['json', 'JsonWorker']])}
runScenario(monaco, { variant: 'core', startedAt, workers });
`,
  full: `import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import JsonWorker from 'monaco-editor/languages/features/json/json.worker.js?worker';
import CssWorker from 'monaco-editor/languages/features/css/css.worker.js?worker';
import HtmlWorker from 'monaco-editor/languages/features/html/html.worker.js?worker';
import TsWorker from 'monaco-editor/languages/features/typescript/ts.worker.js?worker';
import { runScenario } from './scenarios.js';
const startedAt = performance.now();
${WORKER_SETUP([['json', 'JsonWorker'], ['css', 'CssWorker'], ['scss', 'CssWorker'], ['less', 'CssWorker'], ['html', 'HtmlWorker'], ['typescript', 'TsWorker'], ['javascript', 'TsWorker']])}
runScenario(monaco, { variant: 'full', startedAt, workers });
`,
  shiki: `import * as monaco from './monaco-plain.js';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import { createHighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import { shikiToMonaco } from '@shikijs/monaco';
import { runScenario } from './scenarios.js';
const startedAt = performance.now();
${WORKER_SETUP([])}
const setupStart = performance.now();
const highlighter = await createHighlighterCore({
  themes: [import('shiki/themes/github-light.mjs'), import('shiki/themes/github-dark.mjs')],
  langs: [import('shiki/langs/typescript.mjs'), import('shiki/langs/kotlin.mjs'), import('shiki/langs/rust.mjs'), import('shiki/langs/java.mjs'),
          import('shiki/langs/python.mjs'), import('shiki/langs/json.mjs'), import('shiki/langs/yaml.mjs'), import('shiki/langs/markdown.mjs'),
          import('shiki/langs/shellscript.mjs')],
  engine: createJavaScriptRegexEngine(),
});
for (const id of highlighter.getLoadedLanguages()) monaco.languages.register({ id });
shikiToMonaco(highlighter, monaco);
const setupMs = Math.round((performance.now() - setupStart) * 10) / 10;
// The Oniguruma engine needs WebAssembly; under the app's CSP (no 'wasm-unsafe-eval') it should fail.
let wasm;
try {
  const { createOnigurumaEngine } = await import('shiki/engine/oniguruma');
  await createOnigurumaEngine(import('shiki/wasm'));
  wasm = 'loaded';
} catch (error) {
  wasm = 'failed: ' + String(error).slice(0, 160);
}
runScenario(monaco, { variant: 'shiki', startedAt, workers, shiki: { setupMs, themes: ['github-light', 'github-dark'], wasm } });
`,
};

function html(entry) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <title>P70 ${entry}</title>
  </head>
  <body style="margin:0">
    <script type="module" src="./entry-${entry}.js"></script>
  </body>
</html>
`;
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)]));
}

function measure(outDir) {
  const files = walk(outDir).map((file) => {
    const bytes = readFileSync(file);
    const name = relative(outDir, file);
    const kind = /worker/i.test(name) ? 'worker' : name.endsWith('.js') ? 'js' : name.endsWith('.css') ? 'css' : /\.(ttf|woff2?)$/.test(name) ? 'font' : name.endsWith('.wasm') ? 'wasm' : 'other';
    const text = kind === 'js' || kind === 'worker' ? bytes.toString('utf8') : '';
    return {
      name, kind, bytes: bytes.length, gzip: gzipSync(bytes).length,
      evalCalls: (text.match(/(?<![\w$.])eval\(/g) ?? []).length,
      newFunction: (text.match(/new Function\(/g) ?? []).length,
      webAssembly: (text.match(/WebAssembly\.(instantiate|compile)/g) ?? []).length,
    };
  });
  const sum = (list, key) => list.reduce((total, file) => total + file[key], 0);
  const byKind = Object.fromEntries(['js', 'worker', 'css', 'font', 'wasm', 'other'].map((kind) => [kind, sum(files.filter((file) => file.kind === kind), 'bytes')]));
  return { files: files.length, bytes: sum(files, 'bytes'), gzip: sum(files, 'gzip'), byKind, evalCalls: sum(files, 'evalCalls'), newFunction: sum(files, 'newFunction'), webAssembly: sum(files, 'webAssembly'), largest: files.sort((a, b) => b.bytes - a.bytes).slice(0, 6).map((file) => `${file.name} ${Math.round(file.bytes / 1024)} KB`), withEval: files.filter((file) => file.evalCalls + file.newFunction > 0).map((file) => `${file.name}: eval ${file.evalCalls}, new Function ${file.newFunction}`) };
}

const src = join(scratch, 'src');
rmSync(src, { recursive: true, force: true });
mkdirSync(src, { recursive: true });
for (const file of ['samples.js', 'scenarios.js']) cpSync(join(here, 'p70_monaco_src', file), join(src, file));
writeFileSync(join(src, 'monaco-core.js'), coreModule().core);
writeFileSync(join(src, 'monaco-plain.js'), coreModule().plain);

const variants = (process.env.P70_VARIANTS ?? 'baseline,core,full,shiki').split(',');
const results = {};
for (const variant of variants) {
  writeFileSync(join(src, `entry-${variant}.js`), ENTRIES[variant]);
  writeFileSync(join(src, `${variant}.html`), html(variant));
  const minify = process.env.P70_MINIFY === '1';
  const outDir = join(scratch, 'out', minify ? `${variant}-min` : variant);
  rmSync(outDir, { recursive: true, force: true });
  const configFile = join(scratch, `electron.vite.${variant}.config.mjs`);
  writeFileSync(configFile, `export default {
  renderer: {
    root: ${JSON.stringify(src)},
    worker: { format: 'es' },
    build: { outDir: ${JSON.stringify(outDir)}, emptyOutDir: true, minify: ${minify}, reportCompressedSize: false, chunkSizeWarningLimit: 100000, rollupOptions: { input: ${JSON.stringify(join(src, `${variant}.html`))} } },
  },
};
`);
  const started = performance.now();
  await electronVite.build({ configFile, root: scratch, logLevel: 'warn' });
  results[minify ? `${variant}-min` : variant] = { buildSeconds: Math.round((performance.now() - started) / 100) / 10, ...measure(outDir) };
  console.log(variant, minify ? 'minified' : 'as electron-vite builds the renderer (not minified)', JSON.stringify(results[minify ? `${variant}-min` : variant]));
}
writeFileSync(join(scratch, 'out', `p70-sizes${process.env.P70_MINIFY === '1' ? '-min' : ''}.json`), JSON.stringify({ csp, results }, null, 2));
console.log(`sizes written to ${join(scratch, 'out')} (csp: ${csp})`);
