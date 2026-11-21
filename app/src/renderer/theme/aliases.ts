import { ALIAS_ROWS, aliasToken, vscodeKey, type AliasValue } from '../../core/theme/vscode/aliasTable';
import { cssName } from '../../core/theme/tokens';
import type { ResolvedTheme } from '../../core/theme/resolve';
import type { ThemeDocument } from '../../core/theme/schema';

const reference = (key: string): string => `var(${cssName(key)})`;
const withAlpha = (key: string, percent: number): string => `color-mix(in srgb, ${reference(key)} ${percent}%, transparent)`;
const SCROLLBAR_BASE = { light: 25, dark: 30 } as const;
const SCROLLBAR_STEP = 15;

function valueOf(value: AliasValue, resolved: ResolvedTheme): string {
  if ('token' in value) return value.alpha === undefined ? reference(value.token) : withAlpha(value.token, value.alpha);
  if ('literal' in value) return value.literal;
  if ('scheme' in value) return valueOf(value.scheme[resolved.scheme], resolved);
  if ('mix' in value) return `color-mix(in srgb, ${reference(value.mix[0])}, ${reference(value.mix[1])} ${value.mix[2]}%)`;
  if ('scrollbar' in value) return withAlpha('text.primary', SCROLLBAR_BASE[resolved.scheme] + SCROLLBAR_STEP * value.scrollbar);
  if ('shadowColour' in value) return /rgb\([^)]*\)/.exec(resolved.tokens['shadow.2'] ?? '')?.[0] ?? 'transparent';
  return 'transparent';
}

/**
 * The `--vscode-*` variables for the theme (0035 6.3). An imported theme gives each alias the original VS Code value
 * when the file defined the key and the clamp did not move the token behind it; every other alias reads its token.
 */
export function aliasVariables(theme: ThemeDocument, resolved: ResolvedTheme): Record<string, string> {
  const moved = new Set((theme.source?.adjustments ?? []).map((adjustment) => adjustment.token));
  const variables: Record<string, string> = {};
  for (const row of ALIAS_ROWS) {
    const key = vscodeKey(row.name);
    const token = aliasToken(row.value);
    const original = key === undefined ? undefined : theme.vscode?.[key];
    variables[row.name] = original !== undefined && (token === undefined || !moved.has(token)) ? original : valueOf(row.value, resolved);
  }
  return variables;
}
