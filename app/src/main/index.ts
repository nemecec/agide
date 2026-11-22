import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';
import { CommandRegistry } from '../core/commands/index';
import { createAppEventBus } from '../core/events/index';
import { writeLastProfile } from '../core/profile/index';
import { openStore } from '../core/store/index';
import { ElectronViews } from './browser/ElectronViews';
import { wireAppearance, type AppearanceTestHook, type AppearanceWiring } from './appearanceIpc';
import { createDesktop } from './desktop';
import { isFocusRequest } from './focusRequest';
import { registerIpc } from './ipc';
import { initModules, type InitializedModules } from './modules';
import { bootProfile, type BootResult } from './profileBoot';
import { installProfileHost } from './profileHost';
import { createProfileLauncher } from './profileLauncher';
import { APP_TITLE, createMainWindow } from './window';

/**
 * Environment:
 * - `AGIDE_ROOT`: app root holding `profiles/` and `registry/`; tests pass a temporary one.
 * - `AGIDE_PROFILE`: profile to open when `--profile` is absent.
 * - `AGIDE_USER_DATA`: data directory of one unnamed profile (without `AGIDE_ROOT`); tests pass a temporary one.
 * - `AGIDE_HIDDEN=1`: never show the window (end-to-end tests).
 * - `AGIDE_TEST_HOOKS=1`: install the test hooks for a window that is shown (the visual check).
 */
const showWindow = process.env['AGIDE_HIDDEN'] !== '1';

/** Test hooks of hidden runs, read through `app.evaluate`. */
const HOOKS_KEY = '__agideTestHooks';
interface TestHooks {
  focusRequests: unknown[];
  appearance?: AppearanceTestHook;
}

const boot: BootResult = bootProfile({ argv: process.argv.slice(1), env: process.env, defaultRoot: join(app.getPath('appData'), 'agide') });
if (boot.kind === 'profile') {
  app.setPath('userData', boot.dataDir);
  app.setPath('sessionData', boot.dataDir);
} else if (boot.kind === 'legacy') {
  app.setPath('userData', process.env['AGIDE_USER_DATA'] ?? app.getPath('userData'));
}

let modules: InitializedModules | undefined;
let disposeIpc: (() => void) | undefined;
let appearance: AppearanceWiring | undefined;
let closeDb: (() => void) | undefined;
let mainWindow: BrowserWindow | undefined;
let browserViews: ElectronViews | undefined;

function focusMainWindow(): void {
  const [window] = BrowserWindow.getAllWindows();
  if (!window) return;
  if (window.isMinimized()) window.restore();
  app.focus({ steal: true });
  window.focus();
}

async function start(): Promise<void> {
  const dataDir = app.getPath('userData');
  const db = openStore(join(dataDir, 'app.db'));
  closeDb = () => db.close();
  const events = createAppEventBus();
  const commands = new CommandRegistry();
  const profile = boot.kind === 'profile' ? boot.resolved : undefined;
  const desktop = createDesktop({ quiet: !showWindow });
  if (boot.kind === 'profile' && boot.notice) desktop.notify({ title: APP_TITLE, body: boot.notice });

  if (profile) {
    installProfileHost({
      open: createProfileLauncher({
        ownId: profile.id,
        focusOwnWindow: focusMainWindow,
        executable: process.execPath,
        appArgs: process.defaultApp ? [process.argv.slice(1).find((arg) => !arg.startsWith('-')) ?? ''] : [],
        env: process.env,
        onFailure: (id, error) => console.error(`could not start profile ${id}: ${error.message}`),
      }),
    });
  }

  browserViews = new ElectronViews({ mainWindow: () => mainWindow, dataDir: app.getPath('userData') });
  modules = await initModules({
    events,
    commands,
    db,
    dataDir,
    protectedReadDirs: [app.getPath('logs'), app.getPath('crashDumps')],
    desktop,
    browserViews,
    ...(profile ? { profile } : {}),
  });
  disposeIpc = registerIpc(commands, events);
  appearance = wireAppearance(modules.services.theme);
  const hooks = (globalThis as Record<string, unknown>)[HOOKS_KEY] as TestHooks | undefined;
  if (hooks) hooks.appearance = appearance.hook;

  const title = boot.kind === 'profile' ? `${boot.definition.name} · ${APP_TITLE}` : undefined;
  mainWindow = createMainWindow({ show: showWindow, ...(title ? { title } : {}) });
  // The hidden window that parks browser views must not keep the app alive after the app window closed.
  mainWindow.once('closed', () => browserViews?.dispose());
  if (profile) {
    const remember = (): void => writeLastProfile(profile.root, profile.id);
    mainWindow.on('focus', remember);
    remember();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow({ show: showWindow, ...(title ? { title } : {}) });
  });
}

app.on('window-all-closed', () => app.quit());

// Backstop for every webContents that is neither the app window nor one the browser module built (0026 section
// 5). Electron emits the event while a view is still being constructed, before the module can record it, so the
// check runs one turn later.
app.on('web-contents-created', (_event, contents) => {
  setImmediate(() => {
    if (contents.isDestroyed() || contents.getType() !== 'window') return;
    if (contents === mainWindow?.webContents || browserViews?.owns(contents)) return;
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (event) => event.preventDefault());
    contents.on('will-attach-webview', (event) => event.preventDefault());
  });
});

// Disposal is asynchronous, so the first quit is held and the app exits once the modules are disposed.
// `app.exit` follows in place of a second `app.quit`: under Playwright a second `app.quit` does not quit.
app.on('will-quit', (event) => {
  if (!modules) return;
  event.preventDefault();
  const disposing = modules;
  modules = undefined;
  disposeIpc?.();
  appearance?.dispose();
  void disposing
    .dispose()
    .catch((error: unknown) => console.error(error))
    .finally(() => {
      browserViews?.dispose();
      closeDb?.();
      app.exit(0);
    });
});

function onSecondInstance(additionalData: unknown): void {
  const hooks = (globalThis as Record<string, unknown>)[HOOKS_KEY] as TestHooks | undefined;
  hooks?.focusRequests.push(additionalData);
  focusMainWindow();
}

if (!showWindow || process.env['AGIDE_TEST_HOOKS'] === '1') (globalThis as Record<string, unknown>)[HOOKS_KEY] = { focusRequests: [] } satisfies TestHooks;

if (boot.kind === 'busy') {
  console.error('A milestone 1 instance of Agide is still running. Quit it and start again.');
  app.exit(1);
} else {
  // The lock is keyed to `userData`, so each profile has its own; a second start of one profile exits here
  // and the running process gets `second-instance` with the request.
  const lockData = boot.kind === 'profile' ? { profileId: boot.resolved.id, action: 'focus' } : undefined;
  const gotLock = lockData ? app.requestSingleInstanceLock(lockData) : app.requestSingleInstanceLock();
  if (!gotLock) {
    app.exit(0);
  } else {
    app.on('second-instance', (_event, _argv, _cwd, additionalData) => {
      if (boot.kind === 'profile' && !isFocusRequest(additionalData, boot.resolved.id)) return;
      onSecondInstance(additionalData);
    });
    app
      .whenReady()
      .then(start)
      .catch((error: unknown) => {
        console.error(error);
        app.exit(1);
      });
  }
}
