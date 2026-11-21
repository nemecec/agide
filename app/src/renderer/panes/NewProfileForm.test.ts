// @vitest-environment jsdom
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, setValue } from '../testing/dom';
import { installFakeApi } from '../testing/fakeApi';
import { render, type Rendered } from '../testing/render';
import { NewProfileForm } from './NewProfileForm';

let rendered: Rendered | undefined;
afterEach(async () => {
  await rendered?.unmount();
  rendered = undefined;
});

const PALETTE = ['#5b7fa6', '#b5651d'];
const create = () => [...rendered!.container.querySelectorAll('button')].find((button) => button.textContent === 'Create') as HTMLButtonElement;
const nameField = () => rendered!.container.querySelector<HTMLInputElement>('[data-testid="profile-name"]')!;

describe('NewProfileForm', () => {
  it('keeps Create disabled until a name is typed, then creates the profile with the first palette colour', async () => {
    const fake = installFakeApi({ profile_create: {} });
    const onDone = vi.fn();
    rendered = await render(createElement(NewProfileForm, { palette: PALETTE, onDone }));
    expect(create().disabled, 'no name yet').toBe(true);
    await setValue(nameField(), 'Work');
    await click(create());
    expect(fake.invoke, 'profile created with name and first colour').toHaveBeenCalledWith('profile_create', { name: 'Work', colour: '#5b7fa6' });
    expect(onDone, 'form closes after success').toHaveBeenCalledTimes(1);
  });

  it('creates the profile with the colour that was picked', async () => {
    const fake = installFakeApi({ profile_create: {} });
    rendered = await render(createElement(NewProfileForm, { palette: PALETTE, onDone: vi.fn() }));
    await setValue(nameField(), 'Home');
    await click(rendered.container.querySelector('[aria-label="#b5651d"]')!);
    expect(rendered.container.querySelector('[aria-label="#b5651d"]')?.getAttribute('aria-checked'), 'picked swatch is checked').toBe('true');
    await click(create());
    expect(fake.invoke, 'picked colour sent').toHaveBeenCalledWith('profile_create', { name: 'Home', colour: '#b5651d' });
  });

  it('shows the problem and stays open when the profile cannot be created', async () => {
    installFakeApi({ profile_create: { ok: false, error: { code: 'failed', message: 'name taken' } } });
    const onDone = vi.fn();
    rendered = await render(createElement(NewProfileForm, { palette: PALETTE, onDone }));
    await setValue(nameField(), 'Work');
    await click(create());
    expect(rendered.container.textContent, 'problem is shown').toContain('name taken');
    expect(onDone, 'form stays open').not.toHaveBeenCalled();
  });

  it('closes without creating when Cancel is pressed', async () => {
    const fake = installFakeApi();
    const onDone = vi.fn();
    rendered = await render(createElement(NewProfileForm, { palette: PALETTE, onDone }));
    await click([...rendered.container.querySelectorAll('button')].find((button) => button.textContent === 'Cancel')!);
    expect(onDone, 'closed').toHaveBeenCalledTimes(1);
    expect(fake.invoke, 'nothing created').not.toHaveBeenCalledWith('profile_create', expect.anything());
  });
});
