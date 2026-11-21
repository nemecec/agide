import type { DockviewTheme } from 'dockview-react';

const make = (colorScheme: 'light' | 'dark'): DockviewTheme => ({ name: 'agide', className: 'agide-dock', colorScheme, gap: 0 });

const THEMES = { light: make('light'), dark: make('dark') } as const;

/** The dockview theme of the app; its colours come from the `agide-dock` class and the tokens, so only the scheme differs. */
export const dockTheme = (scheme: 'light' | 'dark'): DockviewTheme => THEMES[scheme];
