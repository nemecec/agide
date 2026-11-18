// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { installFakeApi } from '../testing/fakeApi';
import { closeDialog, currentDialog } from './dialogStore';
import { createSession, finishNewSession, newSessionTitle, startNewSession } from './newSession';

afterEach(() => {
  finishNewSession({ error: '' });
  closeDialog();
});

describe('new session dialog flow', () => {
  it('opens the dialog for the folder with the title and resolves with the session the dialog creates', async () => {
    const outcome = startNewSession('f1', 'Fix login');
    expect(currentDialog(), 'dialog opened').toEqual({ kind: 'new-session', folderId: 'f1' });
    expect(newSessionTitle(), 'title offered').toBe('Fix login');
    finishNewSession({ leafId: 'leaf1' });
    expect(await outcome, 'created session').toEqual({ leafId: 'leaf1' });
  });

  it('resolves a request that a newer request replaces as cancelled', async () => {
    const first = startNewSession('f1', 'One');
    const second = startNewSession('f2', 'Two');
    expect(await first, 'replaced request').toEqual({ error: '' });
    finishNewSession({ leafId: 'leaf2' });
    expect(await second, 'newer request').toEqual({ leafId: 'leaf2' });
    expect(newSessionTitle(), 'latest title').toBe('Two');
  });

  it('ignores a finish without a waiting request', () => {
    expect(() => finishNewSession({ leafId: 'x' })).not.toThrow();
  });
});

describe('createSession', () => {
  it('sends the folder, title, trimmed working directory and the chosen permission mode', async () => {
    const fake = installFakeApi({ session_create: { leafId: 'leaf1' } });
    const outcome = await createSession({ folderId: 'f1', title: 'T', cwd: '  /work/dir  ', permissionMode: 'auto' });
    expect(fake.invoke, 'command input').toHaveBeenCalledWith('session_create', { folderId: 'f1', title: 'T', cwd: '/work/dir', permissionMode: 'auto' });
    expect(outcome, 'leaf').toEqual({ leafId: 'leaf1' });
  });

  it('leaves out an empty or blank working directory so the default applies', async () => {
    const fake = installFakeApi({ session_create: { leafId: 'leaf1' } });
    await createSession({ folderId: 'f1', title: 'T', cwd: '   ', permissionMode: 'default' });
    await createSession({ folderId: 'f1', title: 'T', permissionMode: 'default' });
    for (const call of fake.invoke.mock.calls) expect(call[1], 'no cwd field').not.toHaveProperty('cwd');
  });

  it('sends the bypass confirmation only when it is given', async () => {
    const fake = installFakeApi({ session_create: { leafId: 'leaf1' } });
    await createSession({ folderId: 'f1', title: 'T', permissionMode: 'bypassPermissions', confirmBypassPermissions: true });
    expect(fake.invoke.mock.calls[0]![1], 'confirmed').toMatchObject({ permissionMode: 'bypassPermissions', confirmBypassPermissions: true });
    await createSession({ folderId: 'f1', title: 'T', permissionMode: 'bypassPermissions', confirmBypassPermissions: false });
    expect(fake.invoke.mock.calls[1]![1], 'not confirmed').not.toHaveProperty('confirmBypassPermissions');
  });

  it('returns the message of a refused command', async () => {
    installFakeApi({ session_create: { ok: false, error: { code: 'invalid_input', message: 'bypass needs confirmation' } } });
    expect(await createSession({ folderId: 'f1', title: 'T', permissionMode: 'bypassPermissions' }), 'refusal').toEqual({ error: 'bypass needs confirmation' });
  });
});
