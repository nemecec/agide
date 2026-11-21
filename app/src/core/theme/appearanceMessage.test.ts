import { describe, expect, it } from 'vitest';
import { builtinTheme } from './builtin/index';
import { parseAppearanceMessage } from './appearance';
import { validateThemeDocument } from './schema';

const state = { dark: false, accent: null, highContrast: false, reducedTransparency: false, differentiateWithoutColour: false };
const user = { schema: 1, id: 'my-theme', name: 'Mine', kind: 'dark', extends: 'agide-dark', tokens: { accent: '#123456' } };

describe('appearance message with theme documents', () => {
  it('carries the document of a user theme, the revision, a preview and the last change', () => {
    const preview = { previewId: 'p1', name: 'Mine', expiresAt: 5, theme: user };
    const change = { kind: 'apply', revision: 3, name: 'Mine', at: 7 };
    const parsed = parseAppearanceMessage({ themeId: 'my-theme', state, theme: user, revision: 3, preview, change });
    expect(parsed.theme?.id, 'user theme document').toBe('my-theme');
    expect(parsed.revision, 'revision').toBe(3);
    expect(parsed.preview?.theme.name, 'preview document').toBe('Mine');
    expect(parsed.change, 'change').toEqual(change);
  });

  it('drops a theme document of the wrong shape or of another theme id', () => {
    expect(parseAppearanceMessage({ themeId: 'my-theme', state, theme: 'text' }).theme, 'not an object').toBeUndefined();
    expect(parseAppearanceMessage({ themeId: 'other-theme', state, theme: user }).theme, 'document of another theme').toBeUndefined();
    expect(parseAppearanceMessage({ themeId: 'system', state, preview: { previewId: 'p', expiresAt: 1, theme: 3 } }).preview, 'preview without a document').toBeUndefined();
  });

  it('accepts the shipped ports as documents', () => {
    for (const id of ['github-dark-default', 'catppuccin-mocha']) {
      const theme = builtinTheme(id);
      expect(parseAppearanceMessage({ themeId: id, state, theme }).theme?.id, `${id} survives the wire`).toBe(id);
    }
  });
});

describe('schema fixtures for imported themes', () => {
  const imported = { ...user, source: { kind: 'vscode-file' }, license: { spdx: 'MIT', copyright: 'c', text: 't' } };

  it('accepts the original VS Code colours kept with a theme', () => {
    expect(validateThemeDocument({ ...imported, vscode: { 'button.background': '#238636', 'list.activeSelectionBackground': '#6e768166' } }).ok, 'colours in all four VS Code forms').toBe(true);
  });

  it('refuses a kept value that is not a VS Code colour, so a CSS variable cannot carry other text', () => {
    const result = validateThemeDocument({ ...imported, vscode: { 'button.background': 'red; background: url(x)' } });
    expect(result.ok, 'refused').toBe(false);
    expect(result.issues[0], 'invalid_value at the key').toMatchObject({ code: 'invalid_value', path: '/vscode/button.background' });
  });

  it('requires a license for an imported theme and names the pointer', () => {
    const { license: _license, ...without } = imported;
    expect(validateThemeDocument(without).issues.map((issue) => [issue.code, issue.path]), 'license_missing').toEqual([['license_missing', '/license']]);
  });
});
