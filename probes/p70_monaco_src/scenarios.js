// Scenarios of the editor probes P71 to P76, run inside a sandboxed Electron renderer (context isolation on,
// no Node integration) by p71_monaco_run.mjs. Each scenario returns a plain object; the runner reads it from
// `window.__probe`. Times are milliseconds from performance.now().

import { LANGUAGES, mutate, sample } from './samples.js';

const violations = [];
document.addEventListener('securitypolicyviolation', (event) => violations.push({ directive: event.violatedDirective, blocked: event.blockedURI, sample: event.sample }));

const frames = (count = 2) => new Promise((resolve) => {
  const step = (left) => (left === 0 ? resolve() : requestAnimationFrame(() => step(left - 1)));
  step(count);
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const heapMb = () => {
  if (typeof globalThis.gc === 'function') globalThis.gc();
  return performance.memory ? Math.round((performance.memory.usedJSHeapSize / 1048576) * 10) / 10 : null;
};
const round = (value) => Math.round(value * 10) / 10;

/** Monarch languages load on first use; a model of each language starts the load, and the probe waits until tokenize gives more than one token type. */
async function loadLanguages(monaco, ids) {
  const models = ids.map((id) => monaco.editor.createModel('const x = 1; // a', id));
  const until = performance.now() + 3000;
  for (const id of ids) {
    while (new Set(monaco.editor.tokenize('const x = "a"; // b\n# h', id).flat().map((token) => token.type)).size < 2 && performance.now() < until) await sleep(20);
  }
  for (const model of models) model.dispose();
}

function host(width = 1000, height = 700) {
  const element = document.createElement('div');
  element.style.cssText = `width:${width}px;height:${height}px;position:relative`;
  document.body.appendChild(element);
  return element;
}

// Agide Light values of 0035 section 1.1, as the theme store would resolve them at run time.
const AGIDE_LIGHT = {
  'surface.content': '#ffffff', 'text.primary': '#1d1d1f', 'text.tertiary': '#62626a', 'selection': '#dbe7f8',
  'selection.inactive': '#e6e6ea', 'accent.text': '#0058c2', 'success.bg': '#e8f3eb', 'danger.bg': '#fceceb',
  'warning.bg': '#fcf1de', 'info.fg': '#0058c2', 'border.subtle': '#e5e5ea', 'surface.inset': '#f5f5f7',
};

/** A Monaco theme from resolved token values (0047 section 4.6): only `colors`, no token rules beyond the base. */
export function themeFromTokens(tokens, base) {
  return {
    base, inherit: true, rules: [],
    colors: {
      'editor.background': tokens['surface.content'], 'editor.foreground': tokens['text.primary'],
      'editorLineNumber.foreground': tokens['text.tertiary'], 'editor.selectionBackground': tokens['selection'],
      'editor.inactiveSelectionBackground': tokens['selection.inactive'], 'editorCursor.foreground': tokens['accent.text'],
      'diffEditor.insertedLineBackground': tokens['success.bg'], 'diffEditor.removedLineBackground': tokens['danger.bg'],
      'editor.findMatchHighlightBackground': tokens['warning.bg'], 'editorGutter.background': tokens['surface.content'],
      'editorWidget.background': tokens['surface.inset'], 'editorWidget.border': tokens['border.subtle'],
    },
  };
}

// A small VS Code colour theme written for the probe (not copied from a published theme).
const VSCODE_THEME = {
  name: 'probe-light', type: 'light',
  colors: { 'editor.background': '#fbfbfb', 'editor.foreground': '#202020' },
  tokenColors: [
    { scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: '#6a737d', fontStyle: 'italic' } },
    { scope: ['keyword', 'storage.type', 'storage.modifier', 'keyword.control'], settings: { foreground: '#d73a49' } },
    { scope: ['string', 'string.quoted', 'string.template'], settings: { foreground: '#032f62' } },
    { scope: ['constant.numeric', 'constant.language'], settings: { foreground: '#005cc5' } },
    { scope: ['entity.name.type', 'entity.name.class', 'support.type'], settings: { foreground: '#6f42c1' } },
    { scope: ['entity.name.function', 'support.function'], settings: { foreground: '#795e26' } },
    { scope: ['variable.parameter'], settings: { foreground: '#e36209' } },
    { scope: ['string.regexp'], settings: { foreground: '#22863a' } },
  ],
};

/** The tokenColors of a VS Code theme as Monaco rules: each scope becomes a token prefix (what a Monarch theme can take). */
export function rulesFromTokenColors(theme) {
  return theme.tokenColors.flatMap((entry) => [entry.scope].flat().map((scope) => ({
    token: scope, foreground: entry.settings.foreground?.replace('#', ''), fontStyle: entry.settings.fontStyle,
  })));
}

async function startup(monaco, { startedAt }) {
  const element = host();
  const created = performance.now();
  const editor = monaco.editor.create(element, { value: sample('typescript', 200), language: 'typescript', automaticLayout: false });
  const afterCreate = performance.now();
  await frames(3);
  const rendered = performance.now();
  const until = performance.now() + 3000;
  while (element.querySelectorAll('.view-line span span').length < 200 && performance.now() < until) await frames(1);
  const tokenized = performance.now();
  return {
    moduleEvaluatedMs: round(startedAt), createMs: round(afterCreate - created), firstRenderMs: round(rendered - created), tokenizedRenderMs: round(tokenized - created),
    viewLines: element.querySelectorAll('.view-line').length, tokenSpans: element.querySelectorAll('.view-line span span').length,
    heapMb: heapMb(), // Read through globalThis: a bare `require` in bundled code is rewritten by the bundler to its own stub.
    nodeGlobals: { require: typeof globalThis['require'], process: typeof globalThis['process'], module: typeof globalThis['module'] },
    editors: monaco.editor.getEditors().length,
    disposed: (editor.dispose(), monaco.editor.getEditors().length),
  };
}

async function models(monaco) {
  const result = { baselineHeapMb: heapMb() };
  const element = host();
  const editor = monaco.editor.create(element, { automaticLayout: false });
  result.editorHeapMb = heapMb();
  const one = monaco.editor.createModel(sample('typescript', 2000), 'typescript', monaco.Uri.parse('inmemory://p/one.ts'));
  editor.setModel(one);
  await frames();
  result.oneModelHeapMb = heapMb();
  const ten = [one];
  for (let index = 1; index < 10; index += 1) ten.push(monaco.editor.createModel(sample(LANGUAGES[index % LANGUAGES.length], 2000), LANGUAGES[index % LANGUAGES.length], monaco.Uri.parse(`inmemory://p/m${index}`)));
  for (const model of ten) { editor.setModel(model); await frames(1); }
  result.tenModelsHeapMb = heapMb();
  const bigText = sample('typescript', 20000);
  let started = performance.now();
  const big = monaco.editor.createModel(bigText, 'typescript', monaco.Uri.parse('inmemory://p/big.ts'));
  result.bigModelCreateMs = round(performance.now() - started);
  started = performance.now();
  editor.setModel(big);
  await frames();
  result.bigModelShowMs = round(performance.now() - started);
  result.bigLines = big.getLineCount();
  result.bigChars = bigText.length;
  started = performance.now();
  editor.revealLine(big.getLineCount());
  await frames();
  result.bigRevealEndMs = round(performance.now() - started);
  started = performance.now();
  for (let index = 0; index < 50; index += 1) big.pushEditOperations([], [{ range: new monaco.Range(10000 + index, 1, 10000 + index, 1), text: 'x' }], () => null);
  result.bigFiftyEditsMs = round(performance.now() - started);
  result.withBigHeapMb = heapMb();
  for (const model of [...ten, big]) model.dispose();
  editor.dispose();
  element.remove();
  await frames();
  result.afterDisposeHeapMb = heapMb();
  result.modelsLeft = monaco.editor.getModels().length;
  result.editorsLeft = monaco.editor.getEditors().length;
  return result;
}

async function leaks(monaco) {
  const heaps = [];
  const nodes = [];
  for (let cycle = 0; cycle < 20; cycle += 1) {
    const element = host();
    const editor = monaco.editor.create(element, { automaticLayout: true });
    const list = [];
    for (let index = 0; index < 10; index += 1) list.push(monaco.editor.createModel(sample('typescript', 300), 'typescript'));
    for (const model of list) editor.setModel(model);
    const diffHost = host();
    const diff = monaco.editor.createDiffEditor(diffHost, { automaticLayout: true });
    const original = monaco.editor.createModel(sample('typescript', 500), 'typescript');
    const modified = monaco.editor.createModel(mutate(sample('typescript', 500), 10), 'typescript');
    diff.setModel({ original, modified });
    await new Promise((resolve) => { const sub = diff.onDidUpdateDiff(() => { sub.dispose(); resolve(); }); setTimeout(resolve, 3000); });
    const node = document.createElement('div');
    node.textContent = 'zone';
    diff.getModifiedEditor().changeViewZones((accessor) => accessor.addZone({ afterLineNumber: 5, heightInPx: 60, domNode: node }));
    diff.dispose();
    editor.dispose();
    for (const model of [...list, original, modified]) model.dispose();
    element.remove();
    diffHost.remove();
    if (cycle % 5 === 4) {
      await sleep(50);
      heaps.push(heapMb());
      nodes.push(document.getElementsByTagName('*').length);
    }
  }
  return { heapsEveryFiveCycles: heaps, domNodesEveryFiveCycles: nodes, modelsLeft: monaco.editor.getModels().length, editorsLeft: monaco.editor.getEditors().length, diffEditorsLeft: monaco.editor.getDiffEditors().length };
}

async function diffScenario(monaco, { workers }) {
  const result = {};
  const element = host(1200, 700);
  const diff = monaco.editor.createDiffEditor(element, { automaticLayout: false, readOnly: true, renderSideBySide: true, glyphMargin: true });
  const originalText = sample('typescript', 2000);
  const original = monaco.editor.createModel(originalText, 'typescript', monaco.Uri.parse('inmemory://base/a.ts'));
  const modified = monaco.editor.createModel(mutate(originalText, 30), 'typescript', monaco.Uri.parse('inmemory://checkpoint/a.ts'));
  let started = performance.now();
  const updated = new Promise((resolve) => { const sub = diff.onDidUpdateDiff(() => { sub.dispose(); resolve(); }); });
  diff.setModel({ original, modified });
  await updated;
  result.diff2000Ms = round(performance.now() - started);
  const changes = diff.getLineChanges() ?? [];
  result.lineChanges = changes.length;
  result.workersCreated = workers.count;
  result.workerLabels = [...workers.labels];
  await frames();

  const me = diff.getModifiedEditor();
  const oe = diff.getOriginalEditor();
  const anchorLine = changes[2]?.modifiedEndLineNumber || changes[2]?.modifiedStartLineNumber || 50;
  me.revealLineInCenter(anchorLine);
  await frames();
  const originalTopBefore = oe.getTopForLineNumber(changes[2]?.originalEndLineNumber || anchorLine + 1);

  // A comment thread: a DOM node with a textarea inside a view zone after the commented line.
  const thread = document.createElement('div');
  thread.className = 'probe-thread';
  thread.style.cssText = 'box-sizing:border-box;padding:4px;height:100%;background:#eef';
  const textarea = document.createElement('textarea');
  textarea.className = 'probe-thread-input';
  textarea.style.cssText = 'width:300px;height:40px';
  thread.append('Thread on line ' + anchorLine, textarea);
  let zoneId;
  const tops = [];
  me.changeViewZones((accessor) => {
    zoneId = accessor.addZone({ afterLineNumber: anchorLine, heightInPx: 90, domNode: thread, onDomNodeTop: (top) => tops.push(top) });
  });
  await frames(3);
  const zoneRect = () => thread.getBoundingClientRect();
  const lineTopInPage = (line) => me.getDomNode().getBoundingClientRect().top + me.getTopForLineNumber(line) - me.getScrollTop();
  result.zone = {
    connected: thread.isConnected,
    height: round(zoneRect().height),
    gapToNextLine: round(lineTopInPage(anchorLine + 1) - zoneRect().bottom),
    gapToOwnLineBottom: round(zoneRect().top - (lineTopInPage(anchorLine) + me.getOption(monaco.editor.EditorOption.lineHeight))),
    originalSideShiftedPx: round(oe.getTopForLineNumber(changes[2]?.originalEndLineNumber || anchorLine + 1) - originalTopBefore),
  };
  const scrollBefore = zoneRect().top;
  me.setScrollTop(me.getScrollTop() + 120);
  await frames(2);
  result.zone.movedOnScrollPx = round(scrollBefore - zoneRect().top);
  result.zone.originalScrollFollows = round(oe.getScrollTop() - me.getScrollTop());
  diff.layout({ width: 700, height: 500 });
  await frames(3);
  me.revealLineInCenter(anchorLine);
  await frames(3);
  result.zone.afterResize = { connected: thread.isConnected, height: round(zoneRect().height), originalWidth: oe.getLayoutInfo().width, modifiedWidth: me.getLayoutInfo().width };
  diff.layout({ width: 1200, height: 700 });
  await frames(3);

  // Decorations for seen and commented lines.
  const decorations = me.createDecorationsCollection([
    { range: new monaco.Range(anchorLine, 1, anchorLine, 1), options: { isWholeLine: true, className: 'probe-commented-line', linesDecorationsClassName: 'probe-comment-gutter' } },
    { range: new monaco.Range(anchorLine - 3, 1, anchorLine - 1, 1), options: { isWholeLine: true, linesDecorationsClassName: 'probe-seen-gutter' } },
  ]);
  await frames(2);
  result.decorations = { commentedLine: element.querySelectorAll('.probe-commented-line').length, commentGutter: element.querySelectorAll('.probe-comment-gutter').length, seenGutter: element.querySelectorAll('.probe-seen-gutter').length };

  // Focus and typing in the thread's textarea. A hidden window receives no real pointer or key input, so the
  // probe dispatches the pointer and mouse events of a click on the textarea (they bubble through the editor's
  // listeners), focuses it as the browser would, and the runner types with webContents.insertText.
  result.cursorBeforeTyping = me.getPosition()?.lineNumber ?? null;
  const click = (target) => {
    const box = target.getBoundingClientRect();
    const init = { bubbles: true, cancelable: true, clientX: box.left + 5, clientY: box.top + 5, button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse', isPrimary: true };
    const down = new PointerEvent('pointerdown', init);
    const mouse = new MouseEvent('mousedown', init);
    target.dispatchEvent(down);
    target.dispatchEvent(mouse);
    if (!down.defaultPrevented && !mouse.defaultPrevented) target.focus();
    target.dispatchEvent(new PointerEvent('pointerup', init));
    target.dispatchEvent(new MouseEvent('mouseup', init));
    target.dispatchEvent(new MouseEvent('click', init));
    return { prevented: down.defaultPrevented || mouse.defaultPrevented };
  };
  const clicked = click(textarea);
  await frames(2);
  result.clickInZone = { ...clicked, activeIsTextarea: document.activeElement === textarea, editorHasTextFocus: me.hasTextFocus() };
  window.__probe.request = { kind: 'insert-text', text: 'hi' };
  await new Promise((resolve) => { window.__probeTyped = resolve; });
  await frames(2);
  result.typing = { value: textarea.value, activeIsTextarea: document.activeElement === textarea, modifiedUnchanged: modified.getValue() === mutate(originalText, 30), cursorAfter: me.getPosition()?.lineNumber ?? null };
  // The same with suppressMouseDown on a second zone.
  const second = document.createElement('div');
  const secondInput = document.createElement('textarea');
  second.append(secondInput);
  let secondId;
  me.changeViewZones((accessor) => { secondId = accessor.addZone({ afterLineNumber: anchorLine + 2, heightInPx: 60, domNode: second, suppressMouseDown: true }); });
  await frames(2);
  result.clickInSuppressedZone = { ...click(secondInput), activeIsInput: document.activeElement === secondInput };
  me.changeViewZones((accessor) => accessor.removeZone(secondId));
  // Keys typed in the zone must not reach the editor's keybindings (Delete, Cmd+Z, arrows).
  const keyTarget = textarea;
  textarea.focus();
  const before = modified.getValue();
  for (const key of ['Backspace', 'Delete', 'ArrowDown']) keyTarget.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true, cancelable: true }));
  keyTarget.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', metaKey: true, bubbles: true, cancelable: true }));
  await frames(1);
  result.keysInZone = { modelUnchanged: modified.getValue() === before, activeIsTextarea: document.activeElement === textarea };

  // Navigation between hunks.
  result.hasGoToDiff = typeof diff.goToDiff === 'function';
  const visited = [];
  me.setPosition({ lineNumber: 1, column: 1 });
  for (let index = 0; index < 5; index += 1) { diff.goToDiff('next'); visited.push(me.getPosition()?.lineNumber); }
  result.goToDiffNext = visited;
  result.firstChangeStarts = changes.slice(0, 5).map((change) => change.modifiedStartLineNumber || change.modifiedEndLineNumber);
  result.diffActions = me.getSupportedActions().map((action) => action.id).filter((id) => /diff|Diff/.test(id));

  // Inline mode keeps the zone on the modified editor.
  diff.updateOptions({ renderSideBySide: false });
  await frames(3);
  me.revealLineInCenter(anchorLine);
  await frames(3);
  result.inline = { zoneConnected: thread.isConnected, zoneHeight: round(zoneRect().height), gapToOwnLineBottom: round(zoneRect().top - (lineTopInPage(anchorLine) + me.getOption(monaco.editor.EditorOption.lineHeight))), originalWidth: oe.getLayoutInfo().width };
  diff.updateOptions({ renderSideBySide: true, hideUnchangedRegions: { enabled: true, contextLineCount: 3, minimumLineCount: 3, revealLineCount: 20 } });
  await frames(4);
  result.hideUnchanged = { scrollHeight: me.getScrollHeight(), fullHeight: modified.getLineCount() * me.getOption(monaco.editor.EditorOption.lineHeight) };
  me.changeViewZones((accessor) => accessor.removeZone(zoneId));
  decorations.clear();

  // A large diff: 20,000 lines with 200 edits.
  const bigText = sample('typescript', 20000);
  const bigOriginal = monaco.editor.createModel(bigText, 'typescript');
  const bigModified = monaco.editor.createModel(mutate(bigText, 200), 'typescript');
  started = performance.now();
  diff.setModel({ original: bigOriginal, modified: bigModified });
  const waitUntil = performance.now() + 20000;
  while ((diff.getLineChanges() ?? []).length === 0 && performance.now() < waitUntil) await new Promise((resolve) => { const sub = diff.onDidUpdateDiff(() => { sub.dispose(); resolve(); }); setTimeout(resolve, 250); });
  result.diff20000Ms = round(performance.now() - started);
  result.diff20000Changes = diff.getLineChanges()?.length ?? null;
  result.diff20000Heap = heapMb();
  diff.dispose();
  for (const model of [original, modified, bigOriginal, bigModified]) model.dispose();
  element.remove();
  return result;
}

async function themes(monaco) {
  const result = {};
  await loadLanguages(monaco, ['typescript']);
  const element = host(800, 400);
  const editor = monaco.editor.create(element, { value: sample('typescript', 60), language: 'typescript' });
  monaco.editor.defineTheme('agide-light', themeFromTokens(AGIDE_LIGHT, 'vs'));
  let started = performance.now();
  monaco.editor.setTheme('agide-light');
  await frames(2);
  result.setThemeMs = round(performance.now() - started);
  result.background = getComputedStyle(element.querySelector('.monaco-editor-background')).backgroundColor;
  try {
    monaco.editor.defineTheme('css-vars', { base: 'vs', inherit: true, rules: [], colors: { 'editor.background': 'var(--agide-surface-content)' } });
    monaco.editor.setTheme('css-vars');
    await frames(2);
    result.cssVariableTheme = { accepted: true, background: getComputedStyle(element.querySelector('.monaco-editor-background')).backgroundColor };
  } catch (error) {
    result.cssVariableTheme = { accepted: false, error: String(error).slice(0, 200) };
  }
  monaco.editor.defineTheme('probe-vscode', { base: 'vs', inherit: false, rules: rulesFromTokenColors(VSCODE_THEME), colors: VSCODE_THEME.colors });
  monaco.editor.setTheme('probe-vscode');
  await frames(3);
  const colours = new Set([...element.querySelectorAll('.view-line span span')].map((span) => getComputedStyle(span).color));
  result.vscodeRulesOnMonarch = { distinctColours: colours.size, ruleCount: rulesFromTokenColors(VSCODE_THEME).length };
  const tokens = monaco.editor.tokenize(sample('typescript', 15), 'typescript').flat().map((token) => token.type);
  result.monarchTokenTypes = [...new Set(tokens)].sort();
  editor.dispose();
  element.remove();
  return result;
}

async function markdown(monaco) {
  const result = {};
  await loadLanguages(monaco, ['markdown']);
  const note = sample('markdown', 300);
  const element = host(900, 600);
  const editor = monaco.editor.create(element, { value: note, language: 'markdown', wordWrap: 'on', links: false, lineNumbers: 'off', minimap: { enabled: false }, unicodeHighlight: { ambiguousCharacters: true, invisibleCharacters: true } });
  await frames(2);
  result.wrappedLines = element.querySelectorAll('.view-line').length;
  result.linksOptionOff = editor.getOption(monaco.editor.EditorOption.links) === false;
  result.markdownTokenTypes = [...new Set(monaco.editor.tokenize(sample('markdown', 12), 'markdown').flat().map((token) => token.type))].sort();
  // An agent proposal: one appended paragraph and one edited line, shown inline as in the notes proposal view.
  const proposed = note.replace('Some *emphasis*', 'Some *changed emphasis*') + '\n## Added by the agent\n\nA new paragraph.\n';
  const diffHost = host(900, 600);
  const diff = monaco.editor.createDiffEditor(diffHost, { renderSideBySide: false, readOnly: true, originalEditable: false, wordWrap: 'on', diffWordWrap: 'on', renderMarginRevertIcon: true, renderIndicators: true, links: false });
  const original = monaco.editor.createModel(note, 'markdown');
  const modified = monaco.editor.createModel(proposed, 'markdown');
  const started = performance.now();
  const updated = new Promise((resolve) => { const sub = diff.onDidUpdateDiff(() => { sub.dispose(); resolve(); }); });
  diff.setModel({ original, modified });
  await updated;
  result.proposalDiffMs = round(performance.now() - started);
  await frames(3);
  result.proposalChanges = (diff.getLineChanges() ?? []).map((change) => ({ o: [change.originalStartLineNumber, change.originalEndLineNumber], m: [change.modifiedStartLineNumber, change.modifiedEndLineNumber], chars: change.charChanges?.length ?? 0 }));
  result.inlineDeletedRendered = diffHost.querySelectorAll('.view-zones .view-lines, .inline-deleted-text, .char-delete').length;
  result.revertIcons = diffHost.querySelectorAll('[class*="revert"]').length;
  result.linkOpenerApi = typeof monaco.editor.registerLinkOpener === 'function';
  result.editorOpenerApi = typeof monaco.editor.registerEditorOpener === 'function';
  let clipboard;
  try { clipboard = (await navigator.clipboard.readText()).length >= 0 ? 'read' : 'empty'; } catch (error) { clipboard = `refused: ${String(error).slice(0, 120)}`; }
  result.clipboardRead = clipboard;
  diff.dispose();
  editor.dispose();
  for (const model of [original, modified]) model.dispose();
  return result;
}

async function highlight(monaco, { shiki }) {
  const result = { perLanguage: {} };
  if (!shiki) await loadLanguages(monaco, LANGUAGES);
  for (const language of LANGUAGES) {
    const text = sample(language, 2000);
    const id = language === 'shell' && shiki ? 'shellscript' : language;
    monaco.editor.tokenize('x', id);
    const started = performance.now();
    const lines = monaco.editor.tokenize(text, id);
    const ms = performance.now() - started;
    result.perLanguage[language] = { ms: round(ms), lines: lines.length, tokens: lines.reduce((sum, line) => sum + line.length, 0), types: new Set(lines.flat().map((token) => token.type)).size };
  }
  if (!shiki) {
    const element = host(900, 500);
    monaco.editor.defineTheme('probe-vscode', { base: 'vs', inherit: false, rules: rulesFromTokenColors(VSCODE_THEME), colors: VSCODE_THEME.colors });
    const editor = monaco.editor.create(element, { value: sample('typescript', 80), language: 'typescript' });
    monaco.editor.setTheme('vs');
    const until = performance.now() + 3000;
    while (element.querySelectorAll('.view-line span span').length < 300 && performance.now() < until) await frames(1);
    result.monarchDistinctColoursVs = new Set([...element.querySelectorAll('.view-line span span')].map((span) => getComputedStyle(span).color)).size;
    editor.dispose();
    element.remove();
  }
  if (shiki) {
    result.shikiSetupMs = shiki.setupMs;
    result.shikiThemes = shiki.themes;
    result.wasmEngine = shiki.wasm;
    const element = host(900, 500);
    const editor = monaco.editor.create(element, { value: sample('typescript', 80), language: 'typescript' });
    monaco.editor.setTheme(shiki.themes[0]);
    const until = performance.now() + 3000;
    while (element.querySelectorAll('.view-line span span').length < 300 && performance.now() < until) await frames(1);
    const spans = [...element.querySelectorAll('.view-line span span')];
    result.shikiDistinctColours = new Set(spans.map((span) => getComputedStyle(span).color)).size;
    result.shikiSpanSample = spans.slice(0, 8).map((span) => `${span.className}=${getComputedStyle(span).color}`);
    editor.dispose();
  }
  return result;
}

const SCENARIOS = { startup, models, leaks, diff: diffScenario, themes, markdown, highlight };

export async function runScenario(monaco, context) {
  const name = new URLSearchParams(location.search).get('scenario') ?? 'startup';
  window.__probe = { done: false };
  try {
    const value = await SCENARIOS[name](monaco, context);
    window.__probe.result = { scenario: name, variant: context.variant, ...value, violations };
  } catch (error) {
    window.__probe.result = { scenario: name, variant: context.variant, error: String(error?.stack ?? error).slice(0, 2000), violations };
  }
  window.__probe.done = true;
}
