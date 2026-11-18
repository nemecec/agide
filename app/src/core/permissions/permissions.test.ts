import { describe, expect, it } from 'vitest';
import type { ProviderCapabilities } from '../isolation/types';
import { defaultPermissionSettings, permissionSettingsOf } from './defaults';
import { describeHookInspectorContract } from './hookInspectorContract';
import { isLooser, modeLabel, qualifiesForBypass } from './modes';
import { describePolicyBuilderContract } from './policyBuilderContract';
import { permissionSettingsSchema } from './schemas';
import { ACTION_CLASSES } from './classTable';
import { ToolCallInspector } from './inspector';
import { DefaultPolicyBuilder } from './policyBuilder';

describeHookInspectorContract('ToolCallInspector', () => ({ inspector: new ToolCallInspector(), table: ACTION_CLASSES }));
describePolicyBuilderContract('DefaultPolicyBuilder', () => ({ builder: new DefaultPolicyBuilder(), table: ACTION_CLASSES }));

const capabilities = (filesystem: ProviderCapabilities['filesystem'], network: ProviderCapabilities['network']): ProviderCapabilities => ({
  filesystem,
  network,
  login: 'host-keychain',
  hookTransports: ['inbox-dir'],
  transcripts: 'host-files',
});

describe('permission modes', () => {
  it('order modes from plan to bypass', () => {
    expect(isLooser('auto', 'default'), 'auto is looser than asking').toBe(true);
    expect(isLooser('plan', 'acceptEdits'), 'plan is stricter').toBe(false);
    expect(isLooser('bypassPermissions', 'auto'), 'bypass is loosest').toBe(true);
    expect(isLooser('auto', 'auto'), 'a mode is not looser than itself').toBe(false);
  });

  it('offer bypass only for an enforced filesystem and a process-wide allowlist', () => {
    expect(qualifiesForBypass(capabilities('enforced', 'allowlist')), 'srt-like provider').toBe(true);
    expect(qualifiesForBypass(capabilities('host-user', 'bash-allowlist')), 'local with the Bash sandbox').toBe(false);
    expect(qualifiesForBypass(capabilities('enforced', 'none')), 'container without egress policy').toBe(false);
  });

  it('show the prompting mode as Ask every time under both of its names', () => {
    expect(modeLabel('default'), 'app name').toBe('Ask every time');
    expect(modeLabel('manual'), 'CLI name').toBe('Ask every time');
  });
});

describe('permission settings', () => {
  it('read a profile without the key as auto, with the Bash sandbox off only for the default profile', () => {
    expect(permissionSettingsOf({}, { isDefaultProfile: true }), 'default profile').toMatchObject({ defaultMode: 'auto', network: { bashSandbox: false } });
    expect(permissionSettingsOf({}, { isDefaultProfile: false }).network.bashSandbox, 'new profile').toBe(true);
    const stored = { ...defaultPermissionSettings({ isDefaultProfile: true }), defaultMode: 'plan' as const };
    expect(permissionSettingsOf({ permissions: stored }, { isDefaultProfile: true }), 'stored settings win').toBe(stored);
  });

  it('accept the defaults and refuse bypass as a default, unknown classes and hosts with paths', () => {
    expect(permissionSettingsSchema.safeParse(defaultPermissionSettings({ isDefaultProfile: false })).success, 'defaults').toBe(true);
    const base = defaultPermissionSettings({ isDefaultProfile: false });
    expect(permissionSettingsSchema.safeParse({ ...base, defaultMode: 'bypassPermissions' }).success, 'bypass default').toBe(false);
    expect(permissionSettingsSchema.safeParse({ ...base, outward: { 'made.up': 'allow' } }).success, 'unknown class').toBe(false);
    expect(permissionSettingsSchema.safeParse({ ...base, network: { ...base.network, allow: ['github.com/path'] } }).success, 'host with a path').toBe(false);
  });
});
