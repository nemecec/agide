/** The `--vscode-*` variables of 0035 section 6.3, each with the token it falls back to. */

export type AliasValue =
  | { readonly token: string; readonly alpha?: number }
  | { readonly literal: string }
  | { readonly scheme: { readonly light: AliasValue; readonly dark: AliasValue } }
  | { readonly mix: readonly [string, string, number] }
  | { readonly scrollbar: 0 | 1 | 2 }
  | { readonly shadowColour: true }
  | { readonly transparent: true };

export interface AliasRow {
  /** The variable name, `--vscode-` included. */
  readonly name: string;
  readonly value: AliasValue;
}

const PREFIX = '--vscode-';
const rows = (names: readonly string[], value: AliasValue): AliasRow[] => names.map((name) => ({ name: `${PREFIX}${name}`, value }));
const pairs = (names: readonly string[], values: readonly AliasValue[]): AliasRow[] => names.map((name, index) => ({ name: `${PREFIX}${name}`, value: values[index] as AliasValue }));
const token = (key: string, alpha?: number): AliasValue => (alpha === undefined ? { token: key } : { token: key, alpha });

export const ALIAS_ROWS: readonly AliasRow[] = [
  ...pairs(['font-family', 'font-size', 'font-weight'], [token('font.ui'), { literal: '13px' }, { literal: '400' }]),
  ...pairs(['editor-font-family', 'editor-font-size', 'editor-font-weight'], [token('font.mono'), { literal: '12px' }, { literal: '400' }]),
  ...rows(
    [
      'foreground',
      'editor-foreground',
      'icon-foreground',
      'menu-foreground',
      'sideBarTitle-foreground',
      'panelTitle-activeForeground',
      'settings-textInputForeground',
      'settings-dropdownForeground',
      'checkbox-foreground',
      'settings-checkboxForeground',
      'list-hoverForeground',
      'inputOption-activeForeground',
      'editor-inlineValuesForeground',
    ],
    token('text.primary'),
  ),
  ...rows(['panelTitle-inactiveForeground'], token('text.secondary')),
  ...rows(['input-placeholderForeground'], token('text.tertiary')),
  ...rows(['editor-background', 'panel-background', 'panel--background', 'keybindingTable-rowsBackground'], token('surface.content')),
  ...rows(['sideBar-background', 'sideBarSectionHeader-background', 'keybindingTable-headerBackground'], token('surface.sidebar')),
  ...rows(['menu-background'], token('surface.overlay')),
  ...rows(
    ['settings-textInputBackground', 'settings-dropdownBackground', 'settings-checkboxBackground', 'checkbox-background'],
    { scheme: { light: token('surface.content'), dark: token('surface.inset') } },
  ),
  ...rows(['settings-textInputBorder', 'settings-dropdownBorder', 'settings-checkboxBorder', 'checkbox-border', 'settings-dropdownListBorder'], token('border.strong')),
  ...rows(['editorGroup-border', 'editorWidget-border', 'menu-border', 'settings-headerBorder', 'contrastBorder'], token('border.default')),
  ...rows(['menu-separatorBackground', 'tree-indentGuidesStroke'], token('border.subtle')),
  ...rows(['tree-inactiveIndentGuidesStroke'], token('border.subtle', 50)),
  ...rows(['focusBorder', 'list-focusOutline', 'list-focusAndSelectionOutline', 'toolbar-hoverOutline', 'menu-selectionBorder', 'inputOption-activeBorder'], token('focus.ring')),
  ...rows(['button-background', 'progressBar-background', 'menu-selectionBackground'], token('accent')),
  ...rows(['panelTitle-activeBorder', 'sash-hoverBorder'], token('accent.text')),
  ...rows(['button-foreground', 'menu-selectionForeground'], token('accent.on')),
  ...rows(['button-hoverBackground'], token('accent.hover')),
  ...pairs(['button-border', 'button-separator'], [{ transparent: true }, token('accent.on', 40)]),
  ...pairs(
    ['button-secondaryBackground', 'button-secondaryForeground', 'button-secondaryHoverBackground'],
    [token('surface.raised'), token('text.primary'), { mix: ['surface.raised', 'text.primary', 4] }],
  ),
  ...pairs(['badge-background', 'badge-foreground', 'activityBarBadge-background', 'activityBarBadge-foreground'], [token('accent'), token('accent.on'), token('accent'), token('accent.on')]),
  ...pairs(
    ['list-activeSelectionBackground', 'list-activeSelectionForeground', 'list-activeSelectionIconForeground'],
    [token('selection'), token('text.primary'), token('text.primary')],
  ),
  ...rows(['list-inactiveSelectionBackground'], token('selection.inactive')),
  ...rows(['list-hoverBackground', 'toolbar-hoverBackground'], token('surface.hover')),
  ...pairs(['toolbar-activeBackground', 'inputOption-activeBackground'], [token('surface.pressed'), token('accent.subtle')]),
  ...rows(['list-highlightForeground', 'list-focusHighlightForeground'], token('accent.text')),
  ...pairs(['inputValidation-errorBorder', 'inputValidation-errorBackground'], [token('danger.fg'), token('danger.bg')]),
  ...pairs(
    ['scrollbarSlider-background', 'scrollbarSlider-hoverBackground', 'scrollbarSlider-activeBackground', 'scrollbar-shadow'],
    [{ scrollbar: 0 }, { scrollbar: 1 }, { scrollbar: 2 }, { transparent: true }],
  ),
  ...rows(['widget-shadow'], { shadowColour: true }),
];

/** The VS Code colour key behind a variable name, or undefined for the font variables. */
export function vscodeKey(name: string): string | undefined {
  const bare = name.slice(PREFIX.length);
  if (bare.startsWith('font-') || bare.startsWith('editor-font-')) return undefined;
  if (bare === 'panel--background') return 'panel.background';
  return bare.replaceAll('-', '.');
}

/** The colour keys of the alias set; the importer keeps their original values with the theme. */
export const ALIAS_KEYS: readonly string[] = [...new Set(ALIAS_ROWS.flatMap((row) => vscodeKey(row.name) ?? []))];

/** The token an alias falls back to when the theme has no original value (the first token of a mixed or scheme-dependent value). */
export function aliasToken(value: AliasValue): string | undefined {
  if ('token' in value) return value.token;
  if ('scheme' in value) return aliasToken(value.scheme.light);
  return undefined;
}
