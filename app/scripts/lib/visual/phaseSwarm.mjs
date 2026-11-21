// Swarm screens on the swarm manager with the fake stream-json CLI as claude: tree rows, start dialog, swarm pane, approval card, stop dialog.
import { fileURLToPath } from 'node:url';
import { closeApp, createFolder, invoke, menu, shoot, sleep, startApp, value, writeLayout } from './harness.mjs';

const DEFINITION = {
  version: 1,
  goal: 'Check the retry policy of the uploader',
  budget: { usdTotal: 3 },
  agents: [
    { name: 'worker', workspace: 'scratch', prompt: '/cost 0.4\n/tool Bash {"command":"npm test"}\n/text tests passed' },
    { name: 'helper', workspace: 'scratch', role: 'mechanical', prompt: '/cost 0.2\n/sleep 600000' },
    { name: 'review', workspace: 'scratch', role: 'reviewer', stage: 1, prompt: '/text reviewed' },
  ],
};

export async function phaseSwarm(context) {
  const instance = await startApp(context, { name: 'swarm', env: { AGIDE_CLAUDE_BIN: fileURLToPath(new URL('../../../src/core/swarm/fixtures/fake-claude-stream.mjs', import.meta.url)) } });
  const { page } = instance;
  try {
    await createFolder(instance, 'Project');
    writeLayout(instance, 'swarm', { panes: {}, tabs: ['main', 'inbox'], active: 'main' });
    await sleep(500);
    await invoke(instance, 'layout_switch', { layoutId: 'swarm' });
    await sleep(600);
    await menu(instance, 'Project', 'New swarm…');
    await page.getByTestId('start-swarm-dialog').waitFor();
    await shoot(context, instance, '12-swarm-dialog-form-empty');
    await page.getByTestId('swarm-template').click();
    await page.getByRole('option', { name: 'Implement, test and review' }).click();
    await page.getByTestId('swarm-start').click();
    await sleep(300);
    await shoot(context, instance, '12-swarm-dialog-validation');
    await page.getByTestId('swarm-tab-json').click();
    await shoot(context, instance, '12-swarm-dialog-json');
    await page.getByTestId('swarm-json').fill(JSON.stringify(DEFINITION));
    await page.getByTestId('swarm-tab-form').click();
    await page.getByTestId('swarm-preview-disclosure').getByRole('button').click();
    await shoot(context, instance, '12-swarm-dialog-preview');
    await page.getByTestId('swarm-start').click();
    await sleep(1500);
    for (const title of ['Project']) {
      const row = page.getByRole('treeitem', { name: new RegExp(`^${title}`) }).first();
      if ((await row.getAttribute('aria-expanded')) !== 'true') await row.dblclick();
    }
    const swarm = page.getByRole('treeitem', { name: /^Check the retry/ }).first();
    if ((await swarm.getAttribute('aria-expanded')) !== 'true') await swarm.dblclick();
    await sleep(500);
    await shoot(context, instance, '12-swarm-tree');
    await menu(instance, null, null).catch(() => undefined);
    await page.keyboard.press('Escape');
    await swarm.click({ button: 'right' });
    await shoot(context, instance, '12-swarm-folder-menu');
    await page.getByRole('menuitem', { name: 'Results', exact: true }).click();
    await sleep(800);
    await shoot(context, instance, '12-swarm-pane-agents');
    await page.getByRole('tab', { name: 'Inbox' }).click();
    await sleep(500);
    await page.getByTestId('inbox-row').first().click();
    await shoot(context, instance, '12-swarm-approval-card');
    await page.getByTestId('swarm-approval-allow').click();
    await sleep(800);
    await page.getByRole('tab', { name: 'Swarm' }).click();
    await page.getByTestId('swarm-tab-results').click();
    await sleep(500);
    await shoot(context, instance, '12-swarm-pane-results');
    await page.getByTestId('swarm-stop').click();
    await shoot(context, instance, '12-swarm-stop-dialog');
    await page.getByTestId('swarm-stop-confirm').click();
    await sleep(800);
    await shoot(context, instance, '12-swarm-stopped');
    await value(instance, 'swarm_list', {});
  } finally {
    await closeApp(instance);
  }
}
