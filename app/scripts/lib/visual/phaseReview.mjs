// Review screens on the in-memory review manager (0041): the list, a changeset at rungs C and E, the file and hunk
// views with findings, comments and a long hunk, the decision dialogs, the merge dialog, the inbox card, the
// states for empty, error and superseded, and the dark scheme. The manager runs in this script; the window's
// `review_*` commands and `swarm_merge` go to it through the test seam of renderer/api.ts.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadTs } from '../loadTs.mjs';
import { closeApp, invoke, shoot, sleep, startApp } from './harness.mjs';

const pane = (type, config = {}) => ({ type, version: '^1', configVersion: 1, config });

function writeReviewLayout(instance, id, reviewConfig) {
  mkdirSync(instance.layoutsDir, { recursive: true });
  const document = {
    schemaVersion: 1,
    revision: 1,
    id,
    title: id,
    instances: { tree: pane('agide/tree'), main: { ...pane('agide/surface-host', { emptyText: 'Open a session or tab from the tree' }), bindings: { node: { context: 'node.current' } } }, review: pane('agide/review', reviewConfig), inbox: pane('agide/inbox') },
    arrangement: { split: 'row', children: [{ size: 1, tabs: { panes: ['tree'], active: 'tree' } }, { size: 3.4, tabs: { panes: ['main', 'review', 'inbox'], active: 'review' } }] },
  };
  writeFileSync(join(instance.layoutsDir, `${id}.json`), JSON.stringify(document));
}

const lines = (count, prefix) => Array.from({ length: count }, (_, index) => `+${prefix} ${index}`).join('\n');
const FORM_FIRST = ' const name = input.name;\n-if (name) save(name);\n+if (name.trim() !== "") save(name.trim());\n+else reject("name is required");';
const FORM_LONG = ` header\n${lines(900, 'const rule')}`;
const RULES = ' export const rules = [\n-  required,\n+  required, notEmpty,\n ];';

export async function phaseReview(context) {
  const { modules, close } = await loadTs(['/e2e/reviewBackend.ts']);
  const { createReviewBackend, attachReviewBackend } = modules[0];
  const backend = await createReviewBackend({ agents: ['impl', 'tests', 'docs', 'infra'] });
  const instance = await startApp(context, { name: 'review' });
  const { page } = instance;
  const id = (testId) => page.getByTestId(testId);
  const scrollTo = async (testId) => {
    await id(testId).first().scrollIntoViewIfNeeded();
    await sleep(200);
  };
  try {
    await attachReviewBackend(page, backend);
    writeReviewLayout(instance, 'review', { swarmId: 'sw1' });
    await sleep(500);
    await invoke(instance, 'layout_switch', { layoutId: 'review' });
    await id('review-list-empty').waitFor();
    await shoot(context, instance, '13-review-list-empty');

    backend.setReport({ verdict: 'accept', claimCheck: 'confirmed', summary: 'The new test covers the empty name.', findings: [] });
    await backend.capture('tests-1', [{ path: 'tests/form.test.ts', hunks: [' it("rejects an empty name", () => {\n+  expect(save("")).toThrow();\n });'] }], { agent: 'tests', reasons: [] });
    backend.setReport({ verdict: 'accept', claimCheck: 'confirmed', summary: 'The documentation matches the new rule.', findings: [] });
    await backend.capture('docs-1', [{ path: 'docs/security.md', hunks: [' # Security\n+Names are trimmed before they are stored.'] }], {
      agent: 'docs',
      reasons: [{ id: 'path.sensitive', subject: 'docs/security.md', evidence: { glob: { untrusted: true, text: 'docs/**' } } }],
    });
    backend.setReport({
      verdict: 'revise',
      claimCheck: 'partly',
      summary: 'The validation misses a name of only spaces in the second form.',
      findings: [
        { path: 'src/form.ts', line: 2, side: 'new', severity: 'major', title: 'Spaces only are accepted', body: 'trim() is applied after the empty check in the second form.' },
        { path: 'src/form.ts', line: 3, side: 'new', severity: 'nit', title: 'Prefer a named constant for the message', body: '' },
      ],
    });
    await backend.capture('impl-1', [{ path: 'src/form.ts', hunks: [FORM_FIRST, FORM_LONG] }, { path: 'src/rules.ts', hunks: [RULES] }], { agent: 'impl' });
    backend.setReport({ verdict: 'accept', claimCheck: 'partly', summary: 'The workflow change is as described, but it needs a person.', findings: [] });
    await backend.capture('infra-1', [
      { path: '.github/workflows/ci.yml', hunks: [' jobs:\r\n-  test: old\r\n+  test: new\r\n'] },
      { path: 'assets/logo.png', hunks: [] },
      { path: 'src/‮gnp.exe', hunks: [' a\n+b'] },
    ], {
      agent: 'infra',
      reasons: [
        { id: 'path.protected', subject: '.github/workflows/ci.yml', evidence: { glob: { untrusted: true, text: '.github/**' } } },
        { id: 'file.binary', subject: 'assets/logo.png' },
        { id: 'file.odd_name', subject: 'src/‮gnp.exe' },
      ],
      kinds: { 1: 'binary' },
    });
    await sleep(600);
    await shoot(context, instance, '13-review-list');

    await id('review-changeset-row').filter({ hasText: 'impl' }).first().getByTestId('review-open').click();
    await id('review-changeset').waitFor();
    await shoot(context, instance, '13-review-changeset-top');
    await scrollTo('review-report');
    await shoot(context, instance, '13-review-changeset-report');
    await scrollTo('review-files');
    await shoot(context, instance, '13-review-changeset-files');

    await id('review-file-open').first().click();
    await id('review-file').waitFor();
    await page.keyboard.press('j');
    await shoot(context, instance, '13-review-file');
    await page.keyboard.press('m');
    const added = id('review-hunk').first().locator('[data-testid="review-line"][data-kind="add"]').first();
    await added.hover();
    await added.getByTestId('review-comment-open').click();
    await id('review-comment-text').fill('Trim before the empty check, so a name of spaces is refused.');
    await shoot(context, instance, '13-review-hunk-comment');
    await id('review-comment-add').click();
    await sleep(300);
    await scrollTo('review-lines-not-shown');
    await shoot(context, instance, '13-review-hunk-long');
    await id('review-file-back').click();

    await id('review-send-back').click();
    await id('review-send-back-message').fill('Please fix the spaces-only case.');
    await shoot(context, instance, '13-review-send-back-dialog');
    await page.keyboard.press('Escape');
    await id('review-reject').click();
    await shoot(context, instance, '13-review-reject-dialog');
    await page.keyboard.press('Escape');
    await id('review-escalate').click();
    await shoot(context, instance, '13-review-escalate-dialog');
    await page.keyboard.press('Escape');
    await id('review-demote').click();
    await id('review-demote-reason').fill('The reviewer covered every changed line.');
    await shoot(context, instance, '13-review-demote-dialog');
    await page.keyboard.press('Escape');

    backend.setReport({ verdict: 'accept', claimCheck: 'confirmed', summary: 'Fixed.', findings: [] });
    await backend.capture('impl-2', [{ path: 'src/form.ts', hunks: [FORM_FIRST, ' header\n+const rule 0'] }, { path: 'src/rules.ts', hunks: [RULES] }], { agent: 'impl' });
    await id('review-superseded').waitFor();
    await sleep(300);
    await scrollTo('review-superseded');
    await page.evaluate(() => document.querySelector('[data-testid="review-pane"]')?.scrollTo(0, 0));
    await shoot(context, instance, '13-review-superseded');
    await id('review-back').click();

    await id('review-changeset-row').filter({ hasText: 'infra' }).first().getByTestId('review-open').click();
    await id('review-changeset').waitFor();
    await shoot(context, instance, '13-review-changeset-rung-e');
    await id('review-file-open').nth(1).click();
    await id('review-file').waitFor();
    await shoot(context, instance, '13-review-file-hunkless');
    await id('review-file-back').click();
    await id('review-file-open').nth(2).click();
    await id('review-file').waitFor();
    await shoot(context, instance, '13-review-file-odd-name');
    await id('review-file-back').click();
    await id('review-file-open').first().click();
    await id('review-file').waitFor();
    await shoot(context, instance, '13-review-file-crlf');
    await id('review-file-back').click();
    await id('review-back').click();

    await id('review-merge').click();
    await id('review-merge-blocked').waitFor();
    await shoot(context, instance, '13-review-merge-blocked');
    await page.keyboard.press('Escape');

    await page.getByRole('tab', { name: 'Inbox' }).click();
    await id('inbox-row').first().waitFor();
    await id('inbox-row').first().click();
    await id('review-card-actions').first().waitFor();
    await shoot(context, instance, '13-review-inbox-card');

    await page.getByRole('tab', { name: 'Review' }).click();
    await id('review-list').waitFor();
    await instance.app.evaluate(({ nativeTheme }) => {
      nativeTheme.themeSource = 'dark';
    });
    await page.waitForFunction(() => document.documentElement.dataset.scheme === 'dark');
    await sleep(400);
    await shoot(context, instance, '13-review-list-dark');
    await id('review-changeset-row').filter({ hasText: 'impl' }).first().getByTestId('review-open').click();
    await id('review-changeset').waitFor();
    await id('review-file-open').first().click();
    await id('review-file').waitFor();
    await shoot(context, instance, '13-review-file-dark');
    await instance.app.evaluate(({ nativeTheme }) => {
      nativeTheme.themeSource = 'light';
    });
    await page.waitForFunction(() => document.documentElement.dataset.scheme === 'light');

    writeReviewLayout(instance, 'review-missing', { swarmId: 'sw1', changesetId: 'cs_ffffffffffffffff' });
    await sleep(500);
    await invoke(instance, 'layout_switch', { layoutId: 'review-missing' });
    await id('review-changeset-error').waitFor();
    await shoot(context, instance, '13-review-error');
  } finally {
    await closeApp(instance);
    await backend.close();
    await close();
  }
}
