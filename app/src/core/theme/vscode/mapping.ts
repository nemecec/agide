import { builtinTheme } from '../builtin/index';
import { ratio, mix } from '../colour';
import { contrastWarnings, type TokenValues } from '../contrast';
import type { ThemeIssue } from '../schema';
import { includeUnsupported } from '../schema';
import { ALIAS_KEYS } from './aliasTable';
import { ContrastClamp, type Adjustment } from './clamp';
import { ColourMap } from './colours';
import { detectKind, type DetectedKind } from './kind';
import type { UiTheme } from './vsix';

const BLACK = '#000000';
const WHITE = '#ffffff';
const DARK_TEXT = '#1d1d1f';
const ANSI = ['Black', 'Red', 'Green', 'Yellow', 'Blue', 'Magenta', 'Cyan', 'White'] as const;
const STATUS_FOREGROUND_KEYS = {
  danger: ['errorForeground', 'editorError.foreground', 'notificationsErrorIcon.foreground'],
  warning: ['editorWarning.foreground', 'notificationsWarningIcon.foreground', 'charts.yellow'],
  info: ['editorInfo.foreground', 'notificationsInfoIcon.foreground', 'textLink.foreground'],
  success: ['testing.iconPassed', 'gitDecoration.addedResourceForeground', 'charts.green'],
} as const;

export interface VsCodeThemeInput {
  /** The parsed theme file. Only `colors`, `type` and `include` are read. */
  readonly file: unknown;
  /** From `contributes.themes` of the extension, when the theme came from a package. */
  readonly uiTheme?: UiTheme | undefined;
}

export interface MappedTheme {
  readonly kind: DetectedKind['kind'];
  readonly highContrast: boolean;
  /** The tokens after the clamp. */
  readonly tokens: Record<string, string>;
  /** The tokens before the clamp, for a user who keeps the original colours. */
  readonly original: Record<string, string>;
  readonly adjustments: readonly Adjustment[];
  /** The original value of every `--vscode-*` alias key the theme defines. */
  readonly vscode: Record<string, string>;
  /** Warnings the clamped tokens still carry. */
  readonly warnings: readonly ThemeIssue[];
}

export type MapResult = { readonly ok: true; readonly theme: MappedTheme } | { readonly ok: false; readonly issues: readonly ThemeIssue[] };

const missing = (key: string): ThemeIssue => ({
  code: 'missing_token',
  severity: 'error',
  path: `/colors/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`,
  message: `\`/colors/${key}\` is required for an import.`,
  hint: `Choose a theme that defines \`${key}\`.`,
});

/** The token values of the built-in theme of one kind, with the terminal colours. */
function agideTokens(kind: 'light' | 'dark'): TokenValues {
  const theme = builtinTheme(`agide-${kind}`);
  if (!theme?.tokens) throw new Error(`built-in theme agide-${kind} is missing`);
  return theme.tokens;
}

function blackOrWhiteFor(background: string): string {
  return ratio(WHITE, background) >= ratio(DARK_TEXT, background) ? WHITE : DARK_TEXT;
}

/** The `rgb(0 0 0 / N%)` parts of a built-in shadow take the colour of `widget.shadow`. */
function shadowWith(shadow: string, colour: string): string {
  const [red, green, blue] = [1, 3, 5].map((at) => Number.parseInt(colour.slice(at, at + 2), 16));
  return shadow.replaceAll(/rgb\(0 0 0 \/ (\d+%)\)/g, `rgb(${red} ${green} ${blue} / $1)`);
}

/**
 * Maps the colours of a VS Code theme to Agide tokens by the fallback orders of 0035 6.1, then runs the contrast
 * clamp of 6.2. The importer reads only `colors`; `tokenColors` and the semantic keys stay unread.
 */
export function mapVsCodeTheme(input: VsCodeThemeInput): MapResult {
  const file = typeof input.file === 'object' && input.file !== null ? (input.file as Record<string, unknown>) : {};
  if ('include' in file) return { ok: false, issues: [includeUnsupported()] };
  const colours = new ColourMap(typeof file['colors'] === 'object' && file['colors'] !== null ? (file['colors'] as Record<string, unknown>) : {});

  const editor = colours.first(['editor.background']);
  if (!editor) return { ok: false, issues: [missing('editor.background')] };
  const content = editor.value;
  const text = colours.first(['foreground', 'editor.foreground'], content);
  if (!text) return { ok: false, issues: [missing('foreground')] };
  const primary = text.value;

  const { kind, highContrast } = detectKind({ type: file['type'], uiTheme: input.uiTheme, editorBackground: content });
  const dark = kind === 'dark';
  const agide = agideTokens(kind);
  const fallback = (key: string): string => agide[key] ?? '';
  const t: Record<string, string> = {};
  const derived = new Set<string>();
  const pick = (token: string, keys: readonly string[], surface: string | undefined, otherwise: () => string, markDerived = true): string => {
    const hit = colours.first(keys, surface);
    if (hit) return (t[token] = hit.value);
    if (markDerived) derived.add(token);
    return (t[token] = otherwise());
  };

  t['surface.content'] = content;
  t['text.primary'] = primary;
  const window = pick('surface.window', ['titleBar.activeBackground', 'activityBar.background', 'editorGroupHeader.tabsBackground'], content, () => mix(content, BLACK, dark ? 0.15 : 0.04));
  const sidebar = pick('surface.sidebar', ['sideBar.background'], content, () => content);
  const raised = pick('surface.raised', ['editorWidget.background', 'dropdown.background'], content, () => mix(content, primary, 0.04));
  pick('surface.overlay', ['menu.background', 'editorWidget.background'], content, () => raised);
  const inset = pick('surface.inset', ['input.background'], content, () => mix(content, BLACK, 0.06));

  const secondaryHit = colours.first(['descriptionForeground', 'tab.inactiveForeground'], content);
  t['text.secondary'] = secondaryHit && secondaryHit.value !== primary ? secondaryHit.value : mix(primary, content, 0.3);
  pick('text.tertiary', ['input.placeholderForeground'], inset, () => mix(primary, content, 0.45));

  const accent = pick('accent', ['button.background', 'activityBarBadge.background', 'focusBorder'], content, () => fallback('accent'));
  pick('accent.on', ['button.foreground', 'activityBarBadge.foreground'], accent, () => blackOrWhiteFor(accent));
  pick('accent.hover', ['button.hoverBackground'], content, () => mix(accent, BLACK, 0.08));
  t['accent.active'] = mix(accent, BLACK, 0.16);
  derived.add('accent.active');
  const accentText = pick('accent.text', ['textLink.foreground', 'focusBorder'], content, () => accent, false);
  pick('text.link', ['textLink.foreground', 'focusBorder'], content, () => accentText, false);
  pick('focus.ring', ['focusBorder'], content, () => accentText, false);
  t['accent.subtle'] = mix(content, accentText, dark ? 0.2 : 0.14);
  derived.add('accent.subtle');

  pick('border.default', ['panel.border', 'sideBar.border', 'contrastBorder'], content, () => mix(content, primary, 0.16), false);
  t['border.subtle'] = mix(content, primary, 0.08);
  const inputBorder = colours.first(['input.border'], content);
  t['border.strong'] = inputBorder && ratio(inputBorder.value, content) >= 3 ? inputBorder.value : mix(content, primary, 0.45);

  pick('selection', ['list.activeSelectionBackground'], sidebar, () => mix(sidebar, accent, 0.25), false);
  pick('selection.inactive', ['list.inactiveSelectionBackground'], sidebar, () => mix(sidebar, primary, 0.1), false);

  for (const [status, keys] of Object.entries(STATUS_FOREGROUND_KEYS)) {
    const fg = pick(`${status}.fg`, keys, content, () => fallback(`${status}.fg`), false);
    t[`${status}.bg`] = mix(content, fg, 0.16);
  }
  t['danger.fill'] = t['danger.fg'] ?? '';
  derived.add('danger.fill');

  const tooltip = pick('tooltip.bg', ['editorHoverWidget.background'], content, () => primary, false);
  t['text.inverse'] = ratio(content, tooltip) >= ratio(primary, tooltip) ? content : primary;

  mapTerminal(t, colours, content, primary, fallback);
  const shadowHit = colours.first(['widget.shadow'], content);
  if (shadowHit) for (const level of [1, 2, 3]) t[`shadow.${level}`] = shadowWith(fallback(`shadow.${level}`), shadowHit.value);

  const original = { ...t };
  const full: Record<string, string> = { ...agide, ...t };
  const clamp = new ContrastClamp(full, dark, derived);
  clamp.run();
  const tokens = Object.fromEntries(Object.keys(t).map((key) => [key, full[key] ?? t[key] ?? '']));
  const vscode: Record<string, string> = {};
  for (const key of ALIAS_KEYS) {
    const value = colours.original(key);
    if (value !== undefined) vscode[key] = value;
  }
  const warnings = contrastWarnings(full, dark).map(
    (warning): ThemeIssue => ({
      code: 'contrast_below_target',
      severity: 'warning',
      path: `/tokens/${warning.foreground}`,
      message: `\`${warning.foreground}\` on \`${warning.background}\` is ${warning.ratio.toFixed(2)} to 1; target ${warning.target}.`,
      hint: warning.adjusted ? `The clamp would use \`${warning.adjusted}\`.` : 'No lighter or darker value reaches the target.',
    }),
  );
  return { ok: true, theme: { kind, highContrast, tokens, original, adjustments: clamp.adjustments, vscode, warnings } };
}

/** The terminal tokens: `terminal.background` falls back through the panel and the editor; a missing ANSI colour takes the Agide value. */
function mapTerminal(t: Record<string, string>, colours: ColourMap, content: string, primary: string, fallback: (key: string) => string): void {
  const background = colours.first(['terminal.background', 'panel.background', 'editor.background'], content)?.value ?? content;
  const foreground = colours.first(['terminal.foreground', 'foreground'], background)?.value ?? primary;
  t['terminal.background'] = background;
  t['terminal.foreground'] = foreground;
  t['terminal.cursor'] = colours.first(['terminalCursor.foreground'], background)?.value ?? foreground;
  t['terminal.cursorAccent'] = background;
  t['terminal.selection'] = colours.first(['terminal.selectionBackground', 'selection.background'], background)?.value ?? mix(background, foreground, 0.2);
  t['terminal.selectionInactive'] = colours.first(['terminal.inactiveSelectionBackground'], background)?.value ?? mix(background, foreground, 0.12);
  for (const name of ANSI) {
    const key = name.charAt(0).toLowerCase() + name.slice(1);
    t[`terminal.${key}`] = colours.first([`terminal.ansi${name}`], background)?.value ?? fallback(`terminal.${key}`);
    t[`terminal.bright${name}`] = colours.first([`terminal.ansiBright${name}`], background)?.value ?? fallback(`terminal.bright${name}`);
  }
}
