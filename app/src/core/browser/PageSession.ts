import { axLines, findInLines, formatAxLine, type AxLine, type AxNode } from './axTree';
import { cdp, type CdpTransport } from './cdp';
import { DEFAULT_SENSITIVE_NAMES, isSensitiveField, redactCookieValues, redactFieldValues, redactNetworkUrl, REDACTED, type FieldTraits } from './redaction';
import { truncateAtLine } from './results';
import { RefTable } from './tables';

export interface ConsoleEntry {
  readonly level: string;
  readonly text: string;
  readonly host: string;
  readonly at: number;
}

export interface NetworkEntry {
  readonly requestId: string;
  readonly method: string;
  readonly url: string;
  readonly host: string;
  status?: number;
  failed?: string;
}

export interface DialogInfo {
  readonly type: string;
  readonly message: string;
}

export interface PageSessionOptions {
  readonly transport: CdpTransport;
  /** Cookies of the tab's URL from its session, for the cookie value masking of script and text results. */
  readonly cookies?: () => Promise<readonly { readonly value: string }[]>;
  readonly now?: () => number;
  readonly loadTimeoutMs?: number;
}

const BUFFER_LIMIT = 1000;

/** The sensitive-field names list the browser module passes through; a script on the page never sees it. */
const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
};

export class UserMustType extends Error {
  constructor() {
    super('this is a sensitive field; the user must type this');
    this.name = 'UserMustType';
  }
}

export class DialogOpenError extends Error {
  constructor(dialog: DialogInfo) {
    super(`a ${dialog.type} dialog is open with text ${JSON.stringify(dialog.message.slice(0, 200))}; the user must answer it`);
    this.name = 'DialogOpenError';
  }
}

/**
 * CDP behaviour of one tab: the accessibility tree with refs, text, find, input, screenshots, scripts and the
 * console and network buffers (0026 section 3). Everything it returns is raw page data; the caller redacts,
 * labels and logs. Built on a `CdpTransport`, so tests run it against a fake.
 */
export class PageSession {
  readonly refs = new RefTable();
  private readonly consoleBuffer: ConsoleEntry[] = [];
  private readonly networkBuffer: NetworkEntry[] = [];
  private dialogInfo: DialogInfo | undefined;
  private attachedAt: number | undefined;
  private unsubscribe: (() => void) | undefined;
  private host = '';
  private loadWaiters: (() => void)[] = [];
  private readonly sensitiveNames: readonly string[] | undefined;

  constructor(private readonly options: PageSessionOptions & { readonly sensitiveNames?: readonly string[] }) {
    this.sensitiveNames = options.sensitiveNames;
  }

  get dialog(): DialogInfo | undefined {
    return this.dialogInfo;
  }

  get attachTime(): number | undefined {
    return this.attachedAt;
  }

  /** Enables the domains and starts the buffers. Safe to call twice. */
  async attach(): Promise<void> {
    if (this.unsubscribe) return;
    this.attachedAt = (this.options.now ?? Date.now)();
    this.unsubscribe = this.options.transport.onEvent((method, params) => this.onEvent(method, params));
    const t = this.options.transport;
    await Promise.all(['Page.enable', 'DOM.enable', 'Runtime.enable', 'Network.enable', 'Accessibility.enable'].map((method) => t.send(method)));
    this.host = hostOf(await this.evaluateRaw('location.href'));
  }

  detach(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.attachedAt = undefined;
  }

  private onEvent(method: string, params: Record<string, unknown>): void {
    const num = (value: unknown): number => (typeof value === 'number' ? value : 0);
    switch (method) {
      case 'Page.frameNavigated': {
        const frame = params['frame'] as { parentId?: string; url?: string } | undefined;
        if (frame && frame.parentId === undefined) {
          this.refs.invalidate();
          const next = hostOf(frame.url ?? '');
          if (next !== this.host) this.networkBuffer.length = 0;
          this.host = next;
        }
        break;
      }
      case 'Page.loadEventFired': {
        const waiters = this.loadWaiters;
        this.loadWaiters = [];
        for (const wake of waiters) wake();
        break;
      }
      case 'Page.javascriptDialogOpening':
        this.dialogInfo = { type: String(params['type'] ?? 'alert'), message: String(params['message'] ?? '') };
        break;
      case 'Page.javascriptDialogClosed':
        this.dialogInfo = undefined;
        break;
      case 'Runtime.consoleAPICalled': {
        const args = (params['args'] as { value?: unknown; description?: string }[] | undefined) ?? [];
        const text = args.map((arg) => (arg.value !== undefined ? String(arg.value) : (arg.description ?? ''))).join(' ');
        this.push(this.consoleBuffer, { level: String(params['type'] ?? 'log'), text, host: this.host, at: num(params['timestamp']) });
        break;
      }
      case 'Runtime.exceptionThrown': {
        const details = params['exceptionDetails'] as { text?: string; exception?: { description?: string } } | undefined;
        this.push(this.consoleBuffer, { level: 'error', text: details?.exception?.description ?? details?.text ?? 'exception', host: this.host, at: 0 });
        break;
      }
      case 'Network.requestWillBeSent': {
        const request = params['request'] as { url?: string; method?: string } | undefined;
        const url = redactNetworkUrl(request?.url ?? '');
        this.push(this.networkBuffer, { requestId: String(params['requestId']), method: request?.method ?? 'GET', url, host: hostOf(url) });
        break;
      }
      case 'Network.responseReceived': {
        const entry = this.networkBuffer.find((candidate) => candidate.requestId === params['requestId']);
        const response = params['response'] as { status?: number } | undefined;
        if (entry && response?.status !== undefined) entry.status = response.status;
        break;
      }
      case 'Network.loadingFailed': {
        const entry = this.networkBuffer.find((candidate) => candidate.requestId === params['requestId']);
        if (entry) entry.failed = String(params['errorText'] ?? 'failed');
        break;
      }
      default:
    }
  }

  private push<T>(buffer: T[], entry: T): void {
    buffer.push(entry);
    if (buffer.length > BUFFER_LIMIT) buffer.shift();
  }

  private assertNoDialog(): void {
    if (this.dialogInfo) throw new DialogOpenError(this.dialogInfo);
  }

  private async evaluateRaw(expression: string): Promise<string> {
    const answer = await cdp<{ result?: { value?: unknown } }>(this.options.transport, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    const value = answer.result?.value;
    return typeof value === 'string' ? value : JSON.stringify(value ?? null);
  }

  async location(): Promise<{ readonly url: string; readonly title: string }> {
    const raw = await this.evaluateRaw('JSON.stringify({url: location.href, title: document.title})');
    return JSON.parse(raw) as { url: string; title: string };
  }

  /** Loads `url` with `Page.navigate` and waits for the load event, 30 s at most. */
  async navigate(url: string): Promise<{ readonly url: string; readonly title: string; readonly error?: string }> {
    this.assertNoDialog();
    const loaded = new Promise<void>((resolve) => {
      this.loadWaiters.push(resolve);
      setTimeout(resolve, this.options.loadTimeoutMs ?? 30_000).unref?.();
    });
    const answer = await cdp<{ errorText?: string }>(this.options.transport, 'Page.navigate', { url });
    if (answer.errorText) return { ...(await this.location()), error: answer.errorText };
    await loaded;
    return this.location();
  }

  private async fieldTraits(backendNodeId: number): Promise<FieldTraits> {
    try {
      const { node } = await cdp<{ node: { nodeName?: string; attributes?: string[] } }>(this.options.transport, 'DOM.describeNode', { backendNodeId });
      const attributes = node.attributes ?? [];
      const attribute = (name: string): string | undefined => {
        const at = attributes.indexOf(name);
        return at >= 0 && at % 2 === 0 ? attributes[at + 1] : undefined;
      };
      return { type: attribute('type'), autocomplete: attribute('autocomplete'), name: attribute('name'), id: attribute('id') };
    } catch {
      return {};
    }
  }

  private async axNodes(): Promise<AxNode[]> {
    const { nodes } = await cdp<{ nodes: AxNode[] }>(this.options.transport, 'Accessibility.getFullAXTree');
    return nodes;
  }

  /** The accessibility tree as text, with a ref per node that has a DOM node. Sensitive fields show no value. */
  async readPage(input: { readonly filter?: 'interactive' | 'all'; readonly depth?: number; readonly maxChars?: number; readonly refId?: string }): Promise<string> {
    this.assertNoDialog();
    const nodes = await this.axNodes();
    const lines = axLines(nodes, {
      filter: input.filter ?? 'all',
      depth: input.depth ?? 15,
      ...(input.refId === undefined ? {} : { fromBackendNodeId: this.refs.resolve(input.refId) }),
    });
    const out: string[] = [];
    for (const line of lines) {
      const ref = line.backendNodeId === undefined ? undefined : this.refs.assign(line.backendNodeId);
      let value = line.value;
      if (value !== '' && line.backendNodeId !== undefined && (line.role === 'textbox' || line.role === 'searchbox' || line.role === 'combobox')) {
        if (line.protected || isSensitiveField(await this.fieldTraits(line.backendNodeId), this.sensitiveNames)) value = '';
      }
      out.push(formatAxLine(line, ref, line.protected ? '' : value));
    }
    return truncateAtLine(out.join('\n'), input.maxChars ?? 50_000).text;
  }

  /** Refs of nodes whose role, name or value contains `query`, at most 20, with a note when more match. */
  async find(query: string): Promise<string> {
    this.assertNoDialog();
    const lines = axLines(await this.axNodes(), { filter: 'all', depth: 100 });
    const { matches, total } = findInLines(lines, query);
    if (matches.length === 0) return `No elements match "${query}" (matching is literal, not semantic).`;
    const rows = matches.map((line: AxLine) => formatAxLine({ ...line, depth: 0, value: '' }, this.refs.assign(line.backendNodeId ?? 0), ''));
    const note = total > matches.length ? `\n${total - matches.length} more match; narrow the query.` : '';
    return `${rows.join('\n')}${note}\n(matching is literal on role, name and value)`;
  }

  /** `innerText` of the main frame, article or main content first. */
  async pageText(): Promise<string> {
    this.assertNoDialog();
    return this.evaluateRaw(`(() => { const main = document.querySelector('article, main'); const text = document.body ? document.body.innerText : ''; const lead = main ? main.innerText : ''; return lead && lead !== text ? lead + '\\n\\n' + text : text; })()`);
  }

  /** Runs a script and returns its value as text, with cookie values and sensitive field values masked. */
  async evaluate(code: string): Promise<string> {
    this.assertNoDialog();
    const answer = await cdp<{ result?: { value?: unknown; description?: string; type?: string }; exceptionDetails?: { text?: string; exception?: { description?: string } } }>(
      this.options.transport,
      'Runtime.evaluate',
      { expression: code, replMode: true, awaitPromise: true, returnByValue: true },
    );
    if (answer.exceptionDetails) throw new Error(answer.exceptionDetails.exception?.description ?? answer.exceptionDetails.text ?? 'script failed');
    const value = answer.result?.value;
    const text = value === undefined ? (answer.result?.description ?? 'undefined') : typeof value === 'string' ? value : JSON.stringify(value);
    return this.maskSecrets(text);
  }

  /** Masks cookie values and the current values of sensitive inputs in `text`. */
  async maskSecrets(text: string): Promise<string> {
    let result = text;
    const cookies = await (this.options.cookies?.() ?? Promise.resolve([]));
    result = redactCookieValues(result, cookies);
    const names = JSON.stringify((this.sensitiveNames ?? DEFAULT_SENSITIVE_NAMES).map((name) => name.toLowerCase()).filter((name) => name !== ''));
    const raw = await this.evaluateRaw(
      `JSON.stringify([...document.querySelectorAll('input')].filter((el) => el.type === 'password' || /current-password|new-password|one-time-code|cc-number|cc-csc|cc-exp/.test(el.autocomplete || '') || ${names}.some((name) => ((el.name || '') + ' ' + (el.id || '')).toLowerCase().includes(name))).map((el) => el.value).filter(Boolean))`,
    ).catch(() => '[]');
    return redactFieldValues(result, JSON.parse(raw) as string[]);
  }

  private async viewport(): Promise<{ readonly width: number; readonly height: number }> {
    const metrics = await cdp<{ cssVisualViewport?: { clientWidth: number; clientHeight: number } }>(this.options.transport, 'Page.getLayoutMetrics');
    return { width: Math.round(metrics.cssVisualViewport?.clientWidth ?? 800), height: Math.round(metrics.cssVisualViewport?.clientHeight ?? 600) };
  }

  /** PNG at the frame of CSS pixels at scale 1; `scale` shrinks the returned image only. */
  async screenshot(input: { readonly scale?: number; readonly region?: readonly [number, number, number, number] } = {}): Promise<{ readonly data: string; readonly width: number; readonly height: number; readonly frame: { readonly width: number; readonly height: number } }> {
    this.assertNoDialog();
    const frame = await this.viewport();
    const [x0, y0, x1, y1] = input.region ?? [0, 0, frame.width, frame.height];
    const clip = { x: x0, y: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0), scale: input.scale ?? 1 };
    const shot = await cdp<{ data: string }>(this.options.transport, 'Page.captureScreenshot', { format: 'png', clip });
    return { data: shot.data, width: Math.round(clip.width * clip.scale), height: Math.round(clip.height * clip.scale), frame };
  }

  private async centerOf(ref: string): Promise<{ readonly x: number; readonly y: number }> {
    const backendNodeId = this.refs.resolve(ref);
    await this.options.transport.send('DOM.scrollIntoViewIfNeeded', { backendNodeId });
    const { quads } = await cdp<{ quads: number[][] }>(this.options.transport, 'DOM.getContentQuads', { backendNodeId });
    const quad = quads[0];
    if (!quad || quad.length < 8) throw new Error(`${ref} has no visible box`);
    const xs = [quad[0], quad[2], quad[4], quad[6]] as number[];
    const ys = [quad[1], quad[3], quad[5], quad[7]] as number[];
    return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
  }

  private modifierBits(modifiers: string | undefined): number {
    const names = (modifiers ?? '').toLowerCase().split('+');
    return (names.includes('alt') ? 1 : 0) | (names.includes('ctrl') || names.includes('control') ? 2 : 0) | (names.includes('meta') || names.includes('cmd') ? 4 : 0) | (names.includes('shift') ? 8 : 0);
  }

  async click(input: { readonly coordinate?: readonly [number, number] | undefined; readonly ref?: string | undefined; readonly button?: 'left' | 'right'; readonly count?: number; readonly modifiers?: string | undefined }): Promise<string> {
    this.assertNoDialog();
    const point = input.ref !== undefined ? await this.centerOf(input.ref) : input.coordinate ? { x: input.coordinate[0], y: input.coordinate[1] } : undefined;
    if (!point) throw new Error('click needs a coordinate or a ref');
    const button = input.button ?? 'left';
    const modifiers = this.modifierBits(input.modifiers);
    const t = this.options.transport;
    await t.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, modifiers });
    for (let click = 1; click <= (input.count ?? 1); click++) {
      await t.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button, clickCount: click, modifiers });
      await t.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button, clickCount: click, modifiers });
    }
    return `Clicked at (${Math.round(point.x)}, ${Math.round(point.y)})`;
  }

  async hover(input: { readonly coordinate?: readonly [number, number] | undefined; readonly ref?: string | undefined }): Promise<string> {
    const point = input.ref !== undefined ? await this.centerOf(input.ref) : input.coordinate ? { x: input.coordinate[0], y: input.coordinate[1] } : undefined;
    if (!point) throw new Error('hover needs a coordinate or a ref');
    await this.options.transport.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
    return `Hovered at (${Math.round(point.x)}, ${Math.round(point.y)})`;
  }

  async drag(from: readonly [number, number], to: readonly [number, number]): Promise<string> {
    const t = this.options.transport;
    await t.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from[0], y: from[1], button: 'left', clickCount: 1 });
    await t.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: to[0], y: to[1], button: 'left' });
    await t.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to[0], y: to[1], button: 'left', clickCount: 1 });
    return `Dragged from (${from[0]}, ${from[1]}) to (${to[0]}, ${to[1]})`;
  }

  async scroll(input: { readonly coordinate?: readonly [number, number] | undefined; readonly direction: 'up' | 'down' | 'left' | 'right'; readonly amount?: number | undefined }): Promise<string> {
    const frame = await this.viewport();
    const [x, y] = input.coordinate ?? [frame.width / 2, frame.height / 2];
    const step = (input.amount ?? 3) * 100;
    const deltaX = input.direction === 'left' ? -step : input.direction === 'right' ? step : 0;
    const deltaY = input.direction === 'up' ? -step : input.direction === 'down' ? step : 0;
    await this.options.transport.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX, deltaY });
    return `Scrolled ${input.direction} by ${input.amount ?? 3}`;
  }

  async scrollTo(ref: string): Promise<string> {
    await this.options.transport.send('DOM.scrollIntoViewIfNeeded', { backendNodeId: this.refs.resolve(ref) });
    return `Scrolled ${ref} into view`;
  }

  /** Text of the focused element's traits, read before typing so a sensitive field refuses the input. */
  private async focusedTraits(): Promise<FieldTraits & { readonly value: string; readonly editable: boolean }> {
    const raw = await this.evaluateRaw(
      `(() => { const el = document.activeElement; if (!el) return JSON.stringify({}); return JSON.stringify({ type: el.type, autocomplete: el.autocomplete, name: el.name, id: el.id, value: el.value ?? '', editable: el.isContentEditable === true || 'value' in el }); })()`,
    );
    return JSON.parse(raw) as FieldTraits & { value: string; editable: boolean };
  }

  async type(text: string): Promise<string> {
    this.assertNoDialog();
    const before = await this.focusedTraits();
    if (isSensitiveField(before, this.sensitiveNames)) throw new UserMustType();
    const t = this.options.transport;
    await t.send('Input.insertText', { text });
    const after = await this.focusedTraits();
    if (before.editable && after.value === before.value && text !== '') {
      for (const char of text) await t.send('Input.dispatchKeyEvent', { type: 'char', text: char });
    }
    return `Typed ${text.length} characters`;
  }

  async key(spec: string, repeat = 1): Promise<string> {
    this.assertNoDialog();
    const parts = spec.split('+');
    const name = parts.pop() ?? '';
    const modifiers = this.modifierBits(parts.join('+'));
    const keys: Record<string, { key: string; code: string; vk: number; text?: string }> = {
      enter: { key: 'Enter', code: 'Enter', vk: 13, text: '\r' },
      tab: { key: 'Tab', code: 'Tab', vk: 9 },
      escape: { key: 'Escape', code: 'Escape', vk: 27 },
      esc: { key: 'Escape', code: 'Escape', vk: 27 },
      backspace: { key: 'Backspace', code: 'Backspace', vk: 8 },
      delete: { key: 'Delete', code: 'Delete', vk: 46 },
      arrowup: { key: 'ArrowUp', code: 'ArrowUp', vk: 38 },
      arrowdown: { key: 'ArrowDown', code: 'ArrowDown', vk: 40 },
      arrowleft: { key: 'ArrowLeft', code: 'ArrowLeft', vk: 37 },
      arrowright: { key: 'ArrowRight', code: 'ArrowRight', vk: 39 },
      space: { key: ' ', code: 'Space', vk: 32, text: ' ' },
    };
    const known = keys[name.toLowerCase()];
    const def = known ?? { key: name, code: name.length === 1 ? `Key${name.toUpperCase()}` : name, vk: name.length === 1 ? name.toUpperCase().charCodeAt(0) : 0, ...(name.length === 1 ? { text: name } : {}) };
    for (let i = 0; i < repeat; i++) {
      await this.options.transport.send('Input.dispatchKeyEvent', { type: def.text !== undefined && modifiers === 0 ? 'keyDown' : 'rawKeyDown', key: def.key, code: def.code, windowsVirtualKeyCode: def.vk, modifiers, ...(def.text !== undefined && modifiers === 0 ? { text: def.text } : {}) });
      await this.options.transport.send('Input.dispatchKeyEvent', { type: 'keyUp', key: def.key, code: def.code, windowsVirtualKeyCode: def.vk, modifiers });
    }
    return `Pressed ${spec}`;
  }

  /** Sets a field through the native value setter and fires `input` and `change`; refuses sensitive fields. */
  async formInput(ref: string, value: string | boolean | number): Promise<string> {
    this.assertNoDialog();
    const backendNodeId = this.refs.resolve(ref);
    if (isSensitiveField(await this.fieldTraits(backendNodeId), this.sensitiveNames)) throw new UserMustType();
    const { object } = await cdp<{ object: { objectId: string } }>(this.options.transport, 'DOM.resolveNode', { backendNodeId });
    const answer = await cdp<{ result?: { value?: unknown }; exceptionDetails?: { text?: string } }>(this.options.transport, 'Runtime.callFunctionOn', {
      objectId: object.objectId,
      returnByValue: true,
      functionDeclaration: `function (value) {
        const el = this;
        if (el instanceof HTMLSelectElement) {
          const option = [...el.options].find((o) => o.value === String(value) || o.text === String(value));
          if (!option) return 'no option ' + value;
          el.value = option.value;
        } else if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
          el.checked = Boolean(value);
        } else {
          const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, String(value));
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return 'ok';
      }`,
      arguments: [{ value }],
    });
    if (answer.exceptionDetails) throw new Error(`could not set ${ref}`);
    if (answer.result?.value !== 'ok') throw new Error(String(answer.result?.value));
    return `Set ${ref}`;
  }

  /** Highlights a node by ref or a rectangle, or clears the overlay. The page cannot see a CDP overlay. */
  async highlight(target: { readonly ref?: string; readonly rect?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } } | undefined): Promise<void> {
    const t = this.options.transport;
    await t.send('Overlay.enable');
    if (target === undefined) {
      await t.send('Overlay.hideHighlight');
      return;
    }
    const color = { r: 255, g: 107, b: 0, a: 0.35 };
    if (target.ref !== undefined) await t.send('Overlay.highlightNode', { backendNodeId: this.refs.resolve(target.ref), highlightConfig: { contentColor: color, borderColor: { ...color, a: 1 } } });
    else if (target.rect) await t.send('Overlay.highlightRect', { ...target.rect, color, outlineColor: { ...color, a: 1 } });
  }

  readConsole(input: { readonly pattern?: string | undefined; readonly onlyErrors?: boolean | undefined; readonly limit?: number | undefined; readonly clear?: boolean | undefined }): string {
    const pattern = input.pattern === undefined ? undefined : safeRegExp(input.pattern);
    const rows = this.consoleBuffer.filter((entry) => entry.host === this.host && (!input.onlyErrors || entry.level === 'error') && (pattern === undefined || pattern.test(entry.text)));
    const shown = rows.slice(-(input.limit ?? 100));
    if (input.clear) this.consoleBuffer.length = 0;
    const since = this.attachedAt === undefined ? 'unknown' : new Date(this.attachedAt).toISOString();
    return `Console messages of ${this.host || 'this page'} since the debugger attached (${since}); ${rows.length} match.\n${shown.map((entry) => `[${entry.level}] ${entry.text}`).join('\n')}`;
  }

  readNetwork(input: { readonly urlPattern?: string | undefined; readonly limit?: number | undefined; readonly clear?: boolean | undefined }): string {
    const rows = this.networkBuffer.filter((entry) => input.urlPattern === undefined || entry.url.includes(input.urlPattern));
    const shown = rows.slice(-(input.limit ?? 100));
    if (input.clear) this.networkBuffer.length = 0;
    const line = (entry: NetworkEntry) => `${entry.method} ${entry.url} ${entry.failed !== undefined ? `failed: ${entry.failed}` : (entry.status ?? 'pending')}`;
    return `Network requests since the debugger attached or the last navigation to another domain; headers and bodies are not shown (${REDACTED} values hide secrets in URLs).\n${shown.map(line).join('\n')}`;
  }
}

function safeRegExp(pattern: string): RegExp {
  try {
    return new RegExp(pattern, 'i');
  } catch {
    return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  }
}
