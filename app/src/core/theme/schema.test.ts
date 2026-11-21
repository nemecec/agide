import { describe, expect, it } from 'vitest';
import { BUILTIN_THEMES, builtinTheme } from './builtin/index';
import { contrastIssues, includeUnsupported, THEME_ERROR_CODES, themeJsonSchema, validateThemeDocument, validateThemeText, type ThemeErrorCode } from './schema';
import { resolveTheme } from './resolve';

const valid = () => ({ schema: 1, id: 'my-dark', name: 'My Dark', kind: 'dark', extends: 'agide-dark', tokens: { 'surface.window': '#1c1c1f' } });
const codes = (input: unknown, context = {}) => validateThemeDocument(input, context).issues.map((found) => found.code);

describe('theme schema', () => {
  it('accepts a theme that extends a built-in theme and the built-in themes themselves', () => {
    expect(validateThemeDocument(valid()).ok, 'extending theme').toBe(true);
    expect(BUILTIN_THEMES.map((theme) => theme.id), 'built-in ids').toEqual(['system', 'agide-light', 'agide-dark', 'github-dark-default', 'catppuccin-mocha']);
  });

  it('reports invalid_json with a line and column and the parser message as the hint', () => {
    const result = validateThemeText('{\n  "schema": 1,\n  "id": }');
    expect(result.issues[0]?.code, 'code').toBe('invalid_json');
    expect(result.issues[0]?.message, 'position in the message').toMatch(/line \d+, column \d+/);
    expect(result.issues[0]?.message, 'the bad token is on line 3').toContain('line 3');
    expect(result.issues[0]?.hint.length, 'the hint carries the parser message').toBeGreaterThan(0);
    expect(validateThemeText('{"schema": 1').issues[0]?.message, 'a truncated file points at its end').toContain('line 1, column 13');
  });

  it('reports schema_version_unsupported for a newer schema', () => {
    const [found] = validateThemeDocument({ ...valid(), schema: 2 }).issues;
    expect(found?.code, 'code').toBe('schema_version_unsupported');
    expect(found?.message, 'message').toBe('Theme schema 2 is newer than this app reads (1).');
  });

  it('reports missing_field with the JSON pointer', () => {
    const { schema: _schema, name: _name, ...rest } = valid();
    const found = validateThemeDocument({ schema: 1, ...rest }).issues.find((issue) => issue.code === 'missing_field');
    expect(found?.path, 'pointer of the missing name').toBe('/name');
    expect(found?.message, 'message').toBe('`/name` is required.');
  });

  it('reports unknown_token with the closest names', () => {
    const [found] = validateThemeDocument({ ...valid(), tokens: { 'surface.panel': '#ffffff' } }).issues;
    expect(found?.code, 'code').toBe('unknown_token');
    expect(found?.path, 'pointer').toBe('/tokens/surface.panel');
    expect(found?.hint, 'closest names').toMatch(/closest token names are `surface\./);
  });

  it('reports computed_token for a token the app computes', () => {
    const [found] = validateThemeDocument({ ...valid(), tokens: { 'surface.hover': '#ffffff' } }).issues;
    expect(found?.code, 'code').toBe('computed_token');
    expect(found?.message, 'message').toContain('computed from `text.primary`');
  });

  it('reports invalid_value by token type', () => {
    const [found] = validateThemeDocument({ ...valid(), tokens: { accent: 'blue' } }).issues;
    expect(found?.code, 'code').toBe('invalid_value');
    expect(found?.message, 'message').toBe('`/tokens/accent` must be a hex colour (#rgb or #rrggbb); got `blue`.');
    expect(codes({ ...valid(), tokens: { 'radius.md': '6' } }), 'a length needs px').toEqual(['invalid_value']);
    expect(codes({ ...valid(), tokens: { 'motion.fast': '100ms', 'surface.backdrop': 'rgb(0 0 0 / 20%)' } }), 'valid duration and css colour').toEqual([]);
    expect(codes({ ...valid(), extra: 1 }), 'an unknown top-level field').toEqual(['invalid_value']);
    expect(codes({ ...valid(), id: 'A' }), 'an id with a capital').toEqual(['invalid_value']);
  });

  it('reports missing_token for every required token when extends is absent', () => {
    const { extends: _extends, ...without } = valid();
    const found = validateThemeDocument(without).issues.filter((issue) => issue.code === 'missing_token');
    expect(found.some((issue) => issue.path === '/tokens/text.primary'), 'text.primary is required').toBe(true);
    expect(found[0]?.message, 'message form').toContain('is required when `extends` is absent');
  });

  it('reports unknown_dock_variable and accepts a dockview variable', () => {
    expect(codes({ ...valid(), dock: { '--dv-foo': '1px' } }), 'unknown variable').toEqual(['unknown_dock_variable']);
    expect(codes({ ...valid(), dock: { '--dv-tab-font-size': '12px' } }), 'known variable').toEqual([]);
  });

  it('checks terminal fields', () => {
    expect(codes({ ...valid(), terminal: { red: '#ff7a70' } }), 'known field').toEqual([]);
    expect(codes({ ...valid(), terminal: { crimson: '#ff7a70' } }), 'unknown field').toEqual(['invalid_value']);
    expect(codes({ ...valid(), terminal: { red: 'red' } }), 'colour name').toEqual(['invalid_value']);
  });

  it('reports id_conflict for an existing id', () => {
    const found = validateThemeDocument({ ...valid(), id: 'agide-dark' }, { existingIds: new Set(['agide-dark']) }).issues[0];
    expect(found?.code, 'code').toBe('id_conflict');
    expect(found?.hint, 'hint').toContain('theme_apply');
  });

  it('reports license_missing for an imported theme and accepts one with a license', () => {
    const imported = { ...valid(), source: { kind: 'vscode-file' } };
    expect(codes(imported), 'imported without license').toEqual(['license_missing']);
    expect(codes({ ...imported, license: { spdx: 'MIT', copyright: '2021 Example', text: 'MIT text' } }), 'with license').toEqual([]);
    expect(codes({ ...valid(), source: { kind: 'user' } }), 'a user theme needs no license').toEqual([]);
  });

  it('reports include_unsupported for a document with include', () => {
    expect(codes({ ...valid(), include: './base.json' }), 'include key').toEqual(['include_unsupported']);
    expect(includeUnsupported().hint, 'importer hint').toContain('Import the included file');
  });

  it('reports contrast_below_target as a warning with the clamped value', () => {
    const tokens = { ...resolveTheme({ theme: builtinTheme('agide-light')! }).tokens, 'text.tertiary': '#c0c0c8' };
    const warnings = contrastIssues(tokens, false);
    expect(warnings.length, 'at least one pair fails').toBeGreaterThan(0);
    expect(warnings[0]?.severity, 'severity').toBe('warning');
    expect(warnings[0]?.code, 'code').toBe('contrast_below_target');
    expect(warnings[0]?.hint, 'hint names the adjusted value').toMatch(/clamp would use `#[0-9a-f]{6}`/);
  });

  it('checks the shape of system themes and of extends', () => {
    const system = { schema: 1, id: 'my-system', name: 'My System', kind: 'system', light: { extends: 'agide-light' }, dark: { extends: 'agide-dark' } };
    expect(codes(system), 'complete system theme').toEqual([]);
    expect(codes({ ...system, dark: undefined }), 'missing dark side').toEqual(['missing_field']);
    expect(codes({ ...system, tokens: {} }), 'tokens at the top of a system theme').toEqual(['invalid_value']);
    expect(codes({ ...valid(), extends: 'agide-light' }), 'a dark theme extending a light one').toEqual(['invalid_value']);
    expect(codes({ ...valid(), light: {} }), 'a light block outside a system theme').toEqual(['invalid_value']);
  });

  it('lists every error code of 5.3 and produces a JSON Schema', () => {
    const expected: ThemeErrorCode[] = ['invalid_json', 'schema_version_unsupported', 'missing_field', 'unknown_token', 'computed_token', 'invalid_value', 'missing_token', 'unknown_dock_variable', 'id_conflict', 'license_missing', 'include_unsupported', 'contrast_below_target'];
    expect([...THEME_ERROR_CODES], 'codes').toEqual(expected);
    expect(JSON.stringify(themeJsonSchema()), 'schema mentions the kind field').toContain('"kind"');
  });
});
