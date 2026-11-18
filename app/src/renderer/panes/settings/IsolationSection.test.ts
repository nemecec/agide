// @vitest-environment jsdom
import { act, createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { describeProvider } from '../../../core/isolation/capabilityStatement';
import type { IsolationStatus, ProviderRow } from '../../../core/isolation/statusTypes';
import { installFakeApi } from '../../testing/fakeApi';
import { render, type Rendered } from '../../testing/render';
import { IsolationSection } from './IsolationSection';

const caps = { filesystem: 'enforced', network: 'allowlist', login: 'host-keychain', hookTransports: ['inbox-dir'], transcripts: 'host-files' } as const;
const row = (id: ProviderRow['id'], extra: Partial<ProviderRow> = {}): ProviderRow => ({
  id,
  check: { ok: true },
  statement: describeProvider(id, id === 'local' ? { ...caps, filesystem: 'host-user', network: 'none' } : id === 'container' ? { ...caps, network: 'none' } : caps),
  selectable: true,
  ...extra,
});
const status = (providers: ProviderRow[], selected: IsolationStatus['selected'] = 'local'): IsolationStatus => ({ selected, options: {}, providers });

let rendered: Rendered | undefined;
afterEach(async () => {
  await rendered?.unmount();
  rendered = undefined;
});

describe('IsolationSection', () => {
  it('shows each provider with its capability statement and the bypass answer', async () => {
    installFakeApi({ isolation_status: status([row('local'), row('srt'), row('container', { selectable: false, selectableReason: 'No real claude has run in it yet.' })]) });
    rendered = await render(createElement(IsolationSection));
    const text = rendered.container.textContent ?? '';
    expect(text, 'srt statement lists the open loopback').toContain('Loopback');
    expect(rendered.container.querySelector('[data-testid="isolation-srt-bypass"]')?.textContent, 'srt bypass answer').toContain('Allowed');
    expect(rendered.container.querySelector('[data-testid="isolation-container-bypass"]')?.textContent, 'container bypass answer').toContain('Not allowed');
    expect(rendered.container.querySelector('[data-testid="isolation-container-check"]')?.textContent, 'container remark').toContain('No real claude');
  });

  it('shows the not-installed message with the fix and disables the choice', async () => {
    installFakeApi({
      isolation_status: status([row('local'), row('srt', { check: { ok: false, reason: 'The sandbox runtime (srt) is not installed', fix: 'Install it.' }, selectable: false })]),
    });
    rendered = await render(createElement(IsolationSection));
    expect(rendered.container.querySelector('[data-testid="isolation-srt-check"]')?.textContent, 'reason and fix').toBe('The sandbox runtime (srt) is not installed. Install it.');
    const radio = rendered.container.querySelector<HTMLInputElement>('[data-testid="isolation-srt"] input[type="radio"]');
    expect(radio?.disabled, 'unavailable provider cannot be chosen').toBe(true);
  });

  it('sends the choice with the typed path and shows a refusal', async () => {
    const fake = installFakeApi({
      isolation_status: status([row('local'), row('srt')]),
      isolation_set_provider: { ok: false, error: { code: 'failed', message: 'refused' } },
    });
    rendered = await render(createElement(IsolationSection));
    const input = rendered.container.querySelector<HTMLInputElement>('input[aria-label="Sandbox runtime (srt) srt path"]');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, '/opt/srt');
      input?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => rendered?.container.querySelector<HTMLInputElement>('[data-testid="isolation-srt"] input[type="radio"]')?.click());
    expect(fake.invoke, 'command with provider and path').toHaveBeenCalledWith('isolation_set_provider', { provider: 'srt', srtBinary: '/opt/srt' });
    expect(rendered.container.querySelector('[role="alert"]')?.textContent, 'refusal shown').toBe('refused');
  });
});
