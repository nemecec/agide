import type { ThemeDocument } from './schema';

export interface ThemeSummary {
  readonly id: string;
  readonly name: string;
  readonly kind: ThemeDocument['kind'];
  readonly source: NonNullable<ThemeDocument['source']>['kind'];
  readonly license: string | undefined;
  /** License and source in one line, as the picker shows them. */
  readonly detail: string;
  readonly active: boolean;
  /** True when a colour pair of the theme falls under its contrast target. */
  readonly lowContrast: boolean;
}

export const sourceOf = (theme: ThemeDocument): ThemeSummary['source'] => theme.source?.kind ?? 'user';

/** The license and the source of a theme in one line: `MIT · GitHub.github-vscode-theme 6.3.5`. */
export function themeDetail(theme: ThemeDocument): string {
  const parts: string[] = [];
  if (theme.license) parts.push(theme.license.spdx === 'LicenseRef-unknown' ? 'License unknown' : theme.license.spdx);
  const { source } = theme;
  if (source && source.kind !== 'user' && !(source.kind === 'builtin' && source.extension === undefined)) {
    const origin = source.extension ?? source.url ?? source.name;
    if (origin) parts.push(source.version ? `${origin} ${source.version}` : origin);
  } else if (!source || source.kind === 'user') parts.push('Yours');
  else parts.push('Built in');
  return parts.join(' · ');
}

