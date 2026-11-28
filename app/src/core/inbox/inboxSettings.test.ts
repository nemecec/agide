import { describe, expect, it } from 'vitest';
import { DEFAULT_INBOX_SETTINGS, inboxSettingsSchema, resolveInboxSettings } from './inboxSettings';

describe('inbox settings', () => {
  it('keeps done items 90 days unless the profile says otherwise', () => {
    expect(resolveInboxSettings(undefined), 'default retention').toEqual(DEFAULT_INBOX_SETTINGS);
    expect(DEFAULT_INBOX_SETTINGS.retentionDays, 'ninety days').toBe(90);
    expect(resolveInboxSettings({ retentionDays: 7 }).retentionDays, 'the profile value').toBe(7);
  });

  it('refuses zero days and unknown keys', () => {
    expect(inboxSettingsSchema.safeParse({ retentionDays: 0 }).success, 'zero days').toBe(false);
    expect(inboxSettingsSchema.safeParse({ retentionDays: 1.5 }).success, 'a fraction').toBe(false);
    expect(inboxSettingsSchema.safeParse({ other: true }).success, 'unknown key').toBe(false);
  });
});
