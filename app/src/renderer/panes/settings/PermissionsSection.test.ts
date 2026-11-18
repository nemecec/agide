// @vitest-environment jsdom
import { createElement, act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultPermissionSettings } from '../../../core/permissions/defaults';
import { permissionOptions } from '../../../core/permissions/options';
import { installFakeApi } from '../../testing/fakeApi';
import { render, type Rendered } from '../../testing/render';
import { PermissionsSection } from './PermissionsSection';
import { networkSentence, parseHostLines, withOutwardMode } from './permissionsModel';

let rendered: Rendered | undefined;
afterEach(async () => {
  await rendered?.unmount();
  rendered = undefined;
});

const settings = defaultPermissionSettings({ isDefaultProfile: false });

describe('permissions settings model', () => {
  it('reads one host per line and drops blanks', () => {
    expect(parseHostLines(' github.com \n\n*.example.org\n'), 'hosts').toEqual(['github.com', '*.example.org']);
  });

  it('stores a class mode only when it differs from the class default', () => {
    const changed = withOutwardMode(settings, 'git.push', 'deny', 'approve');
    expect(changed.outward, 'override stored').toEqual({ 'git.push': 'deny' });
    expect(withOutwardMode(changed, 'git.push', 'approve', 'approve').outward, 'override removed').toBeUndefined();
  });

  it('says what the network setting limits', () => {
    expect(networkSentence(settings), 'sandbox on').toContain('github.com');
    expect(networkSentence({ ...settings, network: { ...settings.network, bashSandbox: false } }), 'sandbox off').toContain('not limited');
  });
});

describe('PermissionsSection', () => {
  it('shows the mode sentence and that agents run as the user, and saves the chosen default', async () => {
    const fake = installFakeApi({ permissions_options: permissionOptions(settings, 'local'), permissions_set: { saved: true } });
    rendered = await render(createElement(PermissionsSection));
    const select = rendered.container.querySelector<HTMLSelectElement>('[data-testid="permissions-default-mode"]')!;
    expect(select.value, 'starts at auto').toBe('auto');
    expect(rendered.container.querySelector('[data-testid="permissions-mode-sentence"]')?.textContent, 'sentence of auto').toContain('safety classifier');
    expect(rendered.container.querySelector('[data-testid="permissions-runs-as-user"]')?.textContent, 'statement about the user').toContain('as your user');
    expect([...select.options].map((option) => option.value), 'bypass is not a default').not.toContain('bypassPermissions');
    await act(async () => {
      select.value = 'plan';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => rendered!.container.querySelector<HTMLButtonElement>('[data-testid="permissions-save"]')!.click());
    expect(fake.invoke, 'saved with the new default').toHaveBeenCalledWith('permissions_set', { settings: expect.objectContaining({ defaultMode: 'plan' }) });
  });
});
