// First-slice Electron checks of design 0026 section 9. Run with: node_modules/.bin/electron scripts/browser-checks.mjs
// Windows are never shown. Prints one JSON object with the outcome of each check and exits.
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app, BaseWindow, BrowserWindow, WebContentsView } from 'electron';

const results = {};
const check = async (name, run) => {
  try {
    results[name] = await Promise.race([run(), new Promise((_resolve, reject) => setTimeout(() => reject(new Error('no answer after 8 s')), 8000))]);
  } catch (error) {
    results[name] = { error: String(error?.message ?? error) };
  }
};

async function main() {
  const userData = mkdtempSync(join(tmpdir(), 'agide-checks-'));
  app.setPath('userData', userData);

  const page = `<!doctype html><title>Checks</title><h1 id="h">Heading</h1><button id="b" onclick="document.title='clicked'">Press</button><input id="i" aria-label="Name">`;
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(page);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;

  const events = [];
  app.on('web-contents-created', (_event, contents) => events.push({ order: 'created', type: contents.getType() }));

  await app.whenReady();

  const loaded = (contents) =>
    new Promise((resolve) => (contents.isLoading() ? contents.once('did-finish-load', resolve) : resolve()));
  const send = (contents, method, params) => contents.debugger.sendCommand(method, params);
  process.on('uncaughtException', (error) => console.error('uncaught', error.message));
  const png = (data) => Buffer.from(data, 'base64').length;

  const window = new BaseWindow({ show: false, width: 800, height: 600 });
  const before = events.length;
  const view = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  const afterConstructor = events.length;
  results.webContentsCreatedBeforeConstructorReturns = { createdDuringConstructor: afterConstructor > before };
  window.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 40, width: 800, height: 560 });
  await view.webContents.loadURL(url);
  view.webContents.debugger.attach('1.3');

  await check('screenshotHiddenWindow', async () => {
    const shot = await send(view.webContents, 'Page.captureScreenshot', { format: 'png' });
    return { bytes: png(shot.data) };
  });
  await check('screenshotAfterSetVisibleFalse', async () => {
    view.setVisible(false);
    const shot = await Promise.race([send(view.webContents, 'Page.captureScreenshot', { format: 'png' }), new Promise((_r, reject) => setTimeout(() => reject(new Error('timeout after 5 s')), 5000))]);
    view.setVisible(true);
    return { bytes: png(shot.data) };
  });
  await check('capturePageOfView', async () => {
    const image = await view.webContents.capturePage();
    return { size: image.getSize(), bytes: image.toPNG().length };
  });
  await check('replMode', async () => {
    const first = await send(view.webContents, 'Runtime.evaluate', { expression: 'const a = 21', replMode: true, awaitPromise: true, returnByValue: true });
    const second = await send(view.webContents, 'Runtime.evaluate', { expression: 'a * 2', replMode: true, awaitPromise: true, returnByValue: true });
    const awaited = await send(view.webContents, 'Runtime.evaluate', { expression: 'await Promise.resolve(7)', replMode: true, awaitPromise: true, returnByValue: true });
    return { constThenUse: second.result?.value, topLevelAwait: awaited.result?.value, firstType: first.result?.type };
  });
  await check('fullAxTree', async () => {
    await send(view.webContents, 'Accessibility.enable', {});
    const { nodes } = await send(view.webContents, 'Accessibility.getFullAXTree', {});
    const button = nodes.find((node) => node.role?.value === 'button');
    return { nodes: nodes.length, buttonName: button?.name?.value, buttonHasBackendId: typeof button?.backendDOMNodeId === 'number' };
  });
  await check('overlayHighlight', async () => {
    await send(view.webContents, 'DOM.enable', {});
    await send(view.webContents, 'Overlay.enable', {});
    const { root } = await send(view.webContents, 'DOM.getDocument', {});
    const { nodeId } = await send(view.webContents, 'DOM.querySelector', { nodeId: root.nodeId, selector: '#b' });
    await send(view.webContents, 'Overlay.highlightNode', { nodeId, highlightConfig: { contentColor: { r: 0, g: 120, b: 255, a: 0.3 } } });
    const shot = await send(view.webContents, 'Page.captureScreenshot', { format: 'png' });
    await send(view.webContents, 'Overlay.hideHighlight', {});
    await send(view.webContents, 'Overlay.highlightRect', { x: 10, y: 10, width: 50, height: 20, color: { r: 255, g: 0, b: 0, a: 0.3 } });
    await send(view.webContents, 'Overlay.hideHighlight', {});
    return { accepted: true, screenshotBytes: png(shot.data) };
  });
  await check('inputInsertText', async () => {
    await send(view.webContents, 'Runtime.evaluate', { expression: 'document.getElementById("i").focus()' });
    await send(view.webContents, 'Input.insertText', { text: 'hello' });
    const value = await send(view.webContents, 'Runtime.evaluate', { expression: 'document.getElementById("i").value', returnByValue: true });
    return { value: value.result.value };
  });
  await check('secondAttachThrows', async () => {
    try {
      view.webContents.debugger.attach('1.3');
      return { threw: false };
    } catch (error) {
      return { threw: true, message: String(error.message) };
    }
  });
  await check('navigationHistoryRestore', async () => {
    const second = new WebContentsView({ webPreferences: { sandbox: true } });
    window.contentView.addChildView(second);
    await second.webContents.navigationHistory.restore({
      index: 1,
      entries: [
        { url: `${url}?a=1`, title: 'A' },
        { url: `${url}?b=2`, title: 'B' },
      ],
    });
    for (let i = 0; i < 50 && (second.webContents.isLoading() || second.webContents.getURL() === ''); i++) await new Promise((resolve) => setTimeout(resolve, 100));
    const entries = second.webContents.navigationHistory.getAllEntries().map((entry) => entry.url);
    const result = { url: second.webContents.getURL(), entries: entries.length, canGoBack: second.webContents.navigationHistory.canGoBack() };
    second.webContents.close();
    return result;
  });
  await check('pageNavigateFiresNoWillNavigate', async () => {
    let fired = false;
    view.webContents.on('will-navigate', () => (fired = true));
    await send(view.webContents, 'Page.navigate', { url: `${url}?cdp=1` });
    await new Promise((resolve) => setTimeout(resolve, 300));
    return { willNavigateFired: fired };
  });
  await check('windowCaptureWithViewChild', async () => {
    const host = new BrowserWindow({ show: false, width: 600, height: 400, webPreferences: { sandbox: true } });
    await host.loadURL('data:text/html,<body style="margin:0;background:%23ff0000"></body>');
    const child = new WebContentsView({ webPreferences: { sandbox: true } });
    host.contentView.addChildView(child);
    child.setBounds({ x: 0, y: 0, width: 300, height: 400 });
    await child.webContents.loadURL('data:text/html,<body style="margin:0;background:%2300ff00"></body>');
    await new Promise((resolve) => setTimeout(resolve, 300));
    const image = await host.webContents.capturePage();
    const { width, height } = image.getSize();
    const bitmap = image.toBitmap();
    const pixel = (x, y) => [...bitmap.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)];
    const result = { width, height, leftPixelBgra: pixel(50, 200), rightPixelBgra: pixel(450, 200) };
    host.destroy();
    return result;
  });
  await check('sessionStoragePath', async () => {
    const { session } = await import('electron');
    const partition = session.fromPartition('persist:checks');
    return { underUserData: partition.getStoragePath()?.startsWith(userData) === true };
  });

  view.webContents.debugger.detach();
  results.events = events;
  console.log(`CHECKS_JSON ${JSON.stringify(results)}`);
  server.close();
  window.destroy();
  app.exit(0);
  process.on('exit', () => rmSync(userData, { recursive: true, force: true }));

}

main().catch((error) => {
  console.error(error);
  app.exit(1);
});
