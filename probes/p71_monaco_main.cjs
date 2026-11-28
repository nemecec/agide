// P71 main process: loads one built P70 variant in a hidden window with the web preferences of the app's main
// window (context isolation, sandbox, no Node integration), denies every web permission as the app does,
// cancels every request that is not file:, data: or blob:, answers the renderer's input request (text inserted
// into the focused element for the view zone test) and writes the scenario's result, the requests, the console and the
// renderer's memory to the file named by P71_OUT. Started by p71_monaco_run.mjs.

const { app, BrowserWindow, session } = require('electron');
const { writeFileSync } = require('node:fs');

app.commandLine.appendSwitch('js-flags', '--expose-gc');
app.commandLine.appendSwitch('enable-precise-memory-info');
app.setPath('userData', process.env.P71_USER_DATA);
app.dock?.hide();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

app.whenReady().then(async () => {
  const requests = [];
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    const scheme = details.url.split(':')[0];
    const local = ['file', 'data', 'blob', 'devtools'].includes(scheme);
    if (!local || requests.length < 200) requests.push({ scheme, resourceType: details.resourceType, url: local ? undefined : details.url.slice(0, 200) });
    callback({ cancel: !local });
  });
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => { requests.push({ permission }); callback(false); });
  session.defaultSession.setPermissionCheckHandler(() => false);

  const window = new BrowserWindow({
    show: false, width: 1300, height: 900, paintWhenInitiallyHidden: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false },
  });
  const consoleLines = [];
  window.webContents.on('console-message', (...args) => {
    const event = args[0];
    const message = event.message ?? args[2];
    const level = event.level ?? args[1];
    if (consoleLines.length < 50) consoleLines.push(`${level}: ${String(message).slice(0, 300)}`);
  });
  let crashed;
  window.webContents.on('render-process-gone', (_event, details) => { crashed = details.reason; });

  const loadStarted = Date.now();
  await window.loadFile(process.env.P71_HTML, { query: { scenario: process.env.P71_SCENARIO } });
  const loadMs = Date.now() - loadStarted;
  const deadline = Date.now() + Number(process.env.P71_TIMEOUT_MS ?? 120000);
  let state = null;
  while (Date.now() < deadline && !crashed) {
    state = await window.webContents.executeJavaScript('window.__probe ? { done: window.__probe.done, request: window.__probe.request ?? null } : null');
    if (state?.done) break;
    if (state?.request?.kind === 'insert-text') {
      await window.webContents.executeJavaScript('window.__probe.request = null');
      await window.webContents.insertText(state.request.text);
      await sleep(50);
      await window.webContents.executeJavaScript('window.__probeTyped && window.__probeTyped()');
    }
    await sleep(50);
  }
  const result = state?.done ? await window.webContents.executeJavaScript('window.__probe.result') : { error: crashed ? `renderer gone: ${crashed}` : 'timed out' };
  const pid = window.webContents.getOSProcessId();
  const metric = app.getAppMetrics().find((entry) => entry.pid === pid);
  writeFileSync(process.env.P71_OUT, JSON.stringify({ loadMs, result, rendererMemoryMb: metric ? Math.round(metric.memory.workingSetSize / 102.4) / 10 : null, requests, console: consoleLines }, null, 2));
  app.quit();
});
