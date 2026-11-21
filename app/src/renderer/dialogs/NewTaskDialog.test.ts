// @vitest-environment jsdom
import { act, createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chooseOption, click, setValue } from '../testing/dom';
import { installFakeApi, type FakeApi } from '../testing/fakeApi';
import { render, type Rendered } from '../testing/render';
import { DialogRoot } from '../ui/Dialog';
import { NewTaskDialog } from './NewTaskDialog';

let rendered: Rendered | undefined;
let fake: FakeApi;
const onClose = vi.fn();
afterEach(async () => {
  await rendered?.unmount();
  rendered = undefined;
  onClose.mockReset();
});

const folders = [
  { id: 'f1', kind: 'folder', title: 'Work', parentId: null },
  { id: 'l1', kind: 'leaf', title: 'A session', parentId: 'f1' },
];

async function mount(responders: Record<string, unknown> = {}, parentFolderId: string | null = null) {
  fake = installFakeApi({
    ui_list_tree: { nodes: folders },
    task_repositories: { repositories: ['/repos/one', '/repos/two'] },
    task_preview: { commands: ['git fetch origin'], prompt: 'the prompt' },
    task_start: {},
    ...responders,
  });
  rendered = await render(createElement(DialogRoot, { open: true, onOpenChange: () => undefined, children: createElement(NewTaskDialog, { parentFolderId, onClose }) }));
}
const byId = <T extends HTMLElement>(id: string): T | null => document.querySelector<T>(`[data-testid="${id}"]`);
const text = (id: string) => byId(id)?.textContent;

describe('NewTaskDialog', () => {
  it('lists only folders as parents and the known repositories, and preselects the parent it was opened for', async () => {
    await mount({}, 'f1');
    expect(byId('task-parent')!.getAttribute('data-value'), 'preselected parent').toBe('f1');
    expect(byId('task-parent')!.textContent, 'the trigger shows the title of the parent').toBe('Work');
    await act(async () => {
      byId('task-parent')!.focus();
      byId('task-parent')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    });
    expect([...document.querySelectorAll('[role="option"]')].map((option) => option.textContent), 'top level and folders only').toEqual(['Top level', 'Work']);
    expect([...document.querySelectorAll('datalist option')].map((option) => option.getAttribute('value')), 'repositories').toEqual(['/repos/one', '/repos/two']);
  });

  it('names the kind of the source and keeps Start disabled until something is entered', async () => {
    await mount();
    expect(text('task-kind'), 'nothing entered').toBe('Nothing entered');
    expect(byId<HTMLButtonElement>('task-start')!.disabled, 'disabled when empty').toBe(true);
    await setValue(byId<HTMLTextAreaElement>('task-source')!, 'ABC-12');
    expect(text('task-kind'), 'jira').toBe('Jira issue');
    expect(byId<HTMLButtonElement>('task-start')!.disabled, 'enabled').toBe(false);
    await setValue(byId<HTMLTextAreaElement>('task-source')!, 'https://github.com/acme/widgets/pull/3');
    expect(text('task-kind'), 'pull request').toBe('Pull request');
    await setValue(byId<HTMLTextAreaElement>('task-source')!, 'Fix the flaky test');
    expect(text('task-kind'), 'prompt').toBe('Prompt');
  });

  it('asks for an instruction only beside a pull request or a ticket, and for a base only with a repository and no pull request', async () => {
    await mount();
    const source = () => byId<HTMLTextAreaElement>('task-source')!;
    await setValue(source(), 'Fix the flaky test');
    expect(byId('task-instruction'), 'prompt has no instruction field').toBeNull();
    expect(byId('task-base'), 'no repository, no base').toBeNull();
    await setValue(byId<HTMLInputElement>('task-repo')!, '/repos/one');
    expect(byId('task-base'), 'prompt with repository has a base').not.toBeNull();
    await setValue(source(), 'ABC-12');
    expect(byId('task-instruction'), 'ticket has an instruction field').not.toBeNull();
    expect(byId('task-base'), 'ticket with repository has a base').not.toBeNull();
    await setValue(source(), 'acme/widgets#3');
    expect(byId('task-instruction'), 'pull request has an instruction field').not.toBeNull();
    expect(byId('task-base'), 'pull request takes its base from GitHub').toBeNull();
  });

  it('starts the task with the form as the command input and closes on success', async () => {
    await mount();
    await setValue(byId<HTMLTextAreaElement>('task-source')!, 'ABC-12');
    await setValue(byId<HTMLTextAreaElement>('task-instruction')!, ' be careful ');
    await chooseOption(byId('task-mode')!, 'Plan');
    await chooseOption(byId('task-parent')!, 'Work');
    await click(byId('task-start')!);
    expect(fake.invoke, 'task_start input').toHaveBeenCalledWith('task_start', { source: 'ABC-12', instruction: 'be careful', parentFolderId: 'f1', permissionMode: 'plan' });
    expect(onClose, 'closed').toHaveBeenCalledTimes(1);
  });

  it('shows the refusal, stays open and allows another try', async () => {
    await mount({ task_start: { ok: false, error: { code: 'failed', message: 'gh is not signed in' } } });
    await setValue(byId<HTMLTextAreaElement>('task-source')!, 'ABC-12');
    await click(byId('task-start')!);
    expect(text('task-error'), 'error shown').toBe('gh is not signed in');
    expect(onClose, 'stays open').not.toHaveBeenCalled();
    expect(byId<HTMLButtonElement>('task-start')!.disabled, 'Start usable again').toBe(false);
  });

  it('closes without starting when Cancel is pressed', async () => {
    await mount();
    const cancel = [...document.querySelectorAll('button')].find((button) => button.textContent === 'Cancel')!;
    await click(cancel);
    expect(onClose, 'closed').toHaveBeenCalledTimes(1);
    expect(fake.invoke, 'nothing started').not.toHaveBeenCalledWith('task_start', expect.anything());
  });

  it('asks for the preview only while the preview is open and a source is entered, and shows the commands and the prompt', async () => {
    await mount();
    const preview = [...document.querySelectorAll('button')].find((button) => button.textContent === 'Preview')!;
    await setValue(byId<HTMLTextAreaElement>('task-source')!, 'ABC-12');
    expect(fake.invoke, 'no preview while closed').not.toHaveBeenCalledWith('task_preview', expect.anything());
    expect(preview.getAttribute('aria-expanded'), 'the disclosure starts closed').toBe('false');
    await click(preview);
    expect(preview.getAttribute('aria-expanded'), 'the disclosure opens').toBe('true');
    expect(fake.invoke, 'preview asked').toHaveBeenCalledWith('task_preview', { source: 'ABC-12' });
    expect(text('task-preview'), 'commands and prompt').toContain('git fetch origin');
    expect(text('task-preview'), 'prompt').toContain('the prompt');
  });

  it('says that no commands run when the preview has none, and shows no preview when the command fails', async () => {
    await mount({ task_preview: { commands: [], prompt: 'p' } });
    const preview = [...document.querySelectorAll('button')].find((button) => button.textContent === 'Preview')!;
    await setValue(byId<HTMLTextAreaElement>('task-source')!, 'Do a thing');
    await click(preview);
    expect(text('task-preview'), 'no commands').toContain('No commands run before the session starts.');
    fake.respond('task_preview', { ok: false, error: { code: 'failed', message: 'x' } });
    await setValue(byId<HTMLTextAreaElement>('task-source')!, 'Do another thing');
    expect(byId('task-preview'), 'no preview after a failure').toBeNull();
  });
});
