import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';
import { CommandRegistry } from '../core/commands/index';
import { createAppEventBus } from '../core/events/index';
import { openStore } from '../core/store/index';
import { registerIpc } from './ipc';
import { initModules, type InitializedModules } from './modules';
import { createMainWindow } from './window';

/**
 * Environment:
 * - `AGIDE_USER_DATA`: data directory; tests pass a temporary one.
 * - `AGIDE_HIDDEN=1`: never show the window (end-to-end tests).
 */
const userDataOverride = process.env['AGIDE_USER_DATA'];
if (userDataOverride) app.setPath('userData', userDataOverride);
const showWindow = process.env['AGIDE_HIDDEN'] !== '1';

let modules: InitializedModules | undefined;
let disposeIpc: (() => void) | undefined;
let closeDb: (() => void) | undefined;

async function start(): Promise<void> {
  const dataDir = app.getPath('userData');
  mkdirSync(dataDir, { recursive: true });
  const db = openStore(join(dataDir, 'app.db'));
  closeDb = () => db.close();
  const events = createAppEventBus();
  const commands = new CommandRegistry();
  modules = await initModules({ events, commands, db, dataDir });
  disposeIpc = registerIpc(commands, events);
  createMainWindow({ show: showWindow });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow({ show: showWindow });
  });
}

app.on('window-all-closed', () => app.quit());

// Disposal is asynchronous, so the first quit is held and the app exits once the modules are disposed.
// `app.exit` follows in place of a second `app.quit`: under Playwright a second `app.quit` does not quit.
app.on('will-quit', (event) => {
  if (!modules) return;
  event.preventDefault();
  const disposing = modules;
  modules = undefined;
  disposeIpc?.();
  void disposing
    .dispose()
    .catch((error: unknown) => console.error(error))
    .finally(() => {
      closeDb?.();
      app.exit(0);
    });
});

// A second instance on the same data directory would open the same database and run its own sessions.
if (!app.requestSingleInstanceLock()) {
  app.exit(0);
} else {
  app.on('second-instance', () => {
    const [window] = BrowserWindow.getAllWindows();
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });
  app
    .whenReady()
    .then(start)
    .catch((error: unknown) => {
      console.error(error);
      app.exit(1);
    });
}
