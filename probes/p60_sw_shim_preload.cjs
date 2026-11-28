// P60: a service-worker preload that adds inert stubs for the chrome.* namespaces that Electron does not provide
// and that the Bitwarden background script touches while it starts. The stubs do nothing; the probe asks whether the
// worker then starts, not whether the features work. Registered by p58_ext_load.mjs with --preload. The stubs are
// installed in the worker's main world through contextBridge.executeInMainWorld, because the preload itself runs in
// an isolated world that has no `chrome` global.
const { contextBridge } = require('electron');

function installInMainWorld() {
  const noop = () => {};
  const event = () => ({ addListener: noop, removeListener: noop, hasListener: () => false });
  const asyncValue = (value) => async () => value;
  const notes = [];
  const add = (target, name, value) => {
    try {
      if (target[name] === undefined) target[name] = value;
      notes.push(`${name}:${typeof target[name]}`);
    } catch (error) {
      notes.push(`${name}:failed:${String(error && error.message)}`);
    }
  };
  const root = globalThis.chrome;
  if (!root) {
    console.log('p60 shim: no chrome global in the main world');
    return;
  }
  add(root, 'webNavigation', { onCommitted: event(), onCompleted: event(), onBeforeNavigate: event(), getAllFrames: asyncValue([]), getFrame: asyncValue(null) });
  add(root, 'contextMenus', { create: (_o, cb) => { if (cb) cb(); return 0; }, update: asyncValue(), remove: asyncValue(), removeAll: asyncValue(), onClicked: event() });
  add(root, 'commands', { getAll: asyncValue([]), onCommand: event() });
  add(root, 'notifications', { create: asyncValue(''), clear: asyncValue(true), onClicked: event(), onButtonClicked: event() });
  add(root, 'privacy', { services: { passwordSavingEnabled: { get: asyncValue({ value: true }), set: asyncValue(), clear: asyncValue() } } });
  add(root, 'windows', { WINDOW_ID_CURRENT: -2, create: asyncValue({}), get: asyncValue({}), getAll: asyncValue([]), getCurrent: asyncValue({}), update: asyncValue({}), remove: asyncValue(), onCreated: event(), onRemoved: event(), onFocusChanged: event() });
  if (root.tabs) {
    for (const name of ['create', 'remove', 'getCurrent', 'captureVisibleTab']) add(root.tabs, name, asyncValue(undefined));
    add(root.tabs, 'onReplaced', event());
  }
  console.log(`p60 shim installed: ${notes.join(' ')}`);
}

try {
  contextBridge.executeInMainWorld({ func: installInMainWorld });
} catch (error) {
  console.log(`p60 shim: executeInMainWorld failed: ${String(error && error.message)}`);
}
