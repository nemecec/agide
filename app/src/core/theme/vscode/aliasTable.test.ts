import { describe, expect, it } from 'vitest';
import { TOKEN_KEYS } from '../tokens';
import { ALIAS_KEYS, ALIAS_ROWS, aliasToken, vscodeKey, type AliasValue } from './aliasTable';

function tokensOf(value: AliasValue): string[] {
  if ('token' in value) return [value.token];
  if ('scheme' in value) return [...tokensOf(value.scheme.light), ...tokensOf(value.scheme.dark)];
  if ('mix' in value) return [value.mix[0], value.mix[1]];
  if ('scrollbar' in value) return ['text.primary'];
  if ('shadowColour' in value) return ['shadow.2'];
  return [];
}

describe('--vscode-* alias table', () => {
  it('reads only tokens of the token set', () => {
    const unknown = ALIAS_ROWS.flatMap((row) => tokensOf(row.value).filter((key) => !TOKEN_KEYS.includes(key)).map((key) => `${row.name} -> ${key}`));
    expect(unknown, 'aliases that read a token no theme defines').toEqual([]);
  });

  it('names each variable once', () => {
    const names = ALIAS_ROWS.map((row) => row.name);
    expect(names.filter((name, index) => names.indexOf(name) !== index), 'variables listed twice').toEqual([]);
  });

  it('maps variable names to VS Code colour keys', () => {
    expect(vscodeKey('--vscode-list-activeSelectionBackground'), 'dashes become dots').toBe('list.activeSelectionBackground');
    expect(vscodeKey('--vscode-panel--background'), 'the double dash spelling').toBe('panel.background');
    expect(vscodeKey('--vscode-font-size'), 'font variables have no colour key').toBeUndefined();
    expect(ALIAS_KEYS, 'the colour keys exclude font variables').not.toContain(undefined);
  });

  it('names the token behind a plain or scheme-dependent value', () => {
    expect(aliasToken({ token: 'accent', alpha: 40 }), 'plain token').toBe('accent');
    expect(aliasToken({ scheme: { light: { token: 'surface.content' }, dark: { token: 'surface.inset' } } }), 'light side of a scheme value').toBe('surface.content');
    expect(aliasToken({ mix: ['surface.raised', 'text.primary', 4] }), 'a mix has no single token').toBeUndefined();
  });
});
