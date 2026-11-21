// @vitest-environment jsdom
import { act, createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ThemeDocument } from '../../../core/theme/index';
import { installFakeApi, type FakeApi } from '../../testing/fakeApi';
import { flush, render, type Rendered } from '../../testing/render';
import { ImportThemeDialog } from './ImportThemeDialog';

const theme: ThemeDocument = {
  schema: 1,
  id: 'plain-dark',
  name: 'Plain Dark',
  kind: 'dark',
  extends: 'agide-dark',
  tokens: {},
  license: { spdx: 'MIT', copyright: 'Copyright (c) 2024 Acme', text: 'MIT License text' },
  source: { kind: 'vscode-file', name: 'Plain Dark', extension: 'acme.plain', version: '1.0.0', sha256: 'abcdef0123456789abcdef' },
};
const result = { saved: false, theme, adjustments: [{ token: 'text.secondary', from: '#777777', to: '#999999', reason: '3.00 to 1 on selection; target 4.5' }], warnings: [] };

let rendered: Rendered | undefined;
afterEach(async () => {
  await rendered?.unmount();
  rendered = undefined;
  document.body.replaceChildren();
});

const field = () => document.querySelector<HTMLInputElement>('[data-testid="theme-import-file"]');
async function choose(name: string, content = '{}'): Promise<void> {
  const input = field();
  if (!input) throw new Error('file input not found');
  const file = new File([content], name);
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new TextEncoder().encode(content).buffer });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => void input.dispatchEvent(new Event('change', { bubbles: true })));
  await flush();
}
const imports = (fake: FakeApi) => fake.invoke.mock.calls.filter((call) => call[0] === 'theme_import');
const button = (name: string) => [...document.querySelectorAll('button')].find((candidate) => candidate.textContent === name);
const open = async (fake: FakeApi, onKept = vi.fn()) => {
  rendered = await render(createElement(ImportThemeDialog, { open: true, onOpenChange: () => undefined, onKept }));
  return { fake, onKept };
};

describe('ImportThemeDialog', () => {
  it('shows the license, the source and the adjustments before Keep, and saves on Keep', async () => {
    const fake = installFakeApi({ theme_import: (input: unknown) => ({ ...result, saved: (input as { dryRun: boolean }).dryRun === false }) });
    const { onKept } = await open(fake);
    expect(button('Keep theme')?.disabled, 'Keep waits for a file').toBe(true);
    await choose('plain.json', '{"colors":{}}');
    expect(imports(fake)[0], 'the first call is a dry run with the file content').toEqual(['theme_import', { data: btoa('{"colors":{}}'), fileName: 'plain.json', dryRun: true }]);
    expect(document.querySelector<HTMLTextAreaElement>('[data-testid="theme-import-license"]')?.value, 'full license text').toBe('MIT License text');
    expect(document.querySelector('[data-testid="theme-import-source"]')?.textContent, 'extension, version and hash').toContain('acme.plain · 1.0.0');
    expect(document.querySelector('[data-testid="theme-import-adjustments"]')?.textContent, 'adjustment rows').toContain('#999999');
    await act(async () => button('Keep theme')?.click());
    await flush();
    expect(imports(fake).at(-1), 'Keep imports without dryRun').toEqual(['theme_import', { data: btoa('{"colors":{}}'), fileName: 'plain.json', dryRun: false }]);
    expect(onKept, 'the picker refreshes').toHaveBeenCalled();
  });

  it('asks for a license when the file has none and offers the unknown license', async () => {
    const fake = installFakeApi({
      theme_import: (input: unknown) => ((input as { license?: unknown }).license ? result : { ok: false, error: { code: 'invalid_input', message: 'license', details: { issues: [{ code: 'license_missing' }] } } }),
    });
    await open(fake);
    await choose('plain.json');
    expect(document.querySelector('[data-testid="theme-import-license-form"]'), 'license form shown').not.toBeNull();
    await act(async () => document.querySelector<HTMLButtonElement>('[data-testid="theme-import-license-unknown"]')?.click());
    await flush();
    const last = imports(fake).at(-1)?.[1] as { license: { spdx: string } };
    expect(last.license.spdx, 'the unknown license is sent').toBe('LicenseRef-unknown');
    expect(document.querySelector('[data-testid="theme-import-review"]'), 'review shown after the license').not.toBeNull();
  });

  it('keeps the original colours when the user asks', async () => {
    const fake = installFakeApi({ theme_import: result });
    await open(fake);
    await choose('plain.json');
    await act(async () => document.querySelector<HTMLButtonElement>('[data-testid="theme-import-keep-original"]')?.click());
    await flush();
    expect(imports(fake).at(-1)?.[1], 'the analysis repeats with keepOriginalContrast').toMatchObject({ keepOriginalContrast: true, dryRun: true });
  });

  it('shows the message when the file cannot be imported', async () => {
    const fake = installFakeApi({ theme_import: { ok: false, error: { code: 'invalid_input', message: 'The file is not valid JSON. Unexpected token', details: { issues: [{ code: 'invalid_json' }] } } } });
    await open(fake);
    await choose('broken.json');
    expect(document.body.textContent, 'the failure is shown').toContain('The file is not valid JSON.');
    expect(button('Keep theme')?.disabled, 'Keep stays disabled').toBe(true);
  });
});
