// P58: can an unpacked Chrome extension (the Bitwarden browser extension, manifest 3) run in a partition session of
// Electron, the way the embedded browser of Agide would host it? Run with the app's Electron:
//   app/node_modules/.bin/electron probes/p58_ext_load.mjs --ud=<dir> --ext=<unpacked extension dir> --out=<json> [--phase=write|read]
// With --preload=<file> a service-worker preload script is registered in both sessions before the extension loads.
// Windows are never shown. Every request to a host other than 127.0.0.1 and localhost is cancelled and logged, and the
// resolver maps every other name to nothing, so no server is contacted. The probe never logs in and never types a
// credential; the only value it writes into extension storage is a marker it invented.
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { app, BaseWindow, BrowserWindow, session, WebContentsView } from 'electron';

const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const i = a.indexOf('='); return i < 0 ? [a.slice(2), '1'] : [a.slice(2, i), a.slice(i + 1)]; }));
const phase = args.phase ?? 'write';
const extDir = args.ext;
const userData = args.ud;
const outFile = args.out;
if (!extDir || !userData || !outFile) throw new Error('--ext, --ud and --out are required');
mkdirSync(userData, { recursive: true });
app.setPath('userData', userData);
app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost');
app.commandLine.appendSwitch('remote-debugging-port', '0');
app.dock?.hide();
app.setActivationPolicy?.('accessory');

const T0 = Date.now();
const stamp = () => Date.now() - T0;
const R = { phase, electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node, log: [], blocked: {}, serviceWorker: {}, partitions: {} };
const note = (what, data) => R.log.push({ t: stamp(), what, ...(data === undefined ? {} : { data }) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const within = (p, ms, label) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${label ?? 'call'} timed out after ${ms} ms`)), ms))]);
const save = () => writeFileSync(outFile, JSON.stringify(R, null, 2));
const outDir = outFile.replace(/[^/]+$/, '');
const tag = outFile.replace(/^.*\//, '').replace(/\.json$/, '');

const isLoopback = (host) => host === '127.0.0.1' || host === 'localhost';
function blockOutside(ses, label) {
  ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    let u;
    try { u = new URL(details.url); } catch { return callback({}); }
    const external = ['http:', 'https:', 'ws:', 'wss:'].includes(u.protocol) && !isLoopback(u.hostname);
    if (external) {
      const key = `${label} ${u.protocol}//${u.host}`;
      const entry = (R.blocked[key] ??= { count: 0, firstAtMs: stamp(), types: {}, fromPage: 0, fromWorkerOrExtension: 0 });
      entry.count += 1;
      entry.types[details.resourceType] = (entry.types[details.resourceType] ?? 0) + 1;
      if (details.webContentsId === undefined || details.webContentsId === 0) entry.fromWorkerOrExtension += 1; else entry.fromPage += 1;
    }
    callback({ cancel: external });
  });
}

const LOGIN_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Login fixture</title></head><body>
<h1>Sign in</h1>
<form id="f" method="post" action="/login"><label>User <input id="user" name="username" type="text" autocomplete="username"></label>
<label>Password <input id="pass" name="password" type="password" autocomplete="current-password"></label><button type="submit">Sign in</button></form>
</body></html>`;

/** Namespaces and members that the extension code or a typical browser shell needs; each is checked for presence. */
const API_MEMBERS = {
  runtime: ['id', 'getManifest', 'getURL', 'getPlatformInfo', 'sendMessage', 'connect', 'onMessage', 'onConnect', 'onInstalled', 'onStartup', 'connectNative', 'sendNativeMessage', 'openOptionsPage', 'reload', 'getContexts', 'onMessageExternal'],
  storage: ['local', 'session', 'sync', 'managed', 'onChanged'],
  tabs: ['query', 'create', 'update', 'get', 'remove', 'sendMessage', 'executeScript', 'reload', 'onUpdated', 'onActivated', 'onRemoved', 'onCreated', 'getCurrent', 'captureVisibleTab'],
  windows: ['getAll', 'getCurrent', 'create', 'update', 'onFocusChanged', 'onRemoved'],
  action: ['setBadgeText', 'setIcon', 'setTitle', 'getPopup', 'openPopup', 'onClicked', 'setBadgeBackgroundColor'],
  contextMenus: ['create', 'update', 'removeAll', 'onClicked'],
  menus: ['create'],
  alarms: ['create', 'get', 'getAll', 'clear', 'onAlarm'],
  scripting: ['executeScript', 'insertCSS', 'registerContentScripts', 'getRegisteredContentScripts'],
  webNavigation: ['getAllFrames', 'getFrame', 'onCommitted', 'onCompleted', 'onBeforeNavigate'],
  webRequest: ['onBeforeRequest', 'onCompleted', 'onAuthRequired', 'onBeforeRedirect'],
  offscreen: ['createDocument', 'closeDocument', 'hasDocument'],
  sidePanel: ['open', 'setOptions'],
  commands: ['getAll', 'onCommand'],
  notifications: ['create', 'clear', 'onClicked'],
  idle: ['queryState', 'setDetectionInterval', 'onStateChanged'],
  privacy: ['services', 'network', 'websites'],
  permissions: ['contains', 'request', 'getAll', 'onAdded'],
  i18n: ['getMessage', 'getUILanguage'],
  management: ['getSelf', 'getAll'],
  cookies: ['getAll'],
  declarativeNetRequest: ['updateDynamicRules'],
  downloads: ['download'],
  identity: ['launchWebAuthFlow'],
  clipboard: [],
  extension: ['getURL', 'getBackgroundPage', 'isAllowedFileSchemeAccess'],
  browsingData: ['remove'],
  topSites: ['get'],
  tabGroups: ['query'],
};

/** Runs inside the service worker or the popup page: presence of each member, then a few harmless calls. */
const INVENTORY_EXPRESSION = `(async () => {
  const members = ${JSON.stringify(API_MEMBERS)};
  const present = {};
  for (const [ns, names] of Object.entries(members)) {
    const root = typeof chrome === 'undefined' ? undefined : chrome[ns];
    present[ns] = root === undefined ? 'undefined' : Object.fromEntries(names.map((n) => [n, typeof root[n]]));
    if (root !== undefined && names.length === 0) present[ns] = 'present';
  }
  const timeout = (ms) => new Promise((_, rej) => setTimeout(() => rej(new Error('no answer in ' + ms + ' ms')), ms));
  const call = async (name, fn) => { try { const v = await Promise.race([fn(), timeout(3000)]); let s; try { s = JSON.stringify(v); } catch { s = String(v); } return [name, { ok: true, value: (s ?? 'undefined').slice(0, 300) }]; } catch (e) { return [name, { ok: false, error: String(e && e.message || e).slice(0, 300) }]; } };
  const calls = await Promise.all([
    call('runtime.getPlatformInfo', () => chrome.runtime.getPlatformInfo()),
    call('runtime.getManifest.manifest_version', () => chrome.runtime.getManifest().manifest_version),
    call('storage.local.get(probeMarker)', () => chrome.storage.local.get('probeMarker')),
    call('storage.session.set', () => chrome.storage.session.set({ probeSession: 1 })),
    call('storage.sync.get(probeMarker)', () => chrome.storage.sync.get('probeMarker')),
    call('alarms.create', async () => { await chrome.alarms.create('probe-alarm', { delayInMinutes: 30 }); return chrome.alarms.getAll(); }),
    call('tabs.query({})', async () => (await chrome.tabs.query({})).map((t) => ({ id: t.id, active: t.active, hasUrl: typeof t.url === 'string', hasWindow: typeof t.windowId === 'number' }))),
    call('tabs.query({active:true})', async () => (await chrome.tabs.query({ active: true, currentWindow: true })).length),
    call('windows.getAll', async () => (await chrome.windows.getAll()).length),
    call('windows.getCurrent', () => chrome.windows.getCurrent()),
    call('action.getPopup', () => chrome.action.getPopup({})),
    call('action.setBadgeText', () => chrome.action.setBadgeText({ text: '1' })),
    call('contextMenus.create', () => new Promise((res, rej) => { const id = chrome.contextMenus.create({ id: 'probe-menu', title: 'Probe', contexts: ['page'] }, () => (chrome.runtime.lastError ? rej(new Error(chrome.runtime.lastError.message)) : res('created'))); })),
    call('offscreen.hasDocument', () => chrome.offscreen.hasDocument()),
    call('idle.queryState', () => chrome.idle.queryState(60)),
    call('commands.getAll', () => chrome.commands.getAll()),
    call('webNavigation.getAllFrames', () => chrome.webNavigation.getAllFrames({ tabId: 1 })),
    call('permissions.getAll', () => chrome.permissions.getAll()),
    call('permissions.contains(nativeMessaging)', () => chrome.permissions.contains({ permissions: ['nativeMessaging'] })),
    call('runtime.connectNative (no permission)', async () => { const p = chrome.runtime.connectNative('com.example.absent'); return typeof p; }),
    call('management.getSelf', () => chrome.management.getSelf()),
    call('scripting.registerContentScripts', () => chrome.scripting.getRegisteredContentScripts()),
  ]);
  return JSON.stringify({ chromeKeys: Object.keys(chrome).sort(), present, calls: Object.fromEntries(calls) });
})()`;

async function connectBrowserCdp() {
  const file = join(userData, 'DevToolsActivePort');
  for (let i = 0; i < 40 && !existsSync(file); i++) await sleep(250);
  const [port, path] = readFileSync(file, 'utf8').split('\n');
  const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')); });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(msg.error.message)) : res(msg.result); } };
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) })); setTimeout(() => { if (pending.delete(i)) rej(new Error(`${method} timed out`)); }, 15000); });
  return { send, close: () => ws.close() };
}

async function main() {
  const server = createServer((req, res) => {
    R.server ??= { requests: [] };
    R.server.requests.push(`${req.method} ${req.url}`);
    if (req.method === 'POST') { req.resume(); res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<title>posted</title>posted'); }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(req.url === '/blank' ? '<!doctype html><title>Blank</title><p>no form</p>' : LOGIN_PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  await app.whenReady();
  note('app ready');

  const names = { a: 'persist:ext-a', b: 'persist:ext-b' };
  const sessions = {};
  for (const [label, name] of Object.entries(names)) {
    const ses = session.fromPartition(name);
    sessions[label] = ses;
    blockOutside(ses, label);
    if (args.preload) ses.registerPreloadScript({ type: 'service-worker', filePath: resolve(args.preload) });
    R.partitions[label] = { name, storagePath: ses.getStoragePath() ? 'under userData' : null, serviceWorkerConsole: [], extensionEvents: [] };
    ses.serviceWorkers.on('console-message', (_e, d) => R.partitions[label].serviceWorkerConsole.push({ t: stamp(), level: d.level, message: String(d.message).slice(0, 400), source: d.source?.replace(/^.*\//, ''), line: d.lineNumber }));
    ses.serviceWorkers.on('running-status-changed', (d) => note(`sw status ${label}`, d));
    for (const ev of ['extension-loaded', 'extension-ready', 'extension-unloaded']) ses.extensions.on(ev, (_e, ext) => R.partitions[label].extensionEvents.push({ t: stamp(), ev, id: ext.id }));
  }

  // Q1: load
  for (const [label, ses] of Object.entries(sessions)) {
    const t = Date.now();
    try {
      const ext = await within(ses.extensions.loadExtension(extDir, { allowFileAccess: false }), 30000, 'loadExtension');
      R.partitions[label].load = { ok: true, ms: Date.now() - t, id: ext.id, name: ext.name, version: ext.version, manifestVersion: ext.manifest?.manifest_version, urlScheme: ext.url?.split(':')[0], allExtensions: ses.extensions.getAllExtensions().map((e) => e.id) };
    } catch (error) {
      R.partitions[label].load = { ok: false, ms: Date.now() - t, error: String(error?.message ?? error) };
    }
    save();
  }
  const extA = R.partitions.a.load;
  if (!extA?.ok) { note('stop: extension did not load in partition a'); return finish(server); }
  const id = extA.id;

  // Q2: service worker
  await sleep(4000);
  for (const label of ['a', 'b']) {
    const running = await sessions[label].serviceWorkers.getAllRunning();
    R.partitions[label].serviceWorkerAfter4s = Object.values(running).map((w) => ({ scope: w.scope?.replace(/\/\/[^/]+/, '//<id>'), hasScript: Boolean(w.scriptUrl) }));
  }
  R.serviceWorker.idHostsMatch = true;
  save();

  // --lifetime: no popup and no page, only the worker; is it still running after the usual 30 s idle limit?
  if (args.lifetime) {
    const running = async () => Object.keys(await sessions.a.serviceWorkers.getAllRunning()).length > 0;
    R.serviceWorker.lifetime = { at4s: await running() };
    await sleep(16000); R.serviceWorker.lifetime.at20s = await running();
    await sleep(30000); R.serviceWorker.lifetime.at50s = await running();
    await sleep(15000); R.serviceWorker.lifetime.at65s = await running();
    return finish(server);
  }

  // Q3: popup in partition a (and b for Q6)
  const popups = {};
  for (const label of ['a', 'b']) {
    const win = new BrowserWindow({ show: false, width: 380, height: 600, webPreferences: { session: sessions[label], contextIsolation: true, sandbox: true } });
    const info = { console: [], failedLoads: [], gone: [] };
    R.partitions[label].popup = info;
    win.webContents.on('console-message', (e) => info.console.push({ level: e.level, message: String(e.message).slice(0, 400), source: String(e.sourceId ?? '').replace(/^.*\//, ''), line: e.lineNumber }));
    win.webContents.on('did-fail-load', (_e, code, desc, url) => info.failedLoads.push({ code, desc, url: String(url).slice(0, 120) }));
    win.webContents.on('render-process-gone', (_e, d) => info.gone.push(d));
    popups[label] = win;
    try {
      await within(win.loadURL(`chrome-extension://${id}/popup/index.html`), 20000, 'popup load');
    } catch (error) { info.loadError = String(error?.message ?? error); }
  }
  await sleep(5000);
  for (const label of ['a', 'b']) {
    const wc = popups[label].webContents;
    const info = R.partitions[label].popup;
    try { info.title = wc.getTitle(); info.url = wc.getURL().replace(id, '<id>'); } catch (error) { info.titleError = String(error); }
    try { info.bodyText = String(await within(wc.executeJavaScript('document.body ? document.body.innerText : ""'), 5000)).slice(0, 1500); } catch (error) { info.bodyTextError = String(error?.message ?? error); }
    try { info.inputs = await within(wc.executeJavaScript('[...document.querySelectorAll("input,button,a")].map((e) => e.tagName + ":" + (e.type || "") + ":" + (e.getAttribute("aria-label") || e.innerText || "").trim().slice(0, 40)).slice(0, 25)'), 5000); } catch (error) { info.inputsError = String(error?.message ?? error); }
    try { const img = await within(wc.capturePage(), 8000, 'capturePage'); const png = img.toPNG(); writeFileSync(join(outDir, `${tag}_popup_${label}.png`), png); info.screenshotBytes = png.length; info.screenshotSize = img.getSize(); } catch (error) { info.screenshotError = String(error?.message ?? error); }
  }
  save();

  // Q6: storage per partition (marker invented by the probe)
  for (const label of ['a', 'b']) {
    const wc = popups[label].webContents;
    const st = (R.partitions[label].storage = {});
    try {
      if (phase === 'write') st.writeOk = await within(wc.executeJavaScript(`chrome.storage.local.set({ probeMarker: 'marker-${label}' }).then(() => true)`), 5000);
      st.markerRead = await within(wc.executeJavaScript(`chrome.storage.local.get('probeMarker').then((v) => v.probeMarker ?? null)`), 5000);
      st.keyCount = await within(wc.executeJavaScript(`chrome.storage.local.get(null).then((v) => Object.keys(v).length)`), 5000);
      st.otherMarkerVisible = await within(wc.executeJavaScript(`chrome.storage.local.get('probeMarker').then((v) => v.probeMarker)`), 5000).then((v) => v !== `marker-${label}` && v != null);
    } catch (error) { st.error = String(error?.message ?? error); }
  }
  // popup-side API inventory
  try { R.popupInventory = JSON.parse(await within(popups.a.webContents.executeJavaScript(INVENTORY_EXPRESSION), 20000)); } catch (error) { R.popupInventory = { error: String(error?.message ?? error) }; }
  save();

  // Q4: content script in a WebContentsView of partition a (the shape the app uses)
  const base2 = new BaseWindow({ show: false, width: 900, height: 700 });
  const view = new WebContentsView({ webPreferences: { session: sessions.a, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  base2.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 0, width: 900, height: 700 });
  const wc = view.webContents;
  const page = (R.contentScript = { console: [], contexts: [], failed: [] });
  wc.on('console-message', (e) => page.console.push({ level: e.level, message: String(e.message).slice(0, 300) }));
  wc.on('did-fail-load', (_e, code, desc, url) => page.failed.push({ code, desc, url }));
  wc.debugger.attach('1.3');
  wc.debugger.on('message', (_e, method, params) => {
    if (method === 'Runtime.executionContextCreated') page.contexts.push({ name: params.context.name, origin: params.context.origin?.replace(id, '<id>'), type: params.context.auxData?.type, isDefault: params.context.auxData?.isDefault });
  });
  try { await within(wc.loadURL(`${base}/login`), 15000, 'test page load'); } catch (error) { page.loadError = String(error?.message ?? error); }
  await sleep(4000);
  // Commands sent before the first navigation can wait for it, so the domains are enabled after the load.
  await within(wc.debugger.sendCommand('Runtime.enable'), 8000, 'Runtime.enable');
  await within(wc.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true }), 8000, 'setFocusEmulationEnabled');
  const evalMain = async (expr) => { const r = await within(wc.debugger.sendCommand('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }), 8000, 'Runtime.evaluate'); return r.result?.value; };
  const snapshotDom = `JSON.stringify({ tags: [...new Set([...document.querySelectorAll('*')].map((e) => e.tagName.toLowerCase()))].sort(), iframes: [...document.querySelectorAll('iframe')].map((f) => (f.src || '').replace(/^(chrome-extension:\\/\\/)[a-p]{32}/, '$1<id>').slice(0, 100)), userAttrs: [...document.querySelector('#user').attributes].map((a) => a.name), passAttrs: [...document.querySelector('#pass').attributes].map((a) => a.name), htmlAttrs: [...document.documentElement.attributes].map((a) => a.name), bodyChildren: [...document.body.children].map((e) => e.tagName.toLowerCase()) })`;
  page.domAfterLoad = JSON.parse(await evalMain(snapshotDom));
  await evalMain(`document.querySelector('#user').focus(); true`);
  await sleep(3000);
  page.domAfterFocus = JSON.parse(await evalMain(snapshotDom));
  try { const img = await within(wc.capturePage(), 8000); writeFileSync(join(outDir, `${tag}_page.png`), img.toPNG()); page.screenshotBytes = img.toPNG().length; } catch (error) { page.screenshotError = String(error?.message ?? error); }
  page.isolatedWorldSeen = page.contexts.filter((c) => c.type === 'isolated').map((c) => ({ name: c.name, origin: c.origin }));
  save();

  // Q2 more: the service worker's own view through the browser-level CDP port
  try {
    const cdp = await within(connectBrowserCdp(), 15000, 'cdp connect');
    const { targetInfos } = await cdp.send('Target.getTargets');
    R.targets = targetInfos.map((t) => ({ type: t.type, url: t.url.replace(id, '<id>').slice(0, 100) }));
    const sw = targetInfos.find((t) => t.type === 'service_worker' && t.url.includes(id));
    R.serviceWorker.targetFound = Boolean(sw);
    if (sw) {
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: sw.targetId, flatten: true });
      await cdp.send('Runtime.enable', {}, sessionId);
      const r = await cdp.send('Runtime.evaluate', { expression: INVENTORY_EXPRESSION, awaitPromise: true, returnByValue: true }, sessionId);
      R.serviceWorker.inventory = r.exceptionDetails ? { error: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text } : JSON.parse(r.result.value);
      // scripting.executeScript into the fixture page as the extension would for autofill
      const tabs = await cdp.send('Runtime.evaluate', { expression: `(async () => { try { const tabs = await chrome.tabs.query({}); return JSON.stringify({ tabCount: tabs.length }); } catch (e) { return JSON.stringify({ error: String(e) }); } })()`, awaitPromise: true, returnByValue: true }, sessionId);
      R.serviceWorker.tabsQuery = JSON.parse(tabs.result.value);
      // What autofill does with a page: inject its script through scripting, then ask the content script for the
      // form fields. Only metadata of the fixture's fields comes back; nothing is filled and no credential exists.
      const autofill = await cdp.send('Runtime.evaluate', {
        expression: `(async () => {
          const out = { messages: [] };
          const seen = (m, s) => out.messages.push({ command: m && m.command, sender: m && m.sender, fromTab: Boolean(s && s.tab), fields: m && m.details && m.details.fields ? m.details.fields.map((f) => ({ type: f.type, name: f.htmlName, autocomplete: f.autoCompleteType, hasValue: Boolean(f.value) })) : undefined });
          chrome.runtime.onMessage.addListener(seen);
          try {
            const tabs = await chrome.tabs.query({});
            const tab = tabs.find((t) => /127\\.0\\.0\\.1/.test(t.url || ''));
            out.tabFound = Boolean(tab);
            if (!tab) return JSON.stringify(out);
            try { out.executeScript = JSON.stringify(await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/bootstrap-autofill.js'] })).slice(0, 200); } catch (e) { out.executeScriptError = String(e && e.message || e); }
            await new Promise((r) => setTimeout(r, 800));
            try { const d = await chrome.tabs.sendMessage(tab.id, { command: 'collectPageDetailsImmediately', sender: 'autofill_cmd', tab }); out.sendMessage = { keys: Object.keys(d || {}), formCount: Object.keys((d && d.forms) || {}).length, fields: ((d && d.fields) || []).map((f) => ({ type: f.type, name: f.htmlName, id: f.htmlID, autocomplete: f.autoCompleteType, viewable: f.viewable, hasValue: Boolean(f.value) })) }; } catch (e) { out.sendMessageError = String(e && e.message || e); }
            await new Promise((r) => setTimeout(r, 2500));
          } catch (e) { out.error = String(e && e.message || e); }
          return JSON.stringify(out);
        })()`, awaitPromise: true, returnByValue: true }, sessionId);
      const extras = await cdp.send('Runtime.evaluate', {
        expression: `(async () => {
          const out = {};
          const t = async (name, fn) => { try { const v = await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error('no answer in 4000 ms')), 4000))]); out[name] = { ok: true, value: String(JSON.stringify(v)).slice(0, 200) }; } catch (e) { out[name] = { ok: false, error: String(e && e.message || e).slice(0, 200) }; } };
          await t('offscreen.createDocument', async () => { await chrome.offscreen.createDocument({ url: 'offscreen-document/index.html', reasons: ['CLIPBOARD'], justification: 'probe' }); return chrome.offscreen.hasDocument(); });
          await t('runtime.getContexts', async () => (await chrome.runtime.getContexts({})).map((c) => c.contextType));
          await t('action.openPopup', () => chrome.action.openPopup());
          await t('permissions.request(nativeMessaging)', () => chrome.permissions.request({ permissions: ['nativeMessaging'] }));
          await t('tabs.create (stub)', () => chrome.tabs.create({ url: 'http://127.0.0.1/' }));
          await t('storage.session roundtrip', async () => { await chrome.storage.session.set({ k: 1 }); return chrome.storage.session.get('k'); });
          return JSON.stringify(out);
        })()`, awaitPromise: true, returnByValue: true }, sessionId);
      R.serviceWorker.extras = extras.exceptionDetails ? { error: extras.exceptionDetails.exception?.description } : JSON.parse(extras.result.value);
      R.serviceWorker.autofillProbe = autofill.exceptionDetails ? { error: autofill.exceptionDetails.exception?.description } : JSON.parse(autofill.result.value);
    }
    cdp.close();
  } catch (error) { R.serviceWorker.cdpError = String(error?.message ?? error); }
  save();

  try { page.domAfterAutofillProbe = JSON.parse(await evalMain(snapshotDom)); page.contextsAfter = page.contexts.length; } catch (error) { page.domAfterAutofillProbeError = String(error?.message ?? error); }

  // Q2: does the worker stay alive? Idle for 40 s, check, then wake it by a message from the popup.
  if (phase === 'write' && args.idle !== '0') {
    const alive = async () => Object.values(await sessions.a.serviceWorkers.getAllRunning()).length > 0;
    R.serviceWorker.aliveAtActive = await alive();
    await sleep(40000);
    R.serviceWorker.aliveAfter40sIdle = await alive();
    try { await within(popups.a.webContents.executeJavaScript(`chrome.runtime.sendMessage({ command: 'probe-ping' }).then(() => 'reply', (e) => String(e))`), 8000); } catch { /* the reply is irrelevant; the wake is */ }
    await sleep(3000);
    R.serviceWorker.aliveAfterPopupMessage = await alive();
  }
  R.consoleOfPageAfterAll = page.console.length;
  return finish(server);
}

function finish(server) {
  R.listing = { userDataEntries: safeList(userData), partitionEntries: safeList(join(userData, 'Partitions')), extensionStorage: Object.fromEntries(['ext-a', 'ext-b'].map((p) => [p, safeList(join(userData, 'Partitions', p, 'Local Extension Settings'))])) };
  R.endMs = stamp();
  save();
  server.close();
  setTimeout(() => app.exit(0), 300);
}
function safeList(dir) { try { return readdirSync(dir).map((n) => n.replace(/[a-p]{32}/, '<id>')); } catch { return null; } }

setTimeout(() => { note('watchdog'); save(); app.exit(2); }, 150000);
process.on('uncaughtException', (error) => { note('uncaught', String(error?.stack ?? error).slice(0, 500)); save(); });
main().catch((error) => { note('main failed', String(error?.stack ?? error)); save(); app.exit(1); });
