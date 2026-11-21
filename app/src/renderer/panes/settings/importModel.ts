import type { ImportInput, ImportResult } from '../../theme/themeCommands';
import { ThemeCommandError } from '../../theme/themeCommands';

/** What the import dialog has to ask the user next, from the answer of a dry run. */
export type ImportStep =
  | { readonly kind: 'ready'; readonly result: ImportResult }
  | { readonly kind: 'choose-theme'; readonly labels: readonly string[] }
  | { readonly kind: 'need-license' }
  | { readonly kind: 'failed'; readonly message: string };

export function stepOf(outcome: ImportResult | ThemeCommandError): ImportStep {
  if (!(outcome instanceof ThemeCommandError)) return { kind: 'ready', result: outcome };
  if (outcome.labels.length > 0) return { kind: 'choose-theme', labels: outcome.labels };
  if (outcome.issues.some((issue) => issue.code === 'license_missing')) return { kind: 'need-license' };
  return { kind: 'failed', message: outcome.message };
}

export interface ImportChoices {
  readonly themeLabel: string | undefined;
  readonly license: ImportInput['license'] | undefined;
  readonly keepOriginalContrast: boolean;
}

/** The unknown license the user may accept for a bare file that comes without one. */
export const UNKNOWN_LICENSE_CHOICE: NonNullable<ImportInput['license']> = {
  spdx: 'LicenseRef-unknown',
  copyright: 'Copyright holder not stated',
  text: 'The license of this theme is not known. It was imported for personal use.',
};

export const importInput = (data: string, fileName: string, choices: ImportChoices, dryRun: boolean): ImportInput => ({
  data,
  fileName,
  dryRun,
  ...(choices.themeLabel === undefined ? {} : { themeLabel: choices.themeLabel }),
  ...(choices.license === undefined ? {} : { license: choices.license }),
  ...(choices.keepOriginalContrast ? { keepOriginalContrast: true } : {}),
});
