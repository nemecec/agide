// @vitest-environment jsdom
import { createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { installFakeApi } from '../testing/fakeApi';
import { render, type Rendered } from '../testing/render';
import { ProfileIdentity } from './ProfileIdentity';
import { ProfileRail, profileLabel } from './ProfileRail';
import type { ProfileList } from './profileModel';

let rendered: Rendered | undefined;
afterEach(async () => {
  await rendered?.unmount();
  rendered = undefined;
  document.body.innerHTML = '';
});

const temporary: ProfileList = { own: 'default', persistent: false, palette: [], profiles: [{ id: 'default', name: 'Default', colour: '#336699', running: true }] };
const persistent: ProfileList = { ...temporary, persistent: true };
const two: ProfileList = {
  own: 'work',
  persistent: true,
  palette: ['#5b7fa6'],
  profiles: [
    { id: 'default', name: 'Default', colour: '#5b7fa6', running: true, unread: 3 },
    { id: 'work', name: 'Work', colour: '#a64f7e', running: false },
  ],
};
const identity = () => rendered!.container.querySelector('[data-testid="profile-identity"]');
const tile = () => identity()?.querySelector<HTMLElement>('.profile-tile');

describe('profile identity in the title bar', () => {
  it('shows a dashed tile, the name and a Temporary chip for a temporary profile, so the window is never without identity', async () => {
    installFakeApi({ profile_list: temporary });
    rendered = await render(createElement(ProfileIdentity));
    expect(identity()?.textContent, 'tile letter, name and chip').toBe('DDefaultTemporary');
    expect(identity()?.getAttribute('data-temporary'), 'marked temporary').toBe('true');
    expect(tile()?.hasAttribute('data-temporary'), 'the tile has no fill').toBe(true);
  });

  it('is reachable with Tab and named for assistive technology', async () => {
    installFakeApi({ profile_list: temporary });
    rendered = await render(createElement(ProfileIdentity));
    expect(identity()?.getAttribute('tabindex'), 'the identity takes focus').toBe('0');
    expect(identity()?.getAttribute('aria-label'), 'name and state').toBe('Default, temporary profile, not saved');
  });

  it('shows the tile in the profile colour and the name for a saved profile', async () => {
    installFakeApi({ profile_list: persistent });
    rendered = await render(createElement(ProfileIdentity));
    expect(identity()?.textContent, 'letter and name').toBe('DDefault');
    expect(identity()?.getAttribute('data-colour'), 'stored colour').toBe('#336699');
    expect(tile()?.style.getPropertyValue('--profile-tile'), 'tile colour').not.toBe('');
    expect(identity()?.querySelector('[data-testid="profile-temporary-chip"]'), 'no chip for a saved profile').toBeNull();
  });

  it('is a plain element until something opens from it, then a button', async () => {
    installFakeApi({ profile_list: persistent });
    rendered = await render(createElement(ProfileIdentity));
    expect(identity()?.tagName, 'plain').toBe('DIV');
    await rendered.rerender(createElement(ProfileIdentity, { onClick: () => undefined }));
    expect(identity()?.tagName, 'button').toBe('BUTTON');
    expect(identity()?.getAttribute('aria-label'), 'names the profile and the action').toBe('Default, profile setup');
  });
});

describe('profile rail', () => {
  it('shows the own tile alone for a temporary profile, so the column is not empty', async () => {
    installFakeApi({ profile_list: temporary });
    rendered = await render(createElement(ProfileRail, { instanceId: 'rail', config: {}, inputs: {} }));
    const mark = rendered.container.querySelector('[data-testid="profile-temporary"]');
    expect(mark?.getAttribute('aria-label'), 'says the profile is not saved').toBe('Temporary profile, not saved');
    expect(rendered.container.querySelector('[data-testid="profile-new"]'), 'no new profile tile').toBeNull();
  });

  it('names each profile with its state and unread count, and marks the own profile as current', async () => {
    installFakeApi({ profile_list: two });
    rendered = await render(createElement(ProfileRail, { instanceId: 'rail', config: {}, inputs: {} }));
    const entry = (id: string) => rendered!.container.querySelector<HTMLElement>(`[data-testid="profile-${id}"]`);
    expect(entry('default')?.getAttribute('aria-label'), 'running with unread').toBe('Default, running, 3 unread');
    expect(entry('work')?.getAttribute('aria-label'), 'not running').toBe('Work, not running');
    expect(entry('work')?.getAttribute('aria-current'), 'own profile is current').toBe('true');
    expect(entry('default')?.getAttribute('aria-current'), 'other profile is not').toBeNull();
    expect(entry('default')?.querySelector('[data-testid="badge-default"]')?.textContent, 'badge count').toContain('3');
  });

  it('opens the profile that is clicked', async () => {
    const fake = installFakeApi({ profile_list: two, profile_open: {} });
    rendered = await render(createElement(ProfileRail, { instanceId: 'rail', config: {}, inputs: {} }));
    rendered.container.querySelector<HTMLElement>('[data-testid="profile-default"]')!.click();
    expect(fake.invoke, 'profile_open called').toHaveBeenCalledWith('profile_open', { id: 'default' });
  });

  it('words the label of a profile with more than 99 unread items', () => {
    expect(profileLabel({ id: 'a', name: 'A', colour: '#000000', running: true, unread: 120 }), 'capped').toBe('A, running, 99+ unread');
  });
});
