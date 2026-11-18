// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { installFakeApi } from '../../testing/fakeApi';
import { holdViews, installDragSuspension, resumeViews, suspendViews } from './suspension';

let remove: (() => void) | undefined;
afterEach(async () => {
  remove?.();
  remove = undefined;
  await resumeViews();
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('drag suspension of native views', () => {
  it('suspends the views when a drag starts and resumes them when it ends', async () => {
    const api = installFakeApi({ browser_views_suspend: { stills: [] }, browser_views_resume: { resumed: true } });
    remove = installDragSuspension(document);
    document.dispatchEvent(new Event('dragstart'));
    await settle();
    expect(api.invoke.mock.calls.map((call) => call[0]), 'suspended on dragstart').toEqual(['browser_views_suspend']);
    document.dispatchEvent(new Event('dragstart'));
    await settle();
    expect(api.invoke.mock.calls.length, 'a second drag start while suspended does nothing').toBe(1);
    document.dispatchEvent(new Event('dragend'));
    await settle();
    expect(api.invoke.mock.calls.map((call) => call[0]), 'resumed on dragend').toEqual(['browser_views_suspend', 'browser_views_resume']);
  });

  it('suspends for a drag of a split divider and resumes on pointer up, and ignores other pointer presses', async () => {
    const api = installFakeApi({ browser_views_suspend: { stills: [] }, browser_views_resume: { resumed: true } });
    remove = installDragSuspension(document);
    const sash = document.createElement('div');
    sash.className = 'dv-sash';
    const other = document.createElement('div');
    document.body.append(sash, other);
    other.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await settle();
    expect(api.invoke.mock.calls.length, 'a press outside a sash').toBe(0);
    sash.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await settle();
    expect(api.invoke.mock.calls.map((call) => call[0]), 'sash press suspends').toEqual(['browser_views_suspend']);
    document.dispatchEvent(new Event('pointerup'));
    await settle();
    expect(api.invoke.mock.calls.map((call) => call[0]), 'pointer up resumes').toEqual(['browser_views_suspend', 'browser_views_resume']);
  });

  it('resumes a suspension whose answer arrives after the drag already ended', async () => {
    let release: (() => void) | undefined;
    const api = installFakeApi({
      browser_views_suspend: () => new Promise((resolve) => (release = () => resolve({ stills: [] }))),
      browser_views_resume: { resumed: true },
    });
    const suspending = suspendViews();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const resuming = resumeViews();
    release?.();
    await Promise.all([suspending, resuming]);
    expect(api.invoke.mock.calls.filter((call) => call[0] === 'browser_views_resume').length, 'views are shown again').toBeGreaterThanOrEqual(1);
  });

  it('keeps the views hidden until the last overlay lets go, also when a drag ends meanwhile', async () => {
    const api = installFakeApi({ browser_views_suspend: { stills: [] }, browser_views_resume: { resumed: true } });
    const releaseDialog = holdViews();
    const releaseMenu = holdViews();
    await suspendViews();
    await resumeViews();
    releaseDialog();
    await resumeViews();
    const names = () => api.invoke.mock.calls.map((call) => call[0]);
    expect(names(), 'one suspend for all holders, no resume while a hold remains').toEqual(['browser_views_suspend']);
    releaseMenu();
    releaseMenu();
    await resumeViews();
    expect(names(), 'the last release shows the views once').toEqual(['browser_views_suspend', 'browser_views_resume']);
  });
});
