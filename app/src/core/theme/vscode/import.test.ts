import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateThemeDocument } from '../schema';
import { importVsCodeTheme, slugify, type ImportRequest } from './import';
import { guessSpdx } from './license';
import { buildZip } from './zipFixture';

const colours = (name: string): string => readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8');
const MIT = 'MIT License\n\nCopyright (c) 2024 Acme\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software.';
const request = (extra: Partial<ImportRequest> & Pick<ImportRequest, 'bytes' | 'fileName'>): ImportRequest => ({
  existingIds: new Set(['agide-dark']),
  now: new Date('2026-11-21T10:00:00Z'),
  importer: 'Agide test',
  ...extra,
});
const bare = (name: string, extra: Partial<ImportRequest> = {}) => importVsCodeTheme(request({ bytes: Buffer.from(colours(name)), fileName: `${name}.json`, ...extra }));
const manifest = (themes: unknown[]) => JSON.stringify({ name: 'sample', publisher: 'acme', version: '2.0.0', license: 'MIT', contributes: { themes } });
const pack = (themes: { label: string; uiTheme: string; text: string }[], license = true) =>
  buildZip([
    { name: 'extension/package.json', data: manifest(themes.map((theme, index) => ({ label: theme.label, uiTheme: theme.uiTheme, path: `./themes/${index}.json` }))) },
    ...themes.map((theme, index) => ({ name: `extension/themes/${index}.json`, data: theme.text })),
    ...(license ? [{ name: 'extension/LICENSE', data: MIT }] : []),
  ]);

describe('importVsCodeTheme', () => {
  it('needs a license for a bare theme file', () => {
    const outcome = bare('catppuccin-mocha');
    expect(outcome.ok ? undefined : outcome.issues[0]?.code, 'license_missing').toBe('license_missing');
  });

  it('builds a valid theme document with the license and the source recorded', () => {
    const outcome = bare('catppuccin-mocha', { license: { spdx: 'MIT', copyright: 'Copyright (c) 2021 Catppuccin', text: MIT } });
    expect(outcome.ok, 'import succeeds').toBe(true);
    if (!outcome.ok) return;
    const { theme } = outcome;
    expect(validateThemeDocument(theme).ok, 'the document passes the schema').toBe(true);
    expect(theme.license?.spdx, 'license id').toBe('MIT');
    expect(theme.source, 'source fields').toMatchObject({ kind: 'vscode-file', name: 'Catppuccin Mocha', importedAt: '2026-11-21T10:00:00.000Z', importer: 'Agide test' });
    expect(theme.source?.sha256, 'sha256 of the file').toMatch(/^[0-9a-f]{64}$/);
    expect(theme.source?.adjustments?.map((adjustment) => adjustment.token), 'the clamp adjustments are stored').toContain('text.tertiary');
    expect(theme.id, 'id from the name').toBe('catppuccin-mocha');
    expect(theme.vscode?.['button.background'], 'original colours kept for the aliases').toBe('#cba6f7');
  });

  it('gives a free id when the slug is taken', () => {
    const taken = bare('catppuccin-mocha', { license: { spdx: 'MIT', copyright: 'c', text: MIT }, existingIds: new Set(['catppuccin-mocha', 'catppuccin-mocha-2']) });
    expect(taken.ok ? taken.theme.id : undefined, 'third id').toBe('catppuccin-mocha-3');
  });

  it('keeps the original colours on request and reports the contrast warnings', () => {
    const outcome = bare('catppuccin-mocha', { license: { spdx: 'MIT', copyright: 'c', text: MIT }, keepOriginalContrast: true });
    expect(outcome.ok, 'import succeeds').toBe(true);
    if (!outcome.ok) return;
    expect(outcome.theme.tokens?.['text.tertiary'], 'the unclamped colour is stored').toBe('#777c93');
    expect(outcome.adjustments, 'no adjustment is applied').toEqual([]);
    expect(outcome.theme.source?.adjustments, 'none is recorded').toBeUndefined();
    expect(outcome.warnings.map((warning) => warning.code), 'contrast_below_target warnings remain').toContain('contrast_below_target');
  });

  it('reads one theme of a package with its license file and manifest data', () => {
    const outcome = importVsCodeTheme(request({ bytes: pack([{ label: 'Mocha', uiTheme: 'vs-dark', text: colours('catppuccin-mocha') }]), fileName: 'sample.vsix' }));
    expect(outcome.ok, 'import succeeds').toBe(true);
    if (!outcome.ok) return;
    expect(outcome.theme.license, 'license from the package').toMatchObject({ spdx: 'MIT', copyright: 'Copyright (c) 2024 Acme' });
    expect(outcome.theme.source, 'extension and version from the manifest').toMatchObject({ extension: 'acme.sample', version: '2.0.0' });
    expect(outcome.theme.name, 'label of the theme in the package').toBe('Mocha');
  });

  it('asks which theme to take from a package with several, and takes the chosen one', () => {
    const bytes = pack([
      { label: 'Dark', uiTheme: 'vs-dark', text: colours('catppuccin-mocha') },
      { label: 'Other', uiTheme: 'vs-dark', text: colours('github-dark-default') },
    ]);
    const asked = importVsCodeTheme(request({ bytes, fileName: 'sample.vsix' }));
    expect(asked.ok ? undefined : asked.choices, 'labels offered').toEqual(['Dark', 'Other']);
    const chosen = importVsCodeTheme(request({ bytes, fileName: 'sample.vsix', themeLabel: 'Other' }));
    expect(chosen.ok ? chosen.theme.name : undefined, 'the chosen label').toBe('Other');
  });

  it('adds increased contrast overrides to a high contrast theme', () => {
    const text = JSON.stringify({ colors: { 'editor.background': '#000000', foreground: '#ffffff' } });
    const outcome = importVsCodeTheme(request({ bytes: pack([{ label: 'HC', uiTheme: 'hc-black', text }]), fileName: 'hc.vsix' }));
    expect(outcome.ok ? outcome.theme.increasedContrast?.['text.primary'] : undefined, 'hc-black carries the dark overrides').toBe('#ffffff');
  });

  it('reports invalid JSON, include and a package without themes with their codes', () => {
    const code = (outcome: ReturnType<typeof importVsCodeTheme>) => (outcome.ok ? undefined : outcome.issues[0]?.code);
    expect(code(importVsCodeTheme(request({ bytes: Buffer.from('{oops'), fileName: 'x.json', license: { spdx: 'MIT', copyright: 'c', text: MIT } }))), 'invalid JSON').toBe('invalid_json');
    expect(code(importVsCodeTheme(request({ bytes: Buffer.from('{"include":"./a.json","colors":{}}'), fileName: 'x.json', license: { spdx: 'MIT', copyright: 'c', text: MIT } }))), 'include').toBe('include_unsupported');
    expect(code(importVsCodeTheme(request({ bytes: pack([]), fileName: 'empty.vsix' }))), 'no themes').toBe('missing_field');
  });

  it('reads comments in a theme file', () => {
    const text = '{\n // a comment\n "colors": { "editor.background": "#101010", "foreground": "#eeeeee", },\n}';
    const outcome = importVsCodeTheme(request({ bytes: Buffer.from(text), fileName: 'plain.json', license: { spdx: 'MIT', copyright: 'c', text: MIT } }));
    expect(outcome.ok, 'JSON with comments imports').toBe(true);
  });
});

describe('license and names', () => {
  it('guesses the SPDX id from the license text', () => {
    expect(guessSpdx(MIT), 'MIT').toBe('MIT');
    expect(guessSpdx('Apache License\nVersion 2.0, January 2004'), 'Apache').toBe('Apache-2.0');
    expect(guessSpdx('free text', 'CC0-1.0'), 'manifest id when the text is unknown').toBe('CC0-1.0');
    expect(guessSpdx('free text'), 'unknown').toBe('LicenseRef-unknown');
  });

  it('makes ids of 3 to 48 lower case characters', () => {
    expect(slugify('GitHub Dark Default (port)'), 'punctuation').toBe('github-dark-default-port');
    expect(slugify('Ab'), 'too short').toBe('theme-ab');
    expect(slugify('Ünïcode Théme'), 'accents').toBe('unicode-theme');
  });
});
