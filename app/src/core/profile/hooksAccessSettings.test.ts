import { describe, expect, it } from 'vitest';
import { profileSettingsSchema, defaultSettings } from './schemas';

const base = (): Record<string, unknown> => ({ ...defaultSettings({ isDefaultProfile: true, claudeConfigDir: '/x' }) });

describe('profile settings of milestone 6', () => {
  it('accept the hooks, access and inbox sections', () => {
    const parsed = profileSettingsSchema.safeParse({ ...base(), hooks: { bashSandboxLoopback: false, approvalWaitMinutes: 5 }, access: { waitSeconds: 60 }, inbox: { retentionDays: 30 } });
    expect(parsed.success, 'a profile with the new sections').toBe(true);
  });

  it('refuse unknown keys inside the new sections', () => {
    expect(profileSettingsSchema.safeParse({ ...base(), hooks: { loopback: true } }).success, 'hooks').toBe(false);
    expect(profileSettingsSchema.safeParse({ ...base(), access: { wait: 1 } }).success, 'access').toBe(false);
    expect(profileSettingsSchema.safeParse({ ...base(), inbox: { days: 1 } }).success, 'inbox').toBe(false);
  });

  it('read a profile file without the new sections', () => {
    expect(profileSettingsSchema.safeParse(base()).success, 'an older settings file').toBe(true);
  });
});
