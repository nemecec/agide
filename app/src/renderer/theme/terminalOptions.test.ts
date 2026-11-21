// @vitest-environment jsdom
import type { Terminal } from '@xterm/xterm';
import { afterEach, describe, expect, it } from 'vitest';
import { createThemeStore, type ThemeStore } from './themeStore';
import { installThemeStore, themeSnapshot } from './themeContext';
import { currentTerminalOptions, followTheme, terminalThemeOptions } from './terminalOptions';

let store: ThemeStore | undefined;
afterEach(() => {
  installThemeStore(undefined);
  store?.dispose();
  store = undefined;
});

const state = (dark: boolean) => ({ themeId: 'system', state: { dark, accent: null, highContrast: false, reducedTransparency: false, differentiateWithoutColour: false } });

describe('terminal options from the theme', () => {
  it('lifts low contrast text, uses the mono font and a block cursor', () => {
    const options = terminalThemeOptions(themeSnapshot(), true);
    expect(options.minimumContrastRatio, 'minimum contrast ratio').toBe(4.5);
    expect(options.lineHeight, 'line height').toBe(1.2);
    expect(options.cursorStyle, 'cursor style').toBe('block');
    expect(options.fontFamily, 'mono font stack').toContain('Menlo');
    expect(options.cursorBlink, 'blinks').toBe(true);
    expect(currentTerminalOptions(false).cursorBlink, 'peek does not blink').toBe(false);
  });

  it('follows a theme change and stops after the unsubscribe', async () => {
    let listener: ((m: ReturnType<typeof state>) => void) | undefined;
    store = await createThemeStore({ api: { get: async () => state(false), subscribe: (l) => ((listener = l), () => undefined) }, document });
    installThemeStore(store);
    const term = { options: { theme: {}, cursorBlink: false, fontFamily: '' } } as unknown as Terminal;
    const stop = followTheme(term, true);
    listener?.(state(true));
    expect(term.options.theme?.background, 'terminal background in a dark window').toBe('#1b1b1e');
    expect(term.options.cursorBlink, 'blink follows the argument').toBe(true);
    stop();
    listener?.(state(false));
    expect(term.options.theme?.background, 'no change after unsubscribe').toBe('#1b1b1e');
  });
});
