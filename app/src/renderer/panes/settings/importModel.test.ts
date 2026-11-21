import { describe, expect, it } from 'vitest';
import { ThemeCommandError, toBase64, type ImportResult } from '../../theme/themeCommands';
import { importInput, stepOf, UNKNOWN_LICENSE_CHOICE } from './importModel';

const result = { saved: false, theme: { schema: 1, id: 'x-theme', name: 'X', kind: 'dark' }, adjustments: [], warnings: [] } as unknown as ImportResult;

describe('import steps', () => {
  it('moves on to the review for a result', () => {
    expect(stepOf(result), 'ready with the result').toEqual({ kind: 'ready', result });
  });

  it('asks for a theme when the package holds several, and for a license when the file has none', () => {
    expect(stepOf(new ThemeCommandError('invalid_input', 'several', { labels: ['A', 'B'] })), 'labels').toEqual({ kind: 'choose-theme', labels: ['A', 'B'] });
    expect(stepOf(new ThemeCommandError('invalid_input', 'no license', { issues: [{ code: 'license_missing' }] })), 'license').toEqual({ kind: 'need-license' });
  });

  it('shows the message of any other failure', () => {
    expect(stepOf(new ThemeCommandError('invalid_input', 'The file is not valid JSON.', { issues: [{ code: 'invalid_json' }] })), 'failure').toEqual({ kind: 'failed', message: 'The file is not valid JSON.' });
  });

  it('builds the command input from the choices and leaves out the unset ones', () => {
    expect(importInput('QQ==', 'a.json', { themeLabel: undefined, license: undefined, keepOriginalContrast: false }, true), 'bare dry run').toEqual({ data: 'QQ==', fileName: 'a.json', dryRun: true });
    expect(importInput('QQ==', 'a.vsix', { themeLabel: 'Dark', license: UNKNOWN_LICENSE_CHOICE, keepOriginalContrast: true }, false), 'every choice').toEqual({
      data: 'QQ==',
      fileName: 'a.vsix',
      dryRun: false,
      themeLabel: 'Dark',
      license: UNKNOWN_LICENSE_CHOICE,
      keepOriginalContrast: true,
    });
  });

  it('encodes bytes to base64 in chunks', () => {
    const bytes = new Uint8Array(70_000).fill(65);
    expect(atob(toBase64(bytes)).length, 'all bytes survive a large input').toBe(70_000);
    expect(toBase64(new Uint8Array([104, 105])), 'short input').toBe('aGk=');
  });
});
