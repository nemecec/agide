import { describe, expect, it } from 'vitest';
import { ACCENT_NOTIFICATION, createAppearance, type NativeThemeLike, type SystemPreferencesLike } from './appearance';
import type { AppearanceState } from '../core/theme/appearance';

function fakes(initial: Partial<{ dark: boolean; accent: string; highContrast: boolean }> = {}) {
  const listeners = new Set<() => void>();
  const notifications = new Map<string, () => void>();
  const unsubscribed: number[] = [];
  const nativeTheme = {
    themeSource: 'dark' as NativeThemeLike['themeSource'],
    shouldUseDarkColors: initial.dark ?? false,
    shouldUseHighContrastColors: initial.highContrast ?? false,
    prefersReducedTransparency: false,
    shouldDifferentiateWithoutColor: false,
    on: (_event: 'updated', listener: () => void) => void listeners.add(listener),
    removeListener: (_event: 'updated', listener: () => void) => void listeners.delete(listener),
  };
  let accent = initial.accent ?? '007AFFFF';
  const systemPreferences: SystemPreferencesLike = {
    getAccentColor: () => {
      if (accent === 'throw') throw new Error('no accent');
      return accent;
    },
    subscribeNotification: (event, callback) => {
      notifications.set(event, callback);
      return 7;
    },
    unsubscribeNotification: (id) => void unsubscribed.push(id),
  };
  return {
    nativeTheme,
    systemPreferences,
    listeners,
    notifications,
    unsubscribed,
    setAccent: (value: string) => void (accent = value),
    fireUpdated: () => listeners.forEach((listener) => listener()),
  };
}

describe('createAppearance', () => {
  it('sets the theme source to system and reads the OS state', () => {
    const f = fakes({ dark: true, accent: '953D96FF' });
    const adapter = createAppearance({ ...f, platform: 'darwin', onChange: () => undefined });
    expect(f.nativeTheme.themeSource, 'theme source').toBe('system');
    expect(adapter.current(), 'state read from the OS').toEqual({ dark: true, accent: '#953d96', highContrast: false, reducedTransparency: false, differentiateWithoutColour: false });
  });

  it('sends one message per change of light or dark and none for an update that changes nothing', () => {
    const f = fakes();
    const seen: AppearanceState[] = [];
    createAppearance({ ...f, platform: 'darwin', onChange: (state) => seen.push(state) });
    f.fireUpdated();
    expect(seen, 'an update without a change sends nothing').toEqual([]);
    f.nativeTheme.shouldUseDarkColors = true;
    f.fireUpdated();
    f.fireUpdated();
    expect(seen.map((state) => state.dark), 'one message for the change to dark').toEqual([true]);
  });

  it('re-reads the accent on the macOS notification', () => {
    const f = fakes();
    const seen: AppearanceState[] = [];
    createAppearance({ ...f, platform: 'darwin', onChange: (state) => seen.push(state) });
    f.setAccent('F74F9EFF');
    f.notifications.get(ACCENT_NOTIFICATION)?.();
    expect(seen.map((state) => state.accent), 'new accent reported once').toEqual(['#f74f9e']);
  });

  it('does not subscribe to the accent notification outside macOS', () => {
    const f = fakes();
    createAppearance({ ...f, platform: 'linux', onChange: () => undefined });
    expect(f.notifications.size, 'subscriptions').toBe(0);
  });

  it('reports a null accent when the OS call fails or no preferences exist', () => {
    const failing = fakes({ accent: 'throw' });
    expect(createAppearance({ ...failing, platform: 'darwin', onChange: () => undefined }).current().accent, 'getAccentColor throws').toBeNull();
    expect(createAppearance({ nativeTheme: fakes().nativeTheme, onChange: () => undefined }).current().accent, 'no systemPreferences').toBeNull();
  });

  it('lets a test override fields of the state and clear them again', () => {
    const f = fakes();
    const seen: AppearanceState[] = [];
    const adapter = createAppearance({ ...f, platform: 'darwin', onChange: (state) => seen.push(state) });
    adapter.override({ highContrast: true, accent: '#ff0000' });
    expect(adapter.current(), 'override applied').toMatchObject({ highContrast: true, accent: '#ff0000' });
    adapter.override(undefined);
    expect(adapter.current().highContrast, 'override cleared').toBe(false);
    expect(seen.length, 'one message for each change').toBe(2);
  });

  it('stops listening on dispose', () => {
    const f = fakes();
    createAppearance({ ...f, platform: 'darwin', onChange: () => undefined }).dispose();
    expect(f.listeners.size, 'updated listener removed').toBe(0);
    expect(f.unsubscribed, 'notification subscription removed').toEqual([7]);
  });
});
