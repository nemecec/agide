// @vitest-environment jsdom
import { act, createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installFakeApi } from '../../testing/fakeApi';
import { render, type Rendered } from '../../testing/render';
import { ApprovalBar } from './ApprovalBar';
import type { BrowserApproval } from './model';

let rendered: Rendered | undefined;
afterEach(async () => {
  await rendered?.unmount();
  rendered = undefined;
});

const approval = (over: Partial<BrowserApproval> = {}): BrowserApproval => ({ id: 'a1', origin: 'https://example.test', tool: 'computer', summary: 'click Save', kind: 'act', service: 'web', tabNumber: 1, ...over });
async function mount(value: BrowserApproval) {
  const fake = installFakeApi({ browser_answer_approval: {} });
  const answered = vi.fn();
  rendered = await render(createElement(ApprovalBar, { approval: value, onAnswered: answered }));
  return { fake, answered };
}
const buttons = () => [...rendered!.container.querySelectorAll('button')];
const press = (label: string) => act(async () => buttons().find((button) => button.textContent === label)!.click());

describe('ApprovalBar', () => {
  it('names the origin, the tool and what the agent wants to do', async () => {
    await mount(approval({ object: 'issue ABC-1' }));
    const text = rendered!.container.textContent!;
    expect(text, 'origin').toContain('https://example.test');
    expect(text, 'verb for acting').toContain('act on');
    expect(text, 'object').toContain('issue ABC-1');
    expect(text, 'tool and summary').toContain('computer, click Save');
  });

  it('says open for a navigation request', async () => {
    await mount(approval({ kind: 'navigate' }));
    expect(rendered!.container.textContent, 'verb for navigating').toContain('An agent asks to open');
  });

  it('names the session that asks and states a navigation request once', async () => {
    await mount(approval({ kind: 'navigate', sessionTitle: 'Check the dashboard', tool: 'navigate', summary: 'Open https://example.test' }));
    const text = rendered!.container.textContent!;
    expect(text, 'session named').toContain('The session "Check the dashboard" asks to open');
    expect(text.split('https://example.test').length - 1, 'the address appears once').toBe(1);
  });

  it('makes Allow once the primary action and keeps the standing allowance behind a disclosure', async () => {
    await mount(approval({ service: 'web' }));
    expect(buttons().find((button) => button.textContent === 'Allow once')?.classList.contains('btn-primary'), 'Allow once is primary').toBe(true);
    expect(buttons().find((button) => button.textContent === 'Deny')?.classList.contains('btn-primary'), 'Deny is not primary').toBe(false);
    expect(buttons().find((button) => button.textContent === 'Always allow this site')?.closest('details'), 'standing allowance sits in a closed disclosure').not.toBeNull();
  });

  it('sends the chosen answer with the request id and tells the pane afterwards', async () => {
    const { fake, answered } = await mount(approval());
    await press('Allow once');
    expect(fake.invoke, 'answer sent').toHaveBeenCalledWith('browser_answer_approval', { id: 'a1', answer: 'once' });
    expect(answered, 'pane told').toHaveBeenCalledTimes(1);
    await press('Deny');
    expect(fake.invoke, 'deny sent').toHaveBeenLastCalledWith('browser_answer_approval', { id: 'a1', answer: 'deny' });
    await press('Allow for this session');
    expect(fake.invoke, 'session sent').toHaveBeenLastCalledWith('browser_answer_approval', { id: 'a1', answer: 'session' });
  });

  it('offers a standing allowance for a web site only, not for a service tab', async () => {
    await mount(approval({ service: 'web' }));
    expect(buttons().map((button) => button.textContent), 'web').toContain('Always allow this site');
    await rendered!.unmount();
    await mount(approval({ service: 'jira' }));
    expect(buttons().map((button) => button.textContent), 'service').not.toContain('Always allow this site');
  });
});
