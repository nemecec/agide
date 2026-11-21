// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { overlayScript } from './browser/capture';
import { maskedSlotsScript, maskScript } from './windowCapture';

const PAGE = `<body>
  <div data-pane-tab="main"></div><div data-pane-tab="tree"></div>
  <div data-instance-id="main"><div data-browser-slot="leaf-main"></div></div>
  <div data-instance-id="tree"><div data-browser-slot="leaf-tree-a"></div><div data-browser-slot="leaf-tree-b"></div></div>
  <div data-instance-id="side"><div data-browser-slot="leaf-side"></div></div>
  <div data-instance-id="empty"></div>
  <span data-capture-scoped data-testid="badge"></span>
</body>`;

/** The part of the jsdom document these tests use; the node compile has no DOM types. */
const dom = globalThis as unknown as {
  HTMLImageElement: { prototype: { decode: (() => Promise<void>) | undefined } };
  document: { body: { innerHTML: string; insertAdjacentHTML(position: string, html: string): void }; documentElement: { removeAttribute(name: string): void }; querySelectorAll(selector: string): Iterable<{ getAttribute(name: string): string | null; textContent: string | null }> };
};
const document = dom.document;
const evaluate = (script: string): unknown => (0, eval)(script);
const masked = (): string[] => [...dom.document.querySelectorAll('[data-capture-mask]')].map((el) => el.getAttribute('data-instance-id') ?? `tab:${el.getAttribute('data-pane-tab')}`);
/** Elements the style sheet fills: those with the scoped attribute below a root that carries the scoped mask attribute. */
const scopedFilled = (): string[] => [...dom.document.querySelectorAll('[data-capture-scoped-mask] [data-capture-scoped]')].map((el) => el.getAttribute('data-testid') ?? '');

beforeEach(() => {
  dom.document.body.innerHTML = PAGE;
  dom.document.documentElement.removeAttribute('data-capture-scoped-mask');
});

describe('the scripts of the window capture, run against a document', () => {
  it('returns the leaf ids of the browser slots inside the given instances and no others', () => {
    expect(evaluate(maskedSlotsScript(['tree', 'main'])), 'slots of main and tree').toEqual(['leaf-main', 'leaf-tree-a', 'leaf-tree-b']);
    expect(evaluate(maskedSlotsScript(['side'])), 'only the slot inside side').toEqual(['leaf-side']);
    expect(evaluate(maskedSlotsScript(['empty', 'missing'])), 'an instance with no slot and an unknown instance').toEqual([]);
    expect(evaluate(maskedSlotsScript([])), 'no instance, no slot').toEqual([]);
  });

  it('marks the pane frame and the dock tab of each given instance and nothing else', async () => {
    await evaluate(maskScript(['main', 'empty']));
    expect(masked().sort(), 'frames of main and empty and the tab of main').toEqual(['empty', 'main', 'tab:main']);
  });

  it('marks the element of the title bar that counts every folder for a scoped caller and leaves it visible for the user', async () => {
    await evaluate(maskScript([], true));
    expect(scopedFilled(), 'the unread badge slot is hidden from a scoped caller').toEqual(['badge']);
    dom.document.documentElement.removeAttribute('data-capture-scoped-mask');
    await evaluate(maskScript(['main']));
    expect(scopedFilled(), 'the badge stays visible for the user').toEqual([]);
  });

  it('covers a scoped element that mounts after the mask script ran', async () => {
    await evaluate(maskScript([], true));
    document.body.insertAdjacentHTML('beforeend', '<span data-capture-scoped data-testid="late"></span>');
    expect(scopedFilled(), 'the element added later is under the scoped mask too').toEqual(['badge', 'late']);
  });

  it('keeps an id with characters of a selector from selecting other elements', async () => {
    await evaluate(maskScript(['main"], [data-instance-id']));
    expect(masked(), 'a crafted id matches nothing').toEqual([]);
  });
});

interface Scene {
  readonly maskAtCapture: string[][];
  readonly scopedAtCapture: string[][];
  readonly overlay: { applied: number; removed: number };
  /** What the overlay apply script resolves with. */
  drawnUnavailable: string[];
}

/** Fake Electron whose window runs scripts in the jsdom document; every capture records which elements are marked. */
function fakeElectron(onCapture: (attempt: number) => void = () => undefined): Scene {
  const scene: Scene = { maskAtCapture: [], scopedAtCapture: [], overlay: { applied: 0, removed: 0 }, drawnUnavailable: [] };
  const webContents = {
    executeJavaScript: async (script: string) => {
      if (script === 'overlay-apply') {
        scene.overlay.applied++;
        return scene.drawnUnavailable;
      }
      if (script === 'overlay-remove') {
        scene.overlay.removed++;
        return undefined;
      }
      return evaluate(script);
    },
    capturePage: async () => {
      scene.maskAtCapture.push(masked());
      scene.scopedAtCapture.push(scopedFilled());
      onCapture(scene.maskAtCapture.length);
      return { getSize: () => ({ width: 2, height: 2 }), toPNG: () => Buffer.from('png') };
    },
  };
  vi.doMock('electron', () => ({ BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents }] } }));
  return scene;
}

describe('overlayScript run against a document', () => {
  const decodeBefore = dom.HTMLImageElement.prototype.decode;
  afterEach(() => {
    if (decodeBefore) dom.HTMLImageElement.prototype.decode = decodeBefore;
    else Reflect.deleteProperty(dom.HTMLImageElement.prototype, 'decode');
  });

  const bounds = { x: 1, y: 2, width: 30, height: 40 };
  const drawn = (): string[] => [...document.querySelectorAll('[data-capture-view]')].map((el) => el.textContent ?? '');

  it('skips an item whose slot is not in the document and reports only the leaves it drew as "page not captured"', async () => {
    document.body.innerHTML = '<div data-instance-id="side"><div data-browser-slot="leaf-side"></div></div><div data-instance-id="main" data-capture-mask><div data-browser-slot="leaf-main"></div></div>';
    const script = overlayScript([
      { leafId: 'leaf-gone', bounds, shared: true },
      { leafId: 'leaf-side', bounds, shared: true },
      { leafId: 'leaf-main', bounds, shared: true },
    ]);
    const unavailable = await evaluate(script);
    expect(unavailable, 'the leaf without a slot and the leaf in a masked pane are not reported').toEqual(['leaf-side']);
    expect(drawn(), 'nothing is drawn for the missing slot; the masked pane gets the "not shared" fill').toEqual(['page not captured', 'not shared']);
  });

  it('draws the still of an item whose slot exists and does not report it', async () => {
    document.body.innerHTML = '<div data-instance-id="side"><div data-browser-slot="leaf-side"></div></div>';
    dom.HTMLImageElement.prototype.decode = async () => undefined;
    const unavailable = await evaluate(overlayScript([{ leafId: 'leaf-side', bounds, dataUrl: 'data:image/png;base64,AAAA', shared: true }]));
    expect(unavailable, 'a view with a still is available').toEqual([]);
    expect([...document.querySelectorAll('[data-capture-view] img')].length > 0, 'the still is drawn').toBe(true);
  });
});

describe('captureAppWindow', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.doUnmock('electron'));

  async function load(): Promise<typeof import('./windowCapture')> {
    return import('./windowCapture');
  }

  it('hides the instances the request names at the time of the capture, not the ones named when it started', async () => {
    const scene = fakeElectron();
    const module = await load();
    let current = ['tree'];
    module.setCaptureOverlay(async () => {
      current = ['tree', 'main'];
      return { apply: 'overlay-apply', remove: 'overlay-remove' };
    });
    const shot = await module.captureAppWindow({ masked: () => current });
    expect([...shot.masked].sort(), 'the result names the mask that was applied').toEqual(['main', 'tree']);
    expect(scene.maskAtCapture[0]?.sort(), 'the pane that appeared during the wait is hidden in the pixels').toEqual(['main', 'tab:main', 'tree', 'tab:tree'].sort());
    expect(scene.maskAtCapture, 'one capture was enough').toHaveLength(1);
  });

  it('takes the capture again when the mask changes while the pixels are taken', async () => {
    let current = ['tree'];
    const scene = fakeElectron((attempt) => {
      if (attempt === 1) current = ['tree', 'main'];
    });
    const module = await load();
    module.setCaptureOverlay(async () => ({ apply: 'overlay-apply', remove: 'overlay-remove' }));
    const shot = await module.captureAppWindow({ masked: () => current });
    expect(scene.maskAtCapture, 'two captures').toHaveLength(2);
    expect(scene.maskAtCapture[1]?.includes('main'), 'the second capture hides main').toBe(true);
    expect([...shot.masked].sort(), 'the result names the second mask').toEqual(['main', 'tree']);
    expect(scene.overlay, 'the overlay was applied once per capture and removed once per capture').toEqual({ applied: 2, removed: 2 });
  });

  it('fails instead of returning pixels when the mask keeps changing, and removes its marks', async () => {
    let flip = 0;
    const scene = fakeElectron(() => void flip++);
    const module = await load();
    module.setCaptureOverlay(async () => ({ apply: 'overlay-apply', remove: 'overlay-remove' }));
    await expect(module.captureAppWindow({ masked: () => (flip % 2 === 0 ? ['tree'] : ['main']), inScope: () => true }), 'no image of a changing window').rejects.toThrow('changed while it was captured');
    expect(scene.maskAtCapture, 'three attempts').toHaveLength(3);
    expect(masked(), 'the marks are gone').toEqual([]);
    expect(scopedFilled(), 'the scoped mask is removed after a failed capture').toEqual([]);
    expect(scene.overlay.removed, 'the overlay is removed after every attempt and at the end').toBeGreaterThanOrEqual(3);
  });

  it('hides the unread badge in the pixels of a scoped caller even when no pane is masked, and not in those of the user', async () => {
    const scene = fakeElectron();
    const module = await load();
    await module.captureAppWindow({ masked: () => [], inScope: () => true });
    expect(scene.scopedAtCapture[0], 'a scoped caller gets the badge masked').toEqual(['badge']);
    expect(scopedFilled(), 'the scoped mask is removed after the capture').toEqual([]);
    await module.captureAppWindow({ masked: () => [] });
    expect(scene.scopedAtCapture[1], 'the user gets nothing masked').toEqual([]);
  });

  it('names as unavailable the leaves the overlay script drew as "page not captured"', async () => {
    const scene = fakeElectron();
    scene.drawnUnavailable = ['leaf-side'];
    const module = await load();
    module.setCaptureOverlay(async () => ({ apply: 'overlay-apply', remove: 'overlay-remove' }));
    const shot = await module.captureAppWindow({ masked: () => ['main', 'tree'] });
    expect(shot.unavailable, 'the result lists what the script reported, not what the overlay provider knew before').toEqual(['leaf-side']);
  });

  it('tells the overlay which leaves sit in masked panes so it neither waits for nor captures them', async () => {
    fakeElectron();
    const module = await load();
    const seen: ReadonlySet<string>[] = [];
    module.setCaptureOverlay(async (scope) => {
      seen.push(scope.maskedLeafIds);
      return { apply: 'overlay-apply', remove: 'overlay-remove' };
    });
    await module.captureAppWindow({ masked: () => ['tree'] });
    expect([...(seen[0] ?? [])].sort(), 'leaves of the masked pane').toEqual(['leaf-tree-a', 'leaf-tree-b']);
  });

  it('fails with a message when the app has no window', async () => {
    vi.doMock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }));
    const module = await load();
    await expect(module.captureAppWindow({ masked: () => [] }), 'no window').rejects.toThrow('no app window to capture');
  });
});
