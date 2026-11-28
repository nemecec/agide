# Editor probes P70 to P77 (Monaco in the Agide renderer)

Date: 2026-11-28. Run `editor-design` for record 0047. macOS on Apple silicon, Node 22.22.3, the app's own Electron 45.3.3 and electron-vite 6.0.0 (Vite 8.3.8 with Rolldown) from `app/node_modules`. No model was started.

## Method

- A scratch project outside the repository held `monaco-editor` 0.57.0 (released 2026-09-24, the newest release at least two weeks old; 0.58.0 came out 2026-11-23), `shiki` 4.6.0 and `@shikijs/monaco` 4.6.0 (2026-11-02), installed exactly with pnpm from the public registry. Nothing was installed into `app/`. Monaco 0.57.0 depends on `marked` 14.0.0 and `dompurify` 3.4.15 (0.58.0 adds `@vscode/diff`).
- `probes/p70_monaco_build.mjs` copies the renderer sources of `probes/p70_monaco_src/` into the scratch project and builds these variants with electron-vite's `build` API, renderer only, `worker.format: 'es'`, the app's Content-Security-Policy in the page:
  - `baseline`: an empty page;
  - `core`: the editor API with every editor contribution of `editor.main.js` except the language services, the Monarch languages TypeScript, Kotlin, Rust, Java, Python, YAML, Markdown and shell, and the JSON mode with its worker;
  - `full`: `import * as monaco from 'monaco-editor'` (every Monarch language, the TypeScript, CSS, HTML and JSON services and their workers, and the bundled `lsp` client);
  - `shiki`: `core` without the Monarch languages and the JSON mode, plus shiki with the JavaScript regular expression engine, the same languages and JSON, the `github-light` and `github-dark` themes, and `shikiToMonaco`.
  Each variant is built twice: as electron-vite builds the renderer today (not minified; electron-vite sets `minify: false` for the renderer) and with `P70_MINIFY=1`. The script measures the files and scans them for `eval(` and `new Function(`.
- `probes/p71_monaco_run.mjs` starts the app's Electron once per variant and scenario with `probes/p71_monaco_main.cjs`: a hidden window (`show: false`, `backgroundThrottling: false`), the web preferences of the app's main window (`contextIsolation`, `sandbox`, no `nodeIntegration`, no preload), every web permission denied as in `main/window.ts`, every request that is not `file:`, `data:` or `blob:` recorded and cancelled, `--expose-gc` and precise memory information for the heap figures, a fixed environment allow-list. The scenarios are in `probes/p70_monaco_src/scenarios.js`; synthetic source files come from `samples.js`. A hidden window receives no real pointer or key input, so the view zone test dispatches the pointer and mouse events of a click (they bubble through the editor's listeners) and types with `webContents.insertText`.
- Startup, the diff, the models and the leak scenarios ran three times each; the others once. Heaps are `performance.memory.usedJSHeapSize` after `gc()`; the renderer's memory is the working set from `app.getAppMetrics()` at the end of the scenario.

| Probe | Scenario | Question |
|---|---|---|
| P70 | build | Bundle size, workers, eval, what the CSP needs |
| P71 | startup, models | Load cost, time to an editor, memory with one and ten models and a file of 20,000 lines |
| P72 | diff | Diff editor side by side and inline, a view zone hosting a comment thread, resize and scroll, decorations, navigation between hunks |
| P73 | themes | A Monaco theme from the tokens of 0035; CSS variables; the `tokenColors` of a VS Code theme |
| P74 | markdown | Markdown in Monaco for notes; an agent proposal as an inline diff; links; the clipboard |
| P75 | highlight | Monarch against shiki for the languages of the user's projects |
| P76 | leaks | Creation and disposal of editors, models and diff editors in cycles |
| P77 | all | What a renderer with context isolation and no Node integration needs; requests and CSP violations over every run |

## Results

### P70 bundle

Bytes of the output (gzip in brackets). The app's renderer today is 2.96 MB of JavaScript and 0.25 MB of CSS, not minified.

| Variant | As built today (not minified) | Minified | Of which workers (minified) | Files |
|---|---|---|---|---|
| baseline | 635 B | 510 B | none | 2 |
| core | 9.29 MB (1.93 MB) | 5.08 MB (1.35 MB) | 0.74 MB: editor worker 0.30 MB, JSON worker 0.42 MB | 15 |
| full | 24.39 MB (4.71 MB) | 14.32 MB (3.44 MB) | 9.49 MB: TypeScript worker 6.77 MB, CSS 1.05 MB, HTML 0.73 MB, JSON, editor | 96 |
| shiki | 9.33 MB (2.01 MB) | 5.40 MB (1.47 MB) | 0.30 MB: editor worker only | 18 |

- The minified `core` variant is 4.02 MB of JavaScript (one chunk of 3.86 MB plus lazily loaded language chunks), 0.17 MB of CSS and the codicon font of 0.15 MB.
- `shiki` adds about 0.3 MB minified for the grammars, the themes and the JavaScript engine of the variant against `core` without the JSON worker; the 0.21 MB `wasm` chunk in it is the Oniguruma engine the probe tried to load, which an app without it does not ship.
- No `new Function(` in any variant. The one `eval(` hit is in the TypeScript worker of `full`: it is the text `eval(x: string)` of the TypeScript library declarations, not a call.
- Build time 0.5 to 2.2 s per variant.

### P71 startup and memory

Three runs each; ranges.

| Variant | Page load (main process) | Module evaluation done | `editor.create` | First render | Tokenized render | JS heap | Renderer working set |
|---|---|---|---|---|---|---|---|
| baseline | 31 to 39 ms | 30 to 39 ms | | | | | 82 MB |
| core | 204 to 215 ms | 134 to 144 ms | 48 ms | 82 to 84 ms | 94 to 99 ms | 21 MB | 177 to 182 MB |
| core, minified | 185 to 196 ms | 120 to 129 ms | 45 to 46 ms | 70 to 79 ms | 78 to 89 ms | 18 MB | 168 to 171 MB |
| full | 205 to 241 ms | 136 to 173 ms | 46 to 49 ms | 73 to 80 ms | 82 to 100 ms | 22 MB | 200 to 216 MB |
| shiki | 145 to 193 ms | 144 to 192 ms | 38 to 39 ms | 68 to 70 ms | 218 to 223 ms | 31 MB | 208 MB |

Times from `editor.create` are for a TypeScript file of 200 lines in a 1000 by 700 px host. "Module evaluation done" includes parsing Monaco, so a lazy `import()` on the first open of an editor moves about 100 ms of it off the app's start.

Memory with models (core, three runs, the same within 0.2 MB):

| Step | JS heap after GC |
|---|---|
| Monaco loaded, no editor | 14.5 MB |
| One editor, no model | 16.0 MB |
| One TypeScript model of 2,000 lines shown | 20.8 MB |
| Ten models of 2,000 lines (nine languages), each shown once | 42.5 MB |
| A TypeScript model of 20,008 lines (1.0 MB of text) created and shown | 37.4 MB |
| Every model and the editor disposed | 25.1 MB |

The 20,000-line model: created in 4.7 ms, shown in 30 to 33 ms, revealing its last line 8 to 19 ms, fifty single-character edits in the middle 10 to 14 ms. The renderer's working set at the end of the scenario was 265 MB. No model or editor was left after disposal.

### P72 diff editor and view zones

| Check | Result |
|---|---|
| Diff of a 2,000-line TypeScript file with 30 changes (changed, inserted, removed lines in turn) | 89 to 91 ms to the first `onDidUpdateDiff`, including the start of the editor worker; 30 line changes |
| Diff of 20,008 lines with 200 changes | 97 to 119 ms; 200 line changes |
| Where the diff runs | in the editor worker (one worker, label `editorWorkerService`); no fallback to the main thread, no console warning |
| A view zone with a DOM node (text and a `textarea`) after a changed line, 90 px | the node is in the DOM, 90 px high, its top at the bottom of its line (0 px apart) |
| The other side | the diff editor adds a 90 px spacer on the original side, so both sides stay aligned |
| Scroll by 120 px | the zone moves by 120 px; the original side scrolls with it |
| Resize to 700 by 500 | the zone stays; the diff switches to inline by itself below 900 px (`useInlineViewWhenSpaceIsLimited`, the original editor 36 px wide) |
| Inline mode (`renderSideBySide: false`) | the zone stays on the modified editor, 90 px, at the bottom of its line |
| Click into the zone's `textarea` | not prevented; the `textarea` takes focus and the editor has no text focus; `insertText` puts "hi" into the `textarea`; the model is unchanged and the cursor did not move |
| The same zone with `suppressMouseDown: true` | the click is prevented and the `textarea` does not get focus |
| Backspace, Delete, ArrowDown and Cmd+Z dispatched in the zone's `textarea` | the model is unchanged; focus stays in the `textarea`. This check cannot fail: the diff editor is read-only and the synthetic events carry no key code, so Monaco reads them as an unknown key. The review's check with key codes found that keys typed in a zone do reach the editor (section "Review rerun") |
| Decorations: a whole-line class on the commented line, a line-decoration class in the gutter for comment and seen marks | rendered on every decorated visible line |
| `diffEditor.goToDiff('next')` from line 1, five times | lines 65, 129, 195, 258, 322 against change starts 65, 129, 194, 258, 322 (for removed lines it goes to the line after the removal) |
| `hideUnchangedRegions` with three context lines | scroll height 5,494 px against 36,234 px for the whole file |

### P73 themes

| Check | Result |
|---|---|
| `defineTheme` with the Agide Light token values as `colors` (hex) | accepted; `setTheme` 23 to 25 ms; the editor background is the token's value |
| `defineTheme` with `editor.background: var(--agide-surface-content)` | refused: "Illegal value for token color: var(--agide-surface-content)". Monaco needs resolved colour values, so the theme must be built from the resolved tokens at run time and rebuilt on a theme change |
| The `tokenColors` of a VS Code theme turned into Monaco rules by scope name (18 rules, 8 colours) over Monarch TypeScript | 4 distinct colours rendered: Monarch token names (`keyword.ts`, `string.ts`, `type.identifier.ts`, `comment.doc.ts`, `regexp.ts`, `delimiter.bracket.ts` and so on) match only some TextMate scope prefixes |
| Monarch TypeScript with the built-in `vs` theme | 10 distinct colours |
| shiki with `github-light` (a VS Code theme) through `@shikijs/monaco` | 7 distinct colours, the theme's own |

### P74 Markdown and proposals

| Check | Result |
|---|---|
| Monarch Markdown token types | `keyword.md` (headings), `emphasis.md`, `strong.md`, `string.link.md`, `string.md`, `variable.md` |
| `wordWrap: 'on'`, `lineNumbers: 'off'`, `links: false` | wrap works; the link option reads back off (no link detection, no click to open) |
| An agent proposal (one edited line, one appended section) as an inline diff with word wrap | 48 to 53 ms; two changes: one line with a character-level change, one insertion of four lines; the removed text renders inline |
| `renderMarginRevertIcon` | no revert icon in the DOM without hover; not used by the design |
| `monaco.editor.registerLinkOpener`, `registerEditorOpener` | both exist, so a link or a go-to-definition can be routed through the app |
| `navigator.clipboard.readText()` | refused ("Document is not focused" in the hidden window); the app's permission handler denies clipboard reads in any case, so Monaco's context-menu Paste cannot work; keyboard paste uses the native paste event (not verified in a hidden window) |

### P75 Monarch against shiki

Time of `monaco.editor.tokenize` over a file of about 2,000 lines per language, after the language was loaded and warmed with one call; one run each (the shiki TypeScript figure matched in two runs).

| Language | Monarch | shiki (JavaScript engine) | Monarch token types | shiki token types |
|---|---|---|---|---|
| TypeScript | 13.7 ms | 220 to 224 ms | 16 | 7 |
| Kotlin | 7.4 ms | 18.5 to 19.1 ms | 18 | 6 |
| Rust | 8.4 ms | 25.5 to 26.1 ms | 15 | 6 |
| Java | 8.7 ms | 54 to 56 ms | 20 | 7 |
| Python | 6.4 ms | 34 to 36 ms | 12 | 7 |
| JSON | 6.1 ms (JSON mode) | 55 ms | 9 | 3 |
| YAML | 6.5 ms | 15 to 16 ms | 9 | 6 |
| Markdown | 7.5 ms | 39 to 43 ms | 11 | 9 |
| shell | 5.3 ms | 36 to 37 ms | 15 | 6 |

- shiki's token types are colour classes of the theme, so fewer types do not mean less detail; the colours follow the VS Code theme as authored (P73).
- shiki's highlighter setup took 26 to 27 ms; its first tokenized render of 200 lines of TypeScript took about 220 ms against about 95 ms with Monarch.
- The Oniguruma engine (WebAssembly) fails under the app's CSP: "WebAssembly.instantiate(): Compiling or instantiating WebAssembly module violates the following Content Security policy directive because 'unsafe-eval' ..." and a `script-src` violation with blocked URI `wasm-eval`. shiki's JavaScript engine works without any CSP change.
- Monaco tokenizes the visible lines first and the rest in the background in time slices, so these totals are background work spread over idle time, not a block.

### P76 disposal and leaks

Twenty cycles of: an editor with ten models shown in turn, a diff editor of 500 lines with a view zone, then `dispose()` of both editors and every model and removal of the host elements.

| After cycle | JS heap after GC (three runs) | DOM elements in the page |
|---|---|---|
| 5 | 23.7 to 39.7 MB | 16 |
| 10 | 33.1 to 37.1 MB | 16 |
| 15 | 30.2 MB | 16 |
| 20 | 31.1 MB | 16 |

No model, editor or diff editor was left (`getModels`, `getEditors`, `getDiffEditors` all empty). The heap settles at about 30 MB and does not grow from cycle 15 to 20; the DOM does not grow. The models scenario left the heap at 25 MB after disposal against 14.5 MB before the first editor (caches that Monaco keeps for the page, such as loaded languages and the worker proxy).

### P77 sandbox, CSP and requests

- Every run used the app's CSP unchanged (`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:`) and the app's web preferences. Monaco ran with no CSP violation in the `core` and `full` variants; the only violations were the probe's deliberate WebAssembly load in `shiki`.
- Module workers loaded from `file:` URLs under `script-src 'self'`; `worker-src` falls back to it. No `blob:` worker was used (Vite's `?worker` without `inline`).
- Monaco injects its theme rules and some layout styles as `<style>` elements; the app's `style-src 'unsafe-inline'` allows them. A CSP without it was not tried.
- No request left `file:`, `data:` or `blob:` in any run, and no permission was requested.
- With no preload, `globalThis.require`, `globalThis.process` and `globalThis.module` are undefined in the page. A bare `require('fs')` in bundled renderer code is rewritten by Vite to its empty browser stub, so a probe must read such globals through `globalThis`.

## Effects on the design (0047)

1. Monaco 0.57.0 exactly, the `core` set: editor contributions without the language services, Monarch languages, the JSON mode, the editor and JSON workers. The TypeScript, CSS and HTML services stay out of the slice (6.8 MB of TypeScript worker alone, minified).
2. Load Monaco with a dynamic `import()` on the first open of any editor, in one chunk shared by the note editor, the file editor and the review; the app's start stays as it is. Turning on minification for the renderer build saves about 4 MB of the 9.3 MB.
3. Keep the CSP; add `worker-src 'self'` explicitly so a later change of `script-src` cannot widen or break workers; never add `'unsafe-eval'` or `'wasm-unsafe-eval'`; no inline or `blob:` workers.
4. Build the Monaco theme from the resolved token values on each theme change (CSS variables are refused).
5. Highlight with Monarch in the slice (fast, built in, no WebAssembly). shiki with its JavaScript engine is the path when imported VS Code themes must colour code as authored; it costs about 0.3 MB and up to 16 times the tokenizing time for TypeScript.
6. Comment threads live in view zones whose DOM node is a React portal, without `suppressMouseDown`; the zone node stops the propagation of `keydown` events from its inputs, since without that the editor's keybindings act on keys typed in a thread (review rerun). Seen and comment marks are line decorations. Navigation uses `goToDiff`, and the diff collapses unchanged regions.
7. A diff of 20,000 lines takes about 0.1 s in the worker, so the review can show whole files on both sides. The full texts come from the git objects of the base and the checkpoint.
8. Every editor, diff editor and model is disposed by its owner; the leak probe shows no growth when that holds.
9. Monaco's context menu is replaced by the app's menu (clipboard reads are denied); link detection is off and links route through `registerLinkOpener`.

## Review rerun

The independent review (`docs/measurements/review-editor-design.md`) installed the same exact versions into its own scratch project outside the repository and ran the same scripts on the same machine.

| Check | Design run | Review rerun |
|---|---|---|
| P70 sizes, every variant, unminified and minified | as in the P70 table | the same to the byte (core 9.29 MB and 5.08 MB, full 24.39 MB and 14.32 MB, shiki 9.33 MB and 5.40 MB, the same file counts); no `eval` or `new Function` call in the core output |
| P71 startup, core (three runs) | load 204 to 215 ms, module evaluation 134 to 144 ms | load 187 to 208 ms, module evaluation 126 to 138 ms, `editor.create` 42 to 44 ms, tokenized render 73 to 94 ms; working set 173 to 176 MB against 82 MB for the empty page |
| P71 startup, core minified (three runs) | module evaluation 120 to 129 ms | 111 to 114 ms; working set 169 to 174 MB |
| P71 models (one run) | heaps 14.5, 20.8, 42.5, 37.4 and 25.1 MB | 14.5, 20.8, 42.4, 36.7 and 24.6 MB; no model or editor left |
| P76 leaks (one run) | the heap settles at about 30 MB | 39.6, 37.2, 30.2 and 31.2 MB after cycles 5 to 20; 16 DOM elements throughout; nothing left |
| P72 diff (three runs) | 2,000 lines 89 to 91 ms, 20,000 lines 97 to 119 ms | 78 to 131 ms (the first run cold) and 92 to 101 ms; every view zone, decoration, focus, inline, collapse and `goToDiff` figure identical |
| Every Monarch language registered (minified) | not measured | 5.43 MB in 88 files against 5.08 MB in 15; the main chunk grows from 3.86 MB to 3.94 MB, the rest are lazily loaded tokenizers |
| Keys in a view zone, with key codes on the synthetic events | not measured (see the P72 row) | in a writable editor with a zone holding a `textarea`: J (bound with `addCommand`) and K (bound with `addAction` and the context `editorTextFocus`) fired from the zone's `textarea` with the default prevented, and Backspace or Delete changed the model while the `textarea` kept focus; in the read-only diff editor a J binding fired from a zone too. With a `keydown` listener on the zone node that stops the propagation of events from its inputs, no binding fired, the model stayed unchanged and inserted text reached the `textarea`. Synthetic events, two runs; real key input not tried |

## Not verified

- The renderer in `electron-vite dev` (served over `http://localhost`), and a CSP without `'unsafe-inline'` for styles.
- Real pointer and keyboard input (hidden windows only); IME composition in a zone `textarea`; screen readers and the accessible diff viewer.
- Keyboard paste and copy in a focused window.
- Monaco 0.58.0 and later; the bundled `lsp` client; `monaco-languageclient`.
- Files with very long lines (minified bundles), binary-looking text, mixed line endings in the diff editor.
- Memory with many diff editors open at once, and over hours of use.
- shiki with the user's imported themes, and its tokenizing in a worker.

## Scripts

`probes/p70_monaco_build.mjs`, `probes/p70_monaco_src/samples.js`, `probes/p70_monaco_src/scenarios.js`, `probes/p71_monaco_main.cjs`, `probes/p71_monaco_run.mjs`. Usage:

```
node probes/p70_monaco_build.mjs <scratch project>            # not minified
P70_MINIFY=1 node probes/p70_monaco_build.mjs <scratch project>
node probes/p71_monaco_run.mjs <scratch project> core:diff core-min:startup --repeat 3
```

The scratch project needs a `package.json` with `monaco-editor` 0.57.0, `shiki` 4.6.0 and `@shikijs/monaco` 4.6.0 installed by `pnpm install`. The evidence files (`out/` and `results/` of the scratch project) were not kept.
