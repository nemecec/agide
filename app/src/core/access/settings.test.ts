import { describe, expect, it } from 'vitest';
import { accessSettingsSchema, DEFAULT_ACCESS_SETTINGS, resolveAccessSettings } from './settings';

describe('access settings', () => {
  it('reads absent keys as a wait of 115 seconds and a request life of 24 hours', () => {
    expect(resolveAccessSettings(undefined), 'no settings').toEqual({ waitSeconds: 115, requestHours: 24 });
    expect(resolveAccessSettings({ waitSeconds: 0 }), 'a zero wait is kept').toEqual({ ...DEFAULT_ACCESS_SETTINGS, waitSeconds: 0 });
    expect(resolveAccessSettings({ requestHours: 2 }), 'request hours').toEqual({ ...DEFAULT_ACCESS_SETTINGS, requestHours: 2 });
  });

  it('refuses a wait above 600 seconds, no request life and unknown keys', () => {
    expect(accessSettingsSchema.safeParse({ waitSeconds: 601 }).success, 'above the longest wait').toBe(false);
    expect(accessSettingsSchema.safeParse({ requestHours: 0 }).success, 'no life').toBe(false);
    expect(accessSettingsSchema.safeParse({ other: 1 }).success, 'unknown key').toBe(false);
    expect(accessSettingsSchema.safeParse({ waitSeconds: 600, requestHours: 168 }).success, 'the limits themselves').toBe(true);
  });
});
