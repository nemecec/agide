// States 10 and the setup pane of 5: two profiles side by side and a badge in the other profile's rail.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadTs } from '../loadTs.mjs';
import { closeApp, createFolder, shoot, sleep, startApp, startSession, value } from './harness.mjs';
import { callTool, connectAsSession } from './mcp.mjs';

const place = (instance, x) => instance.app.evaluate(({ BrowserWindow }, left) => BrowserWindow.getAllWindows().find((w) => w.isVisible())?.setPosition(left, 40), x);

export async function phaseProfiles(context) {
  const root = join(context.run.data, 'profiles-root');
  const { modules, close } = await loadTs(['/src/core/profile/index.ts']);
  const apps = [];
  try {
    const first = await startApp(context, { name: 'profile-default', visible: true, root, profile: 'default', size: { width: 900, height: 700 } });
    apps.push(first);
    new modules[0].FileProfileStore({ root, ownerId: 'default' }).create({ name: 'Work', colour: '#2f7d4f' });
    mkdirSync(join(root, 'profiles', 'work', 'claude'), { recursive: true });
    writeFileSync(join(root, 'profiles', 'work', 'claude', 'logged-out'), '');
    const second = await startApp(context, { name: 'profile-work', visible: true, root, profile: 'work', size: { width: 900, height: 700 }, });
    apps.push(second);
    await place(first, 0);
    await place(second, 920);
    const folder = await createFolder(first, 'Project A');
    const sessionId = await startSession(first, folder, 'Fix upload retry');
    await callTool(await connectAsSession(first, sessionId), 'inbox_post', { message: 'Upload retry fixed, tests are green' });
    await createFolder(second, 'Project B');
    await sleep(8000);
    await shoot(context, first, '10-profiles-default-window', { screen: true });
    await shoot(context, second, '10-profiles-work-window-badge-and-setup', { screen: true });
    await value(second, 'profile_setup_status', {}).then((status) => context.run.note(`work profile setup status: needed=${status.needed}, signedIn=${status.login.signedIn}`));
  } finally {
    for (const app of apps) await closeApp(app);
    await close();
  }
}
