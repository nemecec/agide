// State 11: an invalid layout file, a missing claude binary, a missing provider runtime, a very long folder name, many nodes.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { closeApp, createFolder, invoke, menu, NARROW_SIZE, resize, DEFAULT_SIZE, shoot, sleep, startApp, value, writeLayout } from './harness.mjs';

async function invalidLayout(context) {
  const instance = await startApp(context, { name: 'layout-error' });
  try {
    writeLayout(instance, 'custom', { panes: {}, tabs: ['main', 'inbox'], active: 'main' });
    await sleep(500);
    await invoke(instance, 'layout_switch', { layoutId: 'custom' });
    await sleep(600);
    writeFileSync(join(instance.layoutsDir, 'custom.json'), JSON.stringify({ schemaVersion: 1, revision: 2, id: 'custom', title: 'custom', instances: { main: { type: 'agide/surface-host' } }, arrangement: { split: 'row', children: [] } }));
    await instance.page.getByTestId('layout-error').waitFor({ timeout: 15_000 }).catch(() => context.run.note('invalid layout: no layout-error element appeared'));
    await sleep(500);
    await shoot(context, instance, '11-invalid-layout-notice');
  } finally {
    await closeApp(instance);
  }
}

async function missingRuntimes(context) {
  const instance = await startApp(context, { name: 'missing-runtimes', env: { AGIDE_CLAUDE_BIN: '/nonexistent/claude', AGIDE_SRT_BIN: '/nonexistent/srt' } });
  try {
    const folder = await createFolder(instance, 'Project A');
    await menu(instance, 'Project A', 'New Claude session…');
    await instance.page.getByTestId('new-session-dialog').waitFor();
    await instance.page.getByTestId('new-session-start').click();
    await sleep(1500);
    await shoot(context, instance, '11-claude-binary-missing');
    await instance.page.keyboard.press('Escape');
    if ((await instance.page.getByTestId('new-session-dialog').count()) > 0) await instance.page.getByRole('button', { name: 'Cancel' }).click();
    await invoke(instance, 'isolation_set_provider', { provider: 'srt' }).then((result) => context.run.note(`selecting srt without a runtime: ${result.ok ? 'accepted' : result.error.message}`));
    await menu(instance, { x: 150, y: 600 }, 'Profile settings…');
    await instance.page.getByTestId('settings-isolation').scrollIntoViewIfNeeded();
    await sleep(800);
    await shoot(context, instance, '11-provider-runtime-missing');
    await instance.page.keyboard.press('Escape');

    await instance.page.reload();
    await instance.page.getByRole('tree', { name: 'Task tree' }).waitFor();
    const longName = 'A very long folder name that keeps going past the width of the tree pane to show how truncation behaves in the row';
    const long = await createFolder(instance, longName, folder);
    await createFolder(instance, 'Short', long);
    for (let group = 0; group < 30; group++) {
      const parent = await createFolder(instance, `Group ${group + 1}`, folder);
      for (let child = 0; child < 4; child++) await createFolder(instance, `Item ${group + 1}.${child + 1}`, parent);
    }
    await sleep(1000);
    await instance.page.getByRole('treeitem', { name: 'Project A', exact: true }).dblclick();
    await sleep(500);
    await instance.page.getByRole('treeitem', { name: /^A very long folder name/ }).dblclick().catch(() => undefined);
    await sleep(500);
    await shoot(context, instance, '11-long-name-and-many-nodes');
    await resize(instance, NARROW_SIZE);
    await shoot(context, instance, '11-long-name-and-many-nodes-900');
    await instance.page.getByTestId('tree-pane').evaluate((pane) => pane.scrollTo?.(0, pane.scrollHeight));
    await instance.page.getByRole('tree', { name: 'Task tree' }).evaluate((tree) => {
      for (let el = tree; el; el = el.parentElement) el.scrollTop = el.scrollHeight;
    });
    await sleep(400);
    await shoot(context, instance, '11-many-nodes-scrolled-to-end-900');
    await resize(instance, DEFAULT_SIZE);
  } finally {
    await closeApp(instance);
  }
}

export async function phaseErrors(context) {
  await invalidLayout(context);
  await missingRuntimes(context);
}
