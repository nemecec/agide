import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { RendererApi } from '../src/shared/ipc';
import { attachReviewBackend, createReviewBackend, type ReviewBackend } from './reviewBackend';

const MAIN = join(import.meta.dirname, '..', 'out', 'main', 'index.js');
const FAKE = join(import.meta.dirname, '..', 'src', 'core', 'swarm', 'fixtures', 'fake-claude-stream.mjs');

let userData: string;
let workdir: string;
let app: ElectronApplication | undefined;
let page: Page;
let backend: ReviewBackend | undefined;

const FORM_FIRST = ' keep\n-old name check\n+new name check';
const FORM_SECOND = ' tail\n+second change';
const RULES = ' rule\n-old rule\n+new rule';

function writeLayout(): void {
  const pane = (type: string, config: object = {}) => ({ type, version: '^1', configVersion: 1, config });
  const document = {
    schemaVersion: 1,
    revision: 1,
    id: 'review-e2e',
    title: 'review-e2e',
    instances: { tree: pane('agide/tree'), main: { ...pane('agide/surface-host', { emptyText: 'Open a session or tab from the tree' }), bindings: { node: { context: 'node.current' } } }, inbox: pane('agide/inbox') },
    arrangement: { split: 'row', children: [{ size: 1, tabs: { panes: ['tree'], active: 'tree' } }, { size: 3, tabs: { panes: ['main', 'inbox'], active: 'main' } }] },
  };
  mkdirSync(join(userData, 'layouts'), { recursive: true });
  writeFileSync(join(userData, 'layouts', 'review-e2e.json'), JSON.stringify(document));
}

test.beforeEach(async () => {
  userData = mkdtempSync(join(tmpdir(), 'agide-review-'));
  workdir = mkdtempSync(join(tmpdir(), 'agide-review-cwd-'));
  app = await electron.launch({ args: [MAIN], env: { ...process.env, AGIDE_HIDDEN: '1', AGIDE_USER_DATA: userData, AGIDE_SESSION_CWD: workdir, AGIDE_CLAUDE_BIN: FAKE } });
  page = await app.firstWindow();
  await expect(page.getByRole('tree', { name: 'Task tree' }), 'the window rendered').toBeVisible();
  backend = await createReviewBackend();
  await attachReviewBackend(page, backend);
  writeLayout();
  await page.waitForTimeout(500);
  await page.evaluate(() => (globalThis as unknown as { api: RendererApi }).api.invoke('layout_switch', { layoutId: 'review-e2e' }));
  await expect(page.getByRole('tab', { name: 'Inbox' }), 'the inbox tab is shown').toBeVisible();
});

test.afterEach(async () => {
  await backend?.close();
  backend = undefined;
  await app?.close();
  app = undefined;
  rmSync(userData, { recursive: true, force: true });
  rmSync(workdir, { recursive: true, force: true });
});

const id = (testId: string) => page.getByTestId(testId);

test('reads a changeset from the inbox card down to a hunk, comments and sends it back, accepts unchanged content and sees the accept lapse when the content changes', async () => {
  const review = backend!;
  review.setReport({
    verdict: 'revise',
    claimCheck: 'partly',
    summary: 'The validation misses an empty name.',
    findings: [{ path: 'src/form.ts', line: 2, side: 'new', severity: 'minor', title: 'Empty name accepted', body: 'Add a check.' }],
  });
  const first = await review.capture('v1', [
    { path: 'src/form.ts', hunks: [FORM_FIRST, FORM_SECOND] },
    { path: 'src/rules.ts', hunks: [RULES] },
  ]);
  expect(first.state, 'the reviewer reported and the unit waits for a person').toBe('awaiting_human');

  // The inbox card.
  await page.getByRole('tab', { name: 'Inbox' }).click();
  const row = id('inbox-row').first();
  await expect(row, 'the card shows the review item').toContainText('worker in Add input validation');
  await row.click();
  await expect(id('review-card-accept'), 'a minor finding leaves Accept on the card').toBeVisible();
  await id('review-card-open').click();

  // The changeset with its reasons, source, evidence, reviewer and claim.
  const changeset = id('review-changeset');
  await expect(changeset, 'the review pane shows the changeset of the card').toHaveAttribute('data-changeset', first.id);
  await expect(id('review-rung'), 'the rung with its meaning').toHaveText('Rung C: Your decision');
  await expect(id('review-reason').first(), 'the reason with its source').toContainText('size.large');
  await expect(id('review-report'), 'the reviewer summary names its author').toContainText('Summary written by the reviewer agent');
  await expect(id('review-claim'), 'the claim is marked as not verified').toContainText('Claim, not verified by Agide');
  await expect(id('review-unseen-total'), 'three hunks wait to be seen').toHaveText('3 hunks not seen');

  // A file, a hunk, the keyboard and a comment.
  await id('review-file-open').first().click();
  await expect(id('review-file-title'), 'the file view').toHaveText('src/form.ts');
  await expect(id('review-hunk'), 'both hunks of the file').toHaveCount(2);
  await page.keyboard.press('j');
  await expect(id('review-hunk').first(), 'j focuses the first hunk').toBeFocused();
  await page.keyboard.press('m');
  await expect(id('review-hunk').first(), 'm marks it seen').toHaveAttribute('data-seen', 'true');
  await expect(id('review-hunk').nth(1), 'the other hunk is not seen').toHaveAttribute('data-seen', 'false');
  await expect(id('review-finding'), 'the finding sits under its line').toContainText('Empty name accepted');
  const added = id('review-hunk').first().locator('[data-testid="review-line"][data-kind="add"]').first();
  await added.hover();
  await added.getByTestId('review-comment-open').click();
  await id('review-comment-text').fill('Not sent');
  await page.keyboard.press('Escape');
  await expect(id('review-composer'), 'Escape closes the comment box').toHaveCount(0);
  await expect(added.getByTestId('review-comment-open'), 'the focus returns to the button of the line').toBeFocused();
  await added.getByTestId('review-comment-open').click();
  await id('review-comment-text').fill('Why not trim first?');
  await id('review-comment-add').click();
  await expect(id('review-draft'), 'the draft shows under the line').toContainText('Why not trim first?');
  await id('review-file-back').click();
  await expect(id('review-draft-row'), 'the batch lists the draft').toHaveCount(1);
  await expect(id('review-unseen-total'), 'two hunks remain unseen').toHaveText('2 hunks not seen');

  // Send back.
  await id('review-send-back').click();
  await expect(id('review-send-back-drafts'), 'the dialog lists the draft that goes along').toContainText('src/form.ts:2');
  await id('review-send-back-message').fill('Please handle the empty name.');
  await id('review-send-back-dialog-confirm').click();
  await expect(id('review-state'), 'the work is sent back').toHaveText('Sent back');
  expect(review.sendBack.sent[0]?.message, 'the batch went to the agent with the comment and the message').toContain('Why not trim first?');

  // The agent works again: one hunk is unchanged, one is not. The old changeset lapses.
  review.setReport({ verdict: 'accept', claimCheck: 'confirmed', summary: 'The empty name is handled.', findings: [] });
  const second = await review.capture('v2', [
    { path: 'src/form.ts', hunks: [FORM_FIRST, ' tail\n+second change, trimmed'] },
    { path: 'src/rules.ts', hunks: [RULES] },
  ]);
  expect(second.state, 'the second capture waits for a person').toBe('awaiting_human');
  await expect(id('review-superseded'), 'the open changeset says it was replaced').toBeVisible();
  for (const button of ['review-accept', 'review-send-back', 'review-reject']) await expect(id(button), `${button} is off on a superseded changeset`).toBeDisabled();
  await id('review-open-newest').click();
  await expect(id('review-changeset'), 'the newest changeset opens').toHaveAttribute('data-changeset', second.id);

  // Marks bind to hashes: the unchanged hunk keeps its mark, the changed one is unseen.
  await id('review-file-open').first().click();
  await expect(id('review-hunk').first(), 'the unchanged hunk keeps its seen mark').toHaveAttribute('data-seen', 'true');
  await expect(id('review-hunk').nth(1), 'the changed hunk is unseen').toHaveAttribute('data-seen', 'false');
  await id('review-file-back').click();

  // Accept the content as it is.
  await expect(id('review-accept'), 'accept is open on the current changeset').toBeEnabled();
  await id('review-accept').click();
  await expect(id('review-state'), 'the changeset is accepted').toHaveText('Accepted');

  // The agent changes its work again: the accept no longer applies.
  review.setReport({ verdict: 'accept', claimCheck: 'confirmed', summary: 'Still fine.', findings: [] });
  const third = await review.capture('v3', [
    { path: 'src/form.ts', hunks: [FORM_FIRST, ' tail\n+second change, trimmed again'] },
    { path: 'src/rules.ts', hunks: [RULES] },
  ]);
  await expect(id('review-superseded'), 'the accepted changeset lapses when the content changes').toBeVisible();
  await expect(id('review-accept'), 'accept is off').toBeDisabled();

  // The merge gate stays closed while the newest changeset is not accepted.
  await id('review-back').click();
  await expect(id('review-list'), 'the list of the swarm').toBeVisible();
  await id('review-merge').click();
  await expect(id('review-merge-blocked'), 'the gate explains').toContainText('awaiting_human');
  await expect(id('review-merge-confirm'), 'no merge').toBeDisabled();
  await page.keyboard.press('Escape');

  // Accepting the newest and merging.
  await id('review-open').first().click();
  await expect(id('review-changeset')).toHaveAttribute('data-changeset', third.id);
  await id('review-accept').click();
  await expect(id('review-state')).toHaveText('Accepted');
  await id('review-back').click();
  await id('review-merge').click();
  await expect(id('review-merge-preview'), 'the dry run lists the agent').toContainText('worker');
  await id('review-merge-confirm').click();
  await expect(id('review-merge-done'), 'the merge result').toContainText('Merged into main');
});
