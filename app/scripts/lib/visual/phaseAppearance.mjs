// State 12: light and dark appearance, by media emulation and by the app's native theme.
import { closeApp, menu, shoot, sleep, startApp, startPageServer } from './harness.mjs';
import { postStatus, seedWorkspace } from './seed.mjs';

export async function phaseAppearance(context) {
  const page = await startPageServer();
  const instance = await startApp(context, { name: 'appearance', visible: true });
  try {
    const ids = await seedWorkspace(instance, { origin: page.origin });
    await postStatus(instance, ids.idle, 'Summary of the research notes is ready for review', 'Plain text details of the update.');
    await instance.page.getByRole('treeitem', { name: 'Fix upload retry' }).click();
    await sleep(600);
    for (const mode of ['light', 'dark']) {
      await instance.app.evaluate(({ nativeTheme }, theme) => {
        nativeTheme.themeSource = theme;
      }, mode);
      await instance.page.emulateMedia({ colorScheme: mode });
      await sleep(700);
      await shoot(context, instance, `12-appearance-${mode}-session`, { screen: true });
      await menu(instance, 'Backend', 'New Claude session…');
      await sleep(500);
      await shoot(context, instance, `12-appearance-${mode}-dialog`);
      await instance.page.keyboard.press('Escape');
      if ((await instance.page.getByTestId('new-session-dialog').count()) > 0) await instance.page.getByRole('button', { name: 'Cancel' }).click();
      await instance.page.getByText('Inbox', { exact: true }).first().click();
      await sleep(500);
      await shoot(context, instance, `12-appearance-${mode}-inbox`);
      await instance.page.getByText('Surface host', { exact: true }).first().click();
    }
  } finally {
    await closeApp(instance);
    await page.close();
  }
}
