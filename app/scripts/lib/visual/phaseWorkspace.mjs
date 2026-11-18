// States 1 to 5, 7 to 9 and the empty and many-node variants of 11: the main window, dialogs, agents, usage and the inbox.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { closeApp, DEFAULT_SIZE, expandAll, installFakeGh, invoke, menu, NARROW_SIZE, resize, samplePullRequest, shoot, sleep, startApp, startPageServer, type, value, WIDE_SIZE, writeLayout } from './harness.mjs';
import { postStatus, seedWorkspace } from './seed.mjs';

const SIZES = [
  ['1440', DEFAULT_SIZE],
  ['900', NARROW_SIZE],
  ['1920', WIDE_SIZE],
];

async function atSizes(context, instance, name, options) {
  for (const [label, size] of SIZES) {
    await resize(instance, size);
    await shoot(context, instance, `${name}-${label}`, label === '1440' ? options : {});
  }
  await resize(instance, DEFAULT_SIZE);
}

async function openTab(instance, name) {
  await instance.page.getByText(name, { exact: true }).first().click();
  await sleep(300);
}

async function openInboxTab(instance) {
  await openTab(instance, 'Inbox');
  await sleep(300);
}

async function openSurface(instance, title) {
  await instance.page.getByRole('treeitem', { name: title }).first().click();
  await sleep(500);
}

/** State 1 and the empty inbox: the default profile on first launch. */
async function empty(context) {
  const instance = await startApp(context, { name: 'empty', visible: true, root: join(context.run.data, 'empty', 'root'), profile: 'default' });
  try {
    await sleep(800);
    await shoot(context, instance, '01-first-launch', { screen: true });
    await openInboxTab(instance);
    await shoot(context, instance, '11-empty-inbox');
  } finally {
    await closeApp(instance);
  }
}

/** States 2 and 3: the populated tree at three sizes and the two layout presets. */
async function populated(context) {
  const page = await startPageServer();
  const instance = await startApp(context, { name: 'workspace', visible: true });
  try {
    const ids = await seedWorkspace(instance, { origin: page.origin });
    await openSurface(instance, 'Fix upload retry');
    await sleep(500);
    await atSizes(context, instance, '02-tree-populated', { screen: true });
    await shoot(context, instance, '03-layout-session');
    await invoke(instance, 'layout_switch', { layoutId: 'pair' });
    await sleep(600);
    await invoke(instance, 'ui_open_to_side', { nodeId: ids.tab });
    await sleep(2500);
    await expandAll(instance);
    await openSurface(instance, 'Fix upload retry');
    await sleep(1500);
    await shoot(context, instance, '03-layout-pair', { screen: true });
    await invoke(instance, 'layout_switch', { layoutId: 'session' });
    await sleep(800);
    await expandAll(instance);
    await openSurface(instance, 'Fix upload retry');
    await shoot(context, instance, '03-layout-session-terminal');
  } finally {
    await closeApp(instance);
    await page.close();
  }
}

/** State 4 and the settings panel of state 5. */
async function dialogs(context) {
  const repo = join(context.run.data, 'sample-app');
  mkdirSync(repo, { recursive: true });
  for (const args of [['init', '-q'], ['remote', 'add', 'origin', 'https://github.com/example-org/sample-app.git']]) execFileSync('git', args, { cwd: repo });
  const gh = installFakeGh(context.run.dir, samplePullRequest);
  const app = await startApp(context, { name: 'dialogs', env: { PATH: gh.path, ...gh.env } });
  try {
    await seedWorkspace(app);
    await menu(app, 'Backend', 'New Claude session…');
    await app.page.getByTestId('new-session-dialog').waitFor();
    await shoot(context, app, '04-new-session-dialog');
    await app.page.keyboard.press('Escape');
    await sleep(300);
    if ((await app.page.getByTestId('new-session-dialog').count()) > 0) await app.page.getByRole('button', { name: 'Cancel' }).click();

    await menu(app, 'Project A', 'New task…');
    await app.page.getByTestId('new-task-dialog').waitFor();
    await shoot(context, app, '04-new-task-dialog-empty');
    await app.page.getByTestId('task-source').fill('Add a retry with backoff to the uploader and cover it with a test');
    await sleep(400);
    await shoot(context, app, '04-new-task-dialog-prompt');
    await app.page.getByTestId('task-source').fill('example-org/sample-app#7');
    await app.page.getByTestId('task-repo').fill(repo);
    await sleep(1500);
    await shoot(context, app, '04-new-task-dialog-pull-request');
    await app.page.getByTestId('task-source').fill('SAMPLE-123');
    await sleep(600);
    await shoot(context, app, '04-new-task-dialog-jira');
    await app.page.keyboard.press('Escape');
    await sleep(300);
    if ((await app.page.getByTestId('new-task-dialog').count()) > 0) await app.page.getByRole('button', { name: 'Cancel' }).click();

    await menu(app, { x: 150, y: 600 }, 'Profile settings…');
    await app.page.getByTestId('settings-panel').waitFor();
    await shoot(context, app, '05-settings-top');
    const panel = app.page.getByTestId('settings-panel');
    for (const [name, testId] of [['network', 'permissions-network'], ['sandbox', 'permissions-sandbox'], ['isolation', 'settings-isolation']]) {
      await app.page.getByTestId(testId).scrollIntoViewIfNeeded().catch(() => undefined);
      await sleep(300);
      await shoot(context, app, `05-settings-${name}`);
    }
    await panel.press('Escape').catch(() => undefined);
  } finally {
    await closeApp(app);
  }
}

/** State 7: agent nodes in their states, the removal delay and the history. */
async function agents(context) {
  const instance = await startApp(context, { name: 'agents' });
  try {
    writeLayout(instance, 'agents', { panes: { usage: 'agide/usage-ranking', history: 'agide/agent-history' }, tabs: ['usage', 'history', 'main', 'inbox'], active: 'main' });
    await sleep(500);
    await invoke(instance, 'layout_switch', { layoutId: 'agents' });
    await value(instance, 'agents_settings_set', { removeDoneAfterSeconds: 4 });
    const ids = await seedWorkspace(instance);
    await type(instance, ids.working, '/agent a1 Read the upload module');
    await type(instance, ids.working, '/agent a2 Run the unit tests');
    await type(instance, ids.working, '/agent a3 Update the changelog');
    await type(instance, ids.working, '/agent a4 Check the lint output');
    await sleep(600);
    await type(instance, ids.working, '/hook PermissionRequest {"agent_id":"a2","tool_name":"Bash","tool_input":{"command":"npm test"}}');
    await type(instance, ids.working, '/agentfail a3');
    await type(instance, ids.working, '/agentstop a4');
    await sleep(1200);
    await shoot(context, instance, '07-agents-running-waiting-failed');
    await sleep(5500);
    await shoot(context, instance, '07-agents-after-removal-delay');
    await menu(instance, { x: 150, y: 700 }, 'Show finished agents');
    await sleep(600);
    await shoot(context, instance, '07-agents-show-finished');
    await openTab(instance, 'Agent history');
    await sleep(600);
    await shoot(context, instance, '07-agents-history-pane');

    for (const [session, cost, lines] of [[ids.working, 1.8, 3], [ids.waiting, 0.6, 2], [ids.idle, 0.05, 1]]) {
      await type(instance, session, `/lines ${lines} ${Math.round(cost * 200000)}`);
      await type(instance, session, `/status ${cost} ${session === ids.working ? 47 : 12}`);
    }
    await sleep(2500);
    await openTab(instance, 'Usage ranking');
    await sleep(1200);
    await shoot(context, instance, '08-usage-pane-heat-plan');
  } finally {
    await closeApp(instance);
  }
}

/** State 9: the inbox with several kinds of item, the card, the long description, the peek and the back control. */
async function inbox(context) {
  const instance = await startApp(context, { name: 'inbox' });
  try {
    const nextMinute = new Date(Math.ceil((Date.now() + 8000) / 60_000) * 60_000);
    const ids = await seedWorkspace(instance);
    await value(instance, 'reminder_create', { title: 'Review the open pull requests', details: 'Daily check', folderId: ids.projectA, dtstart: nextMinute.toISOString().slice(0, 16), tzid: 'UTC' });
    await value(instance, 'inbox_set_project_summary', { folderId: ids.backend, summary: 'Rewrite of the upload job and its retry policy' });
    await value(instance, 'inbox_set_session_summary', { sessionId: ids.working, summary: 'Fixing the retry loop in the uploader', model: 'haiku' });
    const long = 'The retry loop now backs off exponentially and stops after three attempts. '.repeat(14);
    await postStatus(instance, ids.working, 'Upload retry fixed, tests are green', long);
    await postStatus(instance, ids.idle, 'Summary of the research notes is ready for review');
    await type(instance, ids.idle, '/hook StopFailure {"error":"server_error","error_details":"The service returned an error"}');
    await type(instance, ids.working, '/hook StopFailure {"error":"rate_limit","error_details":"Usage limit close for this window"}');
    await type(instance, ids.waiting, '/status 4.2 93');
    for (let i = 0; i < 80; i++) {
      const items = (await value(instance, 'inbox_list', {})).items;
      if (items.some((item) => item.kind === 'reminder')) break;
      await sleep(1500);
    }
    await sleep(1500);
    await openInboxTab(instance);
    await shoot(context, instance, '09-inbox-list');
    await instance.page.getByTestId('inbox-row').first().click();
    await sleep(500);
    await shoot(context, instance, '09-inbox-card-first');
    const rows = instance.page.getByTestId('inbox-row');
    const count = await rows.count();
    for (let index = 0; index < count; index++) {
      await rows.nth(index).click();
      await sleep(350);
      const kind = (await rows.nth(index).getAttribute('data-kind')) ?? `item${index}`;
      await shoot(context, instance, `09-inbox-card-${index}-${kind}`);
      if ((await instance.page.getByTestId('inbox-expand').count()) > 0) {
        await instance.page.getByTestId('inbox-expand').click();
        await sleep(300);
        await shoot(context, instance, `09-inbox-card-${index}-${kind}-expanded`);
      }
      if ((await instance.page.getByTestId('inbox-peek-open').count()) > 0) {
        await instance.page.getByTestId('inbox-peek-open').click();
        await sleep(900);
        await shoot(context, instance, `09-inbox-card-${index}-${kind}-peek`);
        if ((await instance.page.getByTestId('inbox-peek-back').count()) > 0) {
          await instance.page.getByTestId('inbox-peek-back').click();
          await sleep(300);
          await shoot(context, instance, `09-inbox-card-${index}-${kind}-after-back`);
        }
      }
    }
  } finally {
    await closeApp(instance);
  }
}

export const phaseWorkspace = { empty, populated, dialogs, agents, inbox };
