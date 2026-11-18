// @vitest-environment jsdom
import { createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { click, setValue } from '../testing/dom';
import { installFakeApi, type FakeApi } from '../testing/fakeApi';
import { render, type Rendered } from '../testing/render';
import { SetupPane } from './SetupPane';

let rendered: Rendered | undefined;
let fake: FakeApi;
afterEach(async () => {
  await rendered?.unmount();
  rendered = undefined;
});

const status = (over: Record<string, unknown> = {}) => ({ needed: true, login: { signedIn: false }, git: false, ssh: false, loginDirectory: '/login/dir', ...over });
async function mount(setup: unknown, extra: Record<string, unknown> = {}) {
  fake = installFakeApi({ profile_setup_status: setup, ui_create_folder: { id: 'f9' }, session_create: {}, profile_set_git: {}, ...extra });
  rendered = await render(createElement(SetupPane));
}
const pane = () => rendered!.container.querySelector('[data-testid="setup-pane"]');
const button = (label: string) => [...rendered!.container.querySelectorAll('button')].find((candidate) => candidate.textContent === label)!;

describe('SetupPane', () => {
  it('shows nothing while the status is unknown or setup is not needed', async () => {
    await mount(status({ needed: false }));
    expect(pane(), 'not needed').toBeNull();
  });

  it('shows nothing once login and git identity are done', async () => {
    await mount(status({ login: { signedIn: true }, git: true }));
    expect(pane(), 'done').toBeNull();
  });

  it('shows what is left and marks the finished step', async () => {
    await mount(status({ login: { signedIn: true } }));
    const text = pane()!.textContent!;
    expect(text, 'login done').toContain('Claude login (done)');
    expect(text, 'git open').toContain('Git identity ');
    expect(text, 'git not done').not.toContain('Git identity (done)');
  });

  it('states the default permission mode of new sessions', async () => {
    await mount(status());
    expect(rendered!.container.querySelector('[data-testid="setup-permission-note"]')?.textContent, 'note').toContain('auto mode');
  });

  it('warns that agents run as the user only for the host-user access level', async () => {
    await mount(status({ agentAccess: 'host-user' }));
    expect(pane()!.textContent, 'warning').toContain('Agents run as your user');
    await rendered!.unmount();
    await mount(status({ agentAccess: 'contained' }));
    expect(pane()!.textContent, 'no warning').not.toContain('Agents run as your user');
  });

  it('opens the login terminal in a new folder in the login directory', async () => {
    await mount(status());
    await click(button('Open login terminal'));
    expect(fake.invoke, 'folder first').toHaveBeenCalledWith('ui_create_folder', { title: 'Claude login' });
    expect(fake.invoke, 'session in the folder').toHaveBeenCalledWith('session_create', { folderId: 'f9', cwd: '/login/dir', title: 'Claude login' });
  });

  it('shows the problem when the folder or the session cannot be created and starts no session after a folder failure', async () => {
    await mount(status(), { ui_create_folder: { ok: false, error: { code: 'failed', message: 'no folder' } } });
    await click(button('Open login terminal'));
    expect(rendered!.container.querySelector('[role="alert"]')?.textContent, 'folder problem').toBe('no folder');
    expect(fake.invoke, 'no session').not.toHaveBeenCalledWith('session_create', expect.anything());
    fake.respond('ui_create_folder', { id: 'f9' });
    fake.respond('session_create', { ok: false, error: { code: 'failed', message: 'no session' } });
    await click(button('Open login terminal'));
    expect(rendered!.container.querySelector('[role="alert"]')?.textContent, 'session problem').toBe('no session');
    expect(fake.invoke, 'the empty folder is removed again').toHaveBeenCalledWith('ui_remove_node', { nodeId: 'f9' });
  });

  it('keeps Save disabled until name and e-mail are given, then saves the identity and rereads the status', async () => {
    await mount(status());
    const save = () => button('Save') as HTMLButtonElement;
    expect(save().disabled, 'empty').toBe(true);
    await setValue(rendered!.container.querySelector<HTMLInputElement>('[aria-label="Git name"]')!, 'Ada');
    expect(save().disabled, 'name only').toBe(true);
    await setValue(rendered!.container.querySelector<HTMLInputElement>('[aria-label="Git e-mail"]')!, '  ');
    expect(save().disabled, 'blank e-mail').toBe(true);
    await setValue(rendered!.container.querySelector<HTMLInputElement>('[aria-label="Git e-mail"]')!, 'ada@example.test');
    const before = fake.invoke.mock.calls.filter((call) => call[0] === 'profile_setup_status').length;
    await click(save());
    expect(fake.invoke, 'identity saved').toHaveBeenCalledWith('profile_set_git', { userName: 'Ada', userEmail: 'ada@example.test' });
    expect(fake.invoke.mock.calls.filter((call) => call[0] === 'profile_setup_status').length, 'status reread').toBe(before + 1);
  });

  it('hides itself when Later is pressed', async () => {
    await mount(status());
    await click(button('Later'));
    expect(pane(), 'dismissed').toBeNull();
  });
});
