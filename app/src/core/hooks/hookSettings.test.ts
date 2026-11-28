import { describe, expect, it } from 'vitest';
import { approvalEntryTimeoutSeconds, DEFAULT_HOOK_SETTINGS, hookSettingsSchema, resolveHookSettings } from './hookSettings';
import { HTTP_HOOK_EVENTS } from './types';
import { HOOK_EVENTS } from '../session/hooks';

describe('hook settings', () => {
  it('reads absent keys as the defaults of milestone 6: http, 15 minutes, loopback on', () => {
    expect(resolveHookSettings(undefined), 'no settings').toEqual(DEFAULT_HOOK_SETTINGS);
    expect(DEFAULT_HOOK_SETTINGS, 'the defaults').toEqual({ transport: 'http', approvalWaitMinutes: 15, bashSandboxLoopback: true });
  });

  it('keeps the keys a profile sets and fills the rest', () => {
    expect(resolveHookSettings({ bashSandboxLoopback: false }), 'loopback off keeps the other defaults').toEqual({ ...DEFAULT_HOOK_SETTINGS, bashSandboxLoopback: false });
    expect(resolveHookSettings({ transport: 'inbox-dir', approvalWaitMinutes: 5 }), 'transport and wait').toMatchObject({ transport: 'inbox-dir', approvalWaitMinutes: 5 });
  });

  it('refuses unknown keys and values out of range', () => {
    expect(hookSettingsSchema.safeParse({ transport: 'carrier-pigeon' }).success, 'unknown transport').toBe(false);
    expect(hookSettingsSchema.safeParse({ approvalWaitMinutes: 0 }).success, 'no wait').toBe(false);
    expect(hookSettingsSchema.safeParse({ approvalWaitMinutes: 241 }).success, 'above four hours').toBe(false);
    expect(hookSettingsSchema.safeParse({ extra: true }).success, 'unknown key').toBe(false);
    expect(hookSettingsSchema.safeParse({ transport: 'http', approvalWaitMinutes: 15, bashSandboxLoopback: true }).success, 'a full valid object').toBe(true);
  });

  it('sets the entry timeout of a held permission request 60 seconds above the wait', () => {
    expect(approvalEntryTimeoutSeconds({ approvalWaitMinutes: 15 }), 'the default wait of 15 minutes').toBe(960);
    expect(approvalEntryTimeoutSeconds({ approvalWaitMinutes: 1 }), 'one minute').toBe(120);
  });

  it('sends every hook event over http except SessionStart and SessionEnd', () => {
    expect(HTTP_HOOK_EVENTS, 'the http events').toEqual(HOOK_EVENTS.filter((event) => event !== 'SessionStart' && event !== 'SessionEnd'));
    expect(HTTP_HOOK_EVENTS, 'SessionStart stays a command hook').not.toContain('SessionStart');
    expect(HTTP_HOOK_EVENTS, 'SessionEnd stays a command hook').not.toContain('SessionEnd');
  });
});
