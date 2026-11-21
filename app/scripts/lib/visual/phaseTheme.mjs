// State 14: the main views in System light, System dark and increased contrast, by changing what the OS reports.
// Light and dark come from nativeTheme.themeSource; increased contrast and an accent come from the appearance
// adapter's test hook, because the OS setting cannot be switched on from a test.
import { closeApp, menu, shoot, sleep, startApp, startPageServer } from './harness.mjs';
import { postStatus, seedWorkspace } from './seed.mjs';

const MODES = [
  { name: 'system-light', source: 'light', override: {} },
  { name: 'system-dark', source: 'dark', override: {} },
  { name: 'contrast-light', source: 'light', override: { highContrast: true } },
  { name: 'contrast-dark', source: 'dark', override: { highContrast: true } },
  { name: 'accent-pink-light', source: 'light', override: { accent: '#f74f9e' } },
];

async function setMode(instance, mode) {
  await instance.app.evaluate(({ nativeTheme }, source) => {
    nativeTheme.themeSource = source;
  }, mode.source);
  await instance.app.evaluate((_electron, override) => {
    globalThis.__agideTestHooks.appearance.override(override);
  }, mode.override);
  await instance.page.waitForFunction((scheme) => document.documentElement.dataset.scheme === scheme, mode.source);
  await sleep(500);
}

export async function phaseTheme(context) {
  const page = await startPageServer();
  const instance = await startApp(context, { name: 'theme', visible: true, env: { AGIDE_TEST_HOOKS: '1' } });
  try {
    const ids = await seedWorkspace(instance, { origin: page.origin });
    await postStatus(instance, ids.idle, 'Summary of the research notes is ready for review', 'Plain text details of the update.');
    for (const mode of MODES) {
      await setMode(instance, mode);
      await instance.page.getByRole('treeitem', { name: 'Fix upload retry' }).click();
      await sleep(600);
      await shoot(context, instance, `14-theme-${mode.name}-session`, { screen: true });
      await menu(instance, 'Backend', 'New Claude session…');
      await sleep(500);
      await shoot(context, instance, `14-theme-${mode.name}-dialog`);
      await instance.page.keyboard.press('Escape');
      if ((await instance.page.getByTestId('new-session-dialog').count()) > 0) await instance.page.getByRole('button', { name: 'Cancel' }).click();
      await instance.page.getByText('Inbox', { exact: true }).first().click();
      await sleep(500);
      await shoot(context, instance, `14-theme-${mode.name}-inbox`);
      await instance.page.getByRole('treeitem', { name: /Fix upload retry/ }).click();
    }
  } finally {
    await closeApp(instance);
    await page.close();
  }
}
