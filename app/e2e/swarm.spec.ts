import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { RendererApi } from '../src/shared/ipc';

const MAIN = join(import.meta.dirname, '..', 'out', 'main', 'index.js');
const FAKE = join(import.meta.dirname, '..', 'src', 'core', 'swarm', 'fixtures', 'fake-claude-stream.mjs');

let userData: string;
let workdir: string;
let app: ElectronApplication | undefined;
let page: Page;

/** A layout with the tree, the main surface and the inbox, so the tree stays visible beside the inbox tab. */
function writeLayout(): void {
  const pane = (type: string, config: object = {}) => ({ type, version: '^1', configVersion: 1, config });
  const document = {
    schemaVersion: 1,
    revision: 1,
    id: 'swarm-e2e',
    title: 'swarm-e2e',
    instances: { tree: pane('agide/tree'), main: { ...pane('agide/surface-host', { emptyText: 'Open a session or tab from the tree' }), bindings: { node: { context: 'node.current' } } }, inbox: pane('agide/inbox') },
    arrangement: { split: 'row', children: [{ size: 1, tabs: { panes: ['tree'], active: 'tree' } }, { size: 3, tabs: { panes: ['main', 'inbox'], active: 'main' } }] },
  };
  mkdirSync(join(userData, 'layouts'), { recursive: true });
  writeFileSync(join(userData, 'layouts', 'swarm-e2e.json'), JSON.stringify(document));
}

test.beforeEach(async () => {
  userData = mkdtempSync(join(tmpdir(), 'agide-swarm-'));
  workdir = mkdtempSync(join(tmpdir(), 'agide-swarm-cwd-'));
  app = await electron.launch({ args: [MAIN], env: { ...process.env, AGIDE_HIDDEN: '1', AGIDE_USER_DATA: userData, AGIDE_SESSION_CWD: workdir, AGIDE_TASK_BASE: join(workdir, 'agide'), AGIDE_CLAUDE_BIN: FAKE, FAKE_CLAUDE_STATE: join(userData, 'fake-state'), FAKE_CLAUDE_RECORD: join(userData, 'launches.jsonl') } });
  page = await app.firstWindow();
  await expect(page.getByRole('tree', { name: 'Task tree' }), 'the window rendered').toBeVisible();
});

test.afterEach(async () => {
  await app?.close();
  app = undefined;
  rmSync(userData, { recursive: true, force: true });
  rmSync(workdir, { recursive: true, force: true });
});

async function invoke<T = unknown>(id: string, input: unknown = {}): Promise<T> {
  const result = await page.evaluate(([commandId, args]) => (globalThis as unknown as { api: RendererApi }).api.invoke(commandId as string, args), [id, input] as const);
  if (!result.ok) throw new Error(`${id}: ${result.error.message}`);
  return result.value as T;
}

const GOAL = 'Check the retry policy';
const DEFINITION = {
  version: 1,
  goal: GOAL,
  budget: { usdTotal: 3 },
  agents: [
    { name: 'worker', workspace: 'scratch', prompt: '/cost 0.4\n/tool Bash {"command":"npm test"}\n/text tests passed' },
    { name: 'helper', workspace: 'scratch', role: 'mechanical', prompt: '/sleep 600000' },
    { name: 'review', workspace: 'scratch', role: 'reviewer', stage: 1, prompt: '/text reviewed' },
  ],
};

const agentChips = (state: string) => page.locator(`[data-testid="swarm-agent-chip"][data-agent-state="${state}"]`);

async function ensureExpanded(title: string): Promise<void> {
  const row = page.getByRole('treeitem', { name: new RegExp(`^${title}`) }).first();
  if ((await row.getAttribute('aria-expanded')) !== 'true') await row.dblclick();
  await expect(row, `${title} is expanded`).toHaveAttribute('aria-expanded', 'true');
}

test('starts a swarm from the dialog, answers an approval from the inbox card and stops the group', async () => {
  const project = await invoke<{ id: string }>('ui_create_folder', { title: 'Project' });
  writeLayout();
  await page.waitForTimeout(500);
  await invoke('layout_switch', { layoutId: 'swarm-e2e' });
  await expect(page.getByRole('tab', { name: 'Inbox' }), 'the inbox tab is shown').toBeVisible();

  await page.getByRole('treeitem', { name: 'Project', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'New swarm…', exact: true }).click();
  const dialog = page.getByTestId('start-swarm-dialog');
  await expect(dialog, 'the start dialog opens').toBeVisible();
  await expect(dialog, 'for the folder it was opened on').toHaveAttribute('data-parent-folder', project.id);

  await page.getByTestId('swarm-tab-json').click();
  await page.getByTestId('swarm-json').fill('{ "version": 1, ');
  await page.getByTestId('swarm-start').click();
  await expect(dialog, 'broken JSON does not start anything').toBeVisible();
  await page.getByTestId('swarm-json').fill(JSON.stringify(DEFINITION));
  await expect(page.getByTestId('swarm-issues'), 'a valid definition shows no problems').toHaveCount(0);
  await page.getByTestId('swarm-tab-form').click();
  await expect(page.getByTestId('swarm-agent-name-2'), 'the JSON reached the form').toHaveValue('review');
  await page.getByTestId('swarm-start').click();
  await expect(dialog, 'the dialog closes after the start').toBeHidden();

  await ensureExpanded('Project');
  await expect(page.getByTestId('swarm-chip'), 'the swarm folder shows its state word').toHaveText('running');
  await ensureExpanded(GOAL);
  await expect(page.getByTestId('swarm-agent-chip'), 'two agent nodes: the queued agent has no session yet').toHaveCount(2);
  await expect(agentChips('waiting'), 'the worker waits for an approval').toHaveCount(1);
  await expect(agentChips('running'), 'the helper runs').toHaveCount(1);
  await expect(page.getByTestId('swarm-cap'), 'two agents hold a slot of the cap').toHaveText('2 of 4 agents running');
  await expect(page.getByTestId('swarm-waiting'), 'the swarm row marks the waiting agent').toBeVisible();

  await page.getByRole('treeitem', { name: new RegExp(`^${GOAL}`) }).first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Results', exact: true }).click();
  await expect(page.getByTestId('swarm-goal'), 'the swarm pane opens').toHaveText(GOAL);
  await expect(page.getByTestId('swarm-agent-row'), 'the pane lists the agents').toHaveCount(3);
  await expect(page.locator('[data-testid="swarm-agent-row"][data-agent="review"]'), 'the reviewer waits for the earlier stage').toHaveAttribute('data-state', 'queued');
  await expect(page.getByTestId('budget-meter-label'), 'the budget says it is list-price equivalent').toContainText('list-price equivalent, not billed');

  await page.getByRole('tab', { name: 'Inbox' }).click();
  await expect(page.getByTestId('inbox-row'), 'the approval is in the inbox').toHaveCount(1);
  await page.getByTestId('inbox-row').first().click();
  await expect(page.getByTestId('inbox-message'), 'the card names the agent and the tool').toContainText('worker wants to run Bash');
  await expect(page.getByTestId('swarm-approval-meta'), 'the card shows the agent and its mode').toContainText('Agent worker, mode auto');
  await expect(page.getByTestId('inbox-answer-in-session'), 'a stream agent has no terminal to open').toHaveCount(0);
  await page.getByTestId('swarm-approval-allow').click();
  await expect(page.getByTestId('inbox-row'), 'the answered item leaves the open list').toHaveCount(0);
  await expect(agentChips('waiting'), 'the worker went on').toHaveCount(0);
  await expect(agentChips('done'), 'the worker finished').toHaveCount(1);

  await page.getByRole('tab', { name: 'Swarm' }).click();
  await expect(page.getByTestId('swarm-pause'), 'pause is available while running').toBeEnabled();
  await page.getByTestId('swarm-stop').click();
  await expect(page.getByTestId('swarm-stop-dialog'), 'stopping asks first').toBeVisible();
  await page.getByTestId('swarm-stop-confirm').click();
  await expect(page.getByTestId('swarm-state'), 'the swarm is stopped').toHaveText('stopped');
  await expect(page.getByTestId('swarm-chip'), 'the swarm row follows').toHaveText('stopped');
  await expect(agentChips('stopped'), 'the helper is stopped').toHaveCount(1);
  await expect(page.locator('[data-testid="swarm-agent-row"][data-agent="review"]'), 'the queued reviewer is stopped').toHaveAttribute('data-state', 'stopped');
  await expect(page.getByTestId('swarm-banner'), 'a banner offers to resume').toContainText('The swarm was stopped');
  await expect(page.getByTestId('swarm-cap'), 'no agent holds a slot any more').toHaveText('0 of 4 agents running');
});

test('answers a deny from the inbox card for a swarm started from a template', async () => {
  await invoke('ui_create_folder', { title: 'Project' });
  writeLayout();
  await page.waitForTimeout(500);
  await invoke('layout_switch', { layoutId: 'swarm-e2e' });
  await page.getByRole('treeitem', { name: 'Project', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'New swarm…', exact: true }).click();
  await page.getByTestId('swarm-template').click();
  await page.getByRole('option', { name: 'Research, no repository' }).click();
  await page.getByTestId('swarm-start').click();
  await expect(page.getByTestId('start-swarm-dialog'), 'the template starts as it is').toBeHidden();

  const started = await invoke<{ swarms: { id: string }[] }>('swarm_list', {});
  expect(started.swarms, 'one swarm runs').toHaveLength(1);
  await invoke('swarm_send', { swarmId: started.swarms[0]!.id, agent: 'scout-one', message: '/tool Bash {"command":"rm -rf build"}' });
  await page.getByRole('tab', { name: 'Inbox' }).click();
  await expect(page.getByTestId('inbox-row'), 'the second request is in the inbox').toHaveCount(1);
  await page.getByTestId('inbox-row').first().click();
  await page.getByTestId('swarm-approval-deny').click();
  await expect(page.getByTestId('inbox-row'), 'denied items leave the open list').toHaveCount(0);
  await page.getByTestId('inbox-filter-done').click();
  await expect(page.getByTestId('inbox-row').first(), 'the denied item is under Done').toBeVisible();
});
