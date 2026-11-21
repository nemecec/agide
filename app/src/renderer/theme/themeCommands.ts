import type { ThemeIssue } from '../../core/theme/schema';
import type { ThemeSummary } from '../../core/theme/summary';
import type { ThemeDocument } from '../../core/theme/schema';
import { api } from '../api';

/** A theme command that answered with an error. `details` carries the issues of an import and the labels of a package. */
export class ThemeCommandError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }

  /** The labels of a package that holds several themes. */
  get labels(): readonly string[] {
    const found = (this.details as { labels?: unknown } | undefined)?.labels;
    return Array.isArray(found) ? found.filter((label): label is string => typeof label === 'string') : [];
  }

  get issues(): readonly ThemeIssue[] {
    const found = (this.details as { issues?: unknown } | undefined)?.issues;
    return Array.isArray(found) ? (found as ThemeIssue[]) : [];
  }
}

export async function themeCommand<O>(id: string, input: unknown = {}): Promise<O> {
  const result = await api().invoke<O>(id, input);
  if (!result.ok) throw new ThemeCommandError(result.error.code, result.error.message, result.error.details);
  return result.value;
}

export interface ThemeListResult {
  readonly themes: readonly ThemeSummary[];
  readonly revision: number;
}

export interface ImportResult {
  readonly saved: boolean;
  readonly theme: ThemeDocument;
  readonly adjustments: readonly { token: string; from: string; to: string; reason: string }[];
  readonly warnings: readonly ThemeIssue[];
}

export interface ImportInput {
  readonly data: string;
  readonly fileName: string;
  readonly themeLabel?: string;
  readonly license?: { readonly spdx: string; readonly copyright: string; readonly text: string };
  readonly keepOriginalContrast?: boolean;
  readonly dryRun?: boolean;
}

export const listThemes = (): Promise<ThemeListResult> => themeCommand<ThemeListResult>('theme_list');
export const previewTheme = (id: string): Promise<{ previewId: string }> => themeCommand('theme_preview', { id });
export const revertPreview = (previewId: string): Promise<{ reverted: boolean }> => themeCommand('theme_revert_preview', { previewId });
export const keepPreview = (previewId: string, expectedRevision: number): Promise<unknown> => themeCommand('theme_apply', { previewId, expectedRevision });
export const applyTheme = (id: string, expectedRevision: number): Promise<unknown> => themeCommand('theme_apply', { id, expectedRevision });
export const undoThemeChange = (): Promise<unknown> => themeCommand('theme_undo');
export const importTheme = (input: ImportInput): Promise<ImportResult> => themeCommand<ImportResult>('theme_import', input);

/** Base64 of a file's bytes, built in chunks so a large package does not overflow the call stack. */
export function toBase64(bytes: Uint8Array): string {
  let text = '';
  const chunk = 0x8000;
  for (let at = 0; at < bytes.length; at += chunk) text += String.fromCharCode(...bytes.subarray(at, at + chunk));
  return btoa(text);
}
