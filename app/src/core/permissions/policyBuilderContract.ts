import { describe, expect, it } from 'vitest';
import type { ProviderCapabilities } from '../isolation/types';
import { defaultPermissionSettings } from './defaults';
import type { ActionClassTable, PermissionSettings, PolicyBuilder } from './types';

export interface PolicyBuilderUnderTest {
  readonly builder: PolicyBuilder;
  readonly table: ActionClassTable;
}

const LOCAL: ProviderCapabilities = { filesystem: 'host-user', network: 'none', login: 'host-keychain', hookTransports: ['inbox-dir'], transcripts: 'host-files' };

/** Behaviour every `PolicyBuilder` shows (0028 sections 2 and 5). */
export function describePolicyBuilderContract(name: string, create: () => PolicyBuilderUnderTest, options: { readonly pending?: string } = {}): void {
  const suite = options.pending === undefined ? describe : describe.skip;
  suite(`${name} (PolicyBuilder contract)${options.pending === undefined ? '' : ` [pending ${options.pending}]`}`, () => {
    const build = (settings: PermissionSettings) => {
      const { builder, table } = create();
      return { policy: builder.build({ sessionId: 's1', permissionMode: 'auto', settings, table, capabilities: LOCAL }), table };
    };
    const sandboxed = defaultPermissionSettings({ isDefaultProfile: false });
    const plain = defaultPermissionSettings({ isDefaultProfile: true });

    it('writes the static ask rules of every draft and approve class', () => {
      const { policy, table } = build(plain);
      const expected = table.filter((row) => row.defaultMode === 'draft' || row.defaultMode === 'approve').flatMap((row) => row.askRules);
      expect(expected.length, 'the table has classes with ask rules').toBeGreaterThan(0);
      for (const rule of expected) expect(policy.ask, rule).toContain(rule);
      expect(policy.ask, 'git push in both forms').toEqual(expect.arrayContaining(['Bash(git push)', 'Bash(git push *)']));
    });

    it('turns a class set to deny into deny rules and one set to allow into no rule', () => {
      const denied = build({ ...plain, outward: { 'git.push': 'deny', 'slack.send': 'allow' } }).policy;
      expect(denied.deny, 'git push denied').toEqual(expect.arrayContaining(['Bash(git push *)']));
      expect(denied.ask, 'no ask rule for a denied class').not.toContain('Bash(git push *)');
      expect(denied.ask.some((rule) => rule.includes('slack_send_message')), 'no ask rule for an allowed class').toBe(false);
    });

    it('turns on the Bash sandbox with a strict allowlist and HTTPS GitHub remotes when the profile has it on', () => {
      const { policy } = build(sandboxed);
      expect(policy.sandbox, 'sandbox settings').toMatchObject({ enabled: true, allowUnsandboxedCommands: false, network: { strictAllowlist: true } });
      expect((policy.sandbox?.['network'] as { allowedDomains: string[] }).allowedDomains, 'profile allowlist').toEqual([...sandboxed.network.allow]);
      expect(policy.env['GIT_CONFIG_COUNT'], 'git url rewrite').toBeDefined();
      expect(build(plain).policy.sandbox, 'no sandbox when off').toBeUndefined();
      expect(build(plain).policy.env['GIT_CONFIG_COUNT'], 'no rewrite when off').toBeUndefined();
    });

    it('hands the inspector the table, the overrides and the allowlist', () => {
      const { policy, table } = build({ ...sandboxed, outward: { 'git.push': 'draft' } });
      expect(policy.gate, 'gate file content').toMatchObject({ schema: 1, sessionId: 's1', outward: { 'git.push': 'draft' }, allowedHosts: [...sandboxed.network.allow] });
      expect(policy.gate.table, 'table').toEqual(table);
    });
  });
}
