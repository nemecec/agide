// @vitest-environment jsdom
import { createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { installFakeApi } from '../testing/fakeApi';
import { render, type Rendered } from '../testing/render';
import { ProfileRail } from './ProfileRail';
import { ProfileStrip } from './ProfileStrip';
import type { ProfileList } from './profileModel';

let rendered: Rendered | undefined;
afterEach(async () => {
  await rendered?.unmount();
  rendered = undefined;
});

const temporary: ProfileList = { own: 'default', persistent: false, palette: [], profiles: [{ id: 'default', name: 'Default', colour: '#336699', running: true }] };
const persistent: ProfileList = { ...temporary, persistent: true };

describe('profile identity of a window', () => {
  it('shows a strip that names a temporary profile instead of leaving the window without identity', async () => {
    installFakeApi({ profile_list: temporary });
    rendered = await render(createElement(ProfileStrip));
    const strip = rendered.container.querySelector('[data-testid="profile-strip"]');
    expect(strip?.textContent, 'strip says which profile and that it is temporary').toBe('Default (temporary profile, not saved)');
    expect(strip?.getAttribute('data-temporary'), 'strip is marked temporary').toBe('true');
  });

  it('shows the profile colour and name for a saved profile', async () => {
    installFakeApi({ profile_list: persistent });
    rendered = await render(createElement(ProfileStrip));
    const strip = rendered.container.querySelector('[data-testid="profile-strip"]');
    expect(strip?.textContent, 'name').toBe('Default');
    expect(strip?.getAttribute('data-colour'), 'colour').toBe('#336699');
  });

  it('fills the rail of a temporary profile with a note, so the column is not empty', async () => {
    installFakeApi({ profile_list: temporary, usage_state: undefined });
    rendered = await render(createElement(ProfileRail, { instanceId: 'rail', config: {}, inputs: {} }));
    expect(rendered.container.querySelector('[data-testid="profile-rail"]')?.textContent, 'rail note').toContain('Temporary profile');
  });
});
