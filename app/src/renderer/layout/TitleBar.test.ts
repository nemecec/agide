// @vitest-environment jsdom
import { act, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDialog, currentDialog } from '../dialogs/dialogStore';
import { resetAgentsFeeds } from '../panes/agents/useAgents';
import type { ProfileList } from '../panes/profileModel';
import { click } from '../testing/dom';
import { installFakeApi } from '../testing/fakeApi';
import { render, type Rendered } from '../testing/render';
import { TitleBar } from './TitleBar';
import type { LayoutViewState } from './useLayoutState';

let rendered: Rendered | undefined;
beforeEach(() => resetAgentsFeeds());
afterEach(async () => {
  await rendered?.unmount();
  rendered = undefined;
  closeDialog();
  document.body.innerHTML = '';
});

const profiles: ProfileList = { own: 'default', persistent: true, palette: [], profiles: [{ id: 'default', name: 'Default', colour: '#5b7fa6', running: true }] };
const view = {
  activeLayoutId: 'session',
  layouts: [
    { id: 'session', title: 'session', active: true },
    { id: 'pair', title: 'pair', active: false },
  ],
} as unknown as LayoutViewState;
const answers = (over: Record<string, unknown> = {}) =>
  installFakeApi({ profile_list: profiles, inbox_list: { items: [], unread: 2 }, usage_state: undefined, profile_setup_status: { needed: false }, layout_switch: {}, ...over });
const bar = () => rendered!.container.querySelector<HTMLElement>('[data-testid="title-bar"]')!;
const mount = async (onShowInbox: (() => void) | null = () => undefined) => {
  rendered = await render(createElement(TitleBar, { view, onShowInbox: onShowInbox ?? undefined }));
};

describe('TitleBar', () => {
  it('shows the profile name, the active layout, the unread count, and takes the profile colour for its border', async () => {
    answers();
    await mount();
    expect(bar().querySelector('[data-testid="profile-identity-name"]')?.textContent, 'profile name stays in the title bar').toBe('Default');
    expect(bar().querySelector('[data-testid="layout-switcher"]')?.textContent, 'active layout name, capitalised').toBe('Session');
    expect(bar().querySelector('[data-testid="title-bar-unread"]')?.textContent, 'unread count on the inbox button').toContain('2');
    expect(bar().style.getPropertyValue('--profile-mark'), 'border colour comes from the profile').toMatch(/^#[0-9a-f]{6}$/);
  });

  it('puts the unread badge in a slot that the window capture masks, because it counts the inbox of every folder', async () => {
    answers();
    await mount();
    const slot = bar().querySelector('[data-testid="title-bar-unread-slot"]');
    expect(slot?.hasAttribute('data-capture-scoped'), 'the slot carries the attribute the capture masks for a scoped caller').toBe(true);
    expect(slot?.contains(bar().querySelector('[data-testid="title-bar-unread"]')), 'the badge sits inside the slot').toBe(true);
  });

  it('renders the masked slot also when nothing is unread, so its presence does not show whether any folder has unread items', async () => {
    answers({ inbox_list: { items: [], unread: 0 } });
    await mount();
    expect(bar().querySelector('[data-testid="title-bar-unread-slot"]')?.hasAttribute('data-capture-scoped'), 'the slot exists at zero').toBe(true);
  });

  it('has no profile colour for a temporary profile', async () => {
    answers({ profile_list: { ...profiles, persistent: false } });
    await mount();
    expect(bar().style.getPropertyValue('--profile-mark'), 'no mark colour').toBe('');
    expect(bar().getAttribute('data-temporary'), 'marked temporary').toBe('true');
  });

  it('switches layout from the menu', async () => {
    const fake = answers();
    await mount();
    const trigger = bar().querySelector<HTMLElement>('[data-testid="layout-switcher"]')!;
    await act(async () => {
      trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' } as PointerEventInit));
    });
    const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((candidate) => candidate.textContent === 'Pair');
    expect(item, 'menu lists the other layout').toBeDefined();
    await click(item!);
    expect(fake.invoke, 'layout switched').toHaveBeenCalledWith('layout_switch', { layoutId: 'pair' });
  });

  it('opens settings and shows the inbox from its buttons', async () => {
    answers();
    const showInbox = vi.fn();
    await mount(showInbox);
    await click(bar().querySelector('[data-testid="title-bar-inbox"]')!);
    expect(showInbox, 'inbox shown').toHaveBeenCalledTimes(1);
    await click(bar().querySelector('[data-testid="title-bar-settings"]')!);
    expect(currentDialog()?.kind, 'settings dialog requested').toBe('settings');
  });

  it('marks the inbox button unavailable when the layout has no inbox', async () => {
    answers();
    await mount(null);
    expect(bar().querySelector('[data-testid="title-bar-inbox"]')?.getAttribute('aria-disabled'), 'unavailable').toBe('true');
  });

  it('keeps the unread count current from events', async () => {
    const fake = answers({ inbox_list: { items: [], unread: 0 } });
    await mount();
    expect(bar().querySelector('[data-testid="title-bar-unread"]'), 'no badge at zero').toBeNull();
    await act(async () => fake.emit({ type: 'inbox.unread_changed', count: 5 } as never));
    expect(bar().querySelector('[data-testid="title-bar-unread"]')?.textContent, 'badge follows the event').toContain('5');
  });
});
