import type { ITerminalOptions, ITheme, Terminal } from '@xterm/xterm';
import { subscribeTheme, themeSnapshot } from './themeContext';
import type { ThemeSnapshot } from './themeStore';

/** Section 3.7 of 0035: the xterm options that come from the theme. `minimumContrastRatio` lifts any foreground below 4.5 to 1 when drawn. */
export function terminalThemeOptions(snapshot: ThemeSnapshot, blink: boolean): ITerminalOptions {
  return {
    fontFamily: snapshot.resolved.tokens['font.mono'] ?? 'Menlo, monospace',
    lineHeight: 1.2,
    minimumContrastRatio: 4.5,
    cursorStyle: 'block',
    cursorBlink: blink && !snapshot.reducedMotion,
    theme: snapshot.resolved.terminal as ITheme,
  };
}

/** Options for a new terminal, from the current theme. */
export const currentTerminalOptions = (blink: boolean): ITerminalOptions => terminalThemeOptions(themeSnapshot(), blink);

/** Keeps a terminal's theme, font and blink in step with the theme store. Returns the unsubscribe function. */
export function followTheme(term: Terminal, blink: boolean): () => void {
  return subscribeTheme(() => {
    const options = terminalThemeOptions(themeSnapshot(), blink);
    term.options.theme = options.theme as ITheme;
    term.options.cursorBlink = options.cursorBlink ?? false;
    term.options.fontFamily = options.fontFamily as string;
  });
}
