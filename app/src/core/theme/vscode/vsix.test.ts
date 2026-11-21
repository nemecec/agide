import { describe, expect, it } from 'vitest';
import { readVsix } from './vsix';
import { ZipError } from './zip';
import { buildZip } from './zipFixture';

const manifest = (themes: unknown[], extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ name: 'sample', publisher: 'acme', version: '1.2.3', license: 'MIT', contributes: { themes }, ...extra });

describe('readVsix', () => {
  it('reads the manifest, the listed theme files and the license file', () => {
    const bytes = buildZip([
      { name: 'extension/package.json', data: manifest([{ label: 'Sample Dark', uiTheme: 'vs-dark', path: './themes/dark.json' }]) },
      { name: 'extension/themes/dark.json', data: '{"colors": {}}' },
      { name: 'extension/LICENSE.txt', data: 'MIT License\n\nCopyright (c) 2024 Acme\n' },
    ]);
    const pkg = readVsix(bytes);
    expect(pkg.extension, 'publisher.name').toBe('acme.sample');
    expect(pkg.version, 'version').toBe('1.2.3');
    expect(pkg.themes, 'one theme with its label and uiTheme').toEqual([{ label: 'Sample Dark', uiTheme: 'vs-dark', text: '{"colors": {}}' }]);
    expect(pkg.license?.file, 'license file name').toBe('LICENSE.txt');
  });

  it('opens no entry that the manifest does not name, and none outside extension/', () => {
    const bytes = buildZip([
      { name: 'extension/package.json', data: manifest([{ label: 'Escape', path: '../../etc/theme.json' }, { label: 'Absolute', path: '/etc/theme.json' }, { label: 'Missing', path: './nothing.json' }]) },
      { name: 'extension/dist/extension.js', data: 'throw new Error("code must not run")' },
      { name: 'extension/themes/unlisted.json', data: '{"colors": {}}' },
    ]);
    expect(readVsix(bytes).themes, 'no theme is read').toEqual([]);
  });

  it('skips a listed file that is not a JSON file', () => {
    const bytes = buildZip([{ name: 'extension/package.json', data: manifest([{ label: 'Script', path: './dist/extension.js' }]) }, { name: 'extension/dist/extension.js', data: 'x' }]);
    expect(readVsix(bytes).themes, 'a script is not a theme').toEqual([]);
  });

  it('refuses a package without a manifest', () => {
    expect(() => readVsix(buildZip([{ name: 'extension/readme.md', data: 'x' }])), 'missing manifest').toThrow(ZipError);
  });
});
