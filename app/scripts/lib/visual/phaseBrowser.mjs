// State 6: a browser tab with its chrome, observation, an agent navigation request and things drawn above the native view.
import { closeApp, createFolder, invoke, menu, shoot, sleep, startApp, startPageServer, startSession, value } from './harness.mjs';
import { callTool, connectAsSession } from './mcp.mjs';

export async function phaseBrowser(context) {
  const page = await startPageServer();
  const instance = await startApp(context, { name: 'browser', visible: true });
  try {
    const folder = await createFolder(instance, 'Project A');
    const tab = (await value(instance, 'browser_new_tab', { folderId: folder, url: `${page.origin}/` })).leafId;
    await sleep(800);
    const folderRow = instance.page.getByRole('treeitem', { name: 'Project A', exact: true });
    if ((await folderRow.getAttribute('aria-expanded')) === 'false') await folderRow.dblclick();
    await sleep(500);
    await instance.page.getByRole('treeitem', { name: /127\.0\.0\.1|Sample/ }).first().click();
    await instance.page.getByTestId('browser-chrome').waitFor();
    for (let i = 0; i < 40; i++) {
      if ((await value(instance, 'browser_tab_state', { leafId: tab })).title === 'Sample page') break;
      await sleep(250);
    }
    await sleep(1500);
    const sessionId = await startSession(instance, folder, 'Check the dashboard');
    await instance.page.getByRole('treeitem', { name: /127\.0\.0\.1|Sample/ }).first().click();
    await sleep(1500);
    await shoot(context, instance, '06-browser-tab-observation-on-demand', { screen: true, pageShot: true });

    await invoke(instance, 'ui_set_observation', { nodeId: tab, mode: 'off' });
    await sleep(600);
    await shoot(context, instance, '06-browser-tab-observation-off', { screen: true, pageShot: true });
    await invoke(instance, 'ui_set_observation', { nodeId: tab, mode: 'live' });
    await sleep(600);
    await shoot(context, instance, '06-browser-tab-observation-live');

    await instance.page.getByTestId('observation-button').click();
    await sleep(600);
    await shoot(context, instance, '06-browser-observation-popover-over-view', { screen: true, pageShot: true });
    await instance.page.keyboard.press('Escape');
    await instance.page.getByTestId('observation-button').click().catch(() => undefined);
    await instance.page.getByRole('button', { name: 'Tab menu' }).click();
    await sleep(600);
    await shoot(context, instance, '06-browser-tab-menu-over-view', { screen: true, pageShot: true });
    await instance.page.keyboard.press('Escape');
    await instance.page.getByRole('button', { name: 'Tab menu' }).click().catch(() => undefined);

    await menu(instance, 'Project A', undefined);
    await sleep(600);
    await shoot(context, instance, '06-browser-context-menu-over-view', { screen: true, pageShot: true });
    await instance.page.getByRole('menuitem', { name: 'New Claude session…', exact: true }).click();
    await instance.page.getByTestId('new-session-dialog').waitFor();
    await sleep(700);
    await shoot(context, instance, '06-browser-dialog-over-view', { screen: true, pageShot: true });
    await instance.page.keyboard.press('Escape');
    if ((await instance.page.getByTestId('new-session-dialog').count()) > 0) await instance.page.getByRole('button', { name: 'Cancel' }).click();

    await invoke(instance, 'ui_set_observation', { nodeId: tab, mode: 'on-demand' });
    const client = await connectAsSession(instance, sessionId, 'agide-browser');
    const pending = callTool(client, 'navigate', { tabId: 1, url: 'http://staging.example.test/' }).catch(() => undefined);
    await instance.page.getByTestId('approval-bar').waitFor({ timeout: 15_000 });
    await sleep(600);
    await shoot(context, instance, '06-browser-agent-navigation-bar', { screen: true, pageShot: true });
    await instance.page.getByTestId('approval-bar').getByRole('button', { name: 'Deny' }).click();
    await pending;
    await sleep(500);
  } finally {
    await closeApp(instance);
    await page.close();
  }
}
