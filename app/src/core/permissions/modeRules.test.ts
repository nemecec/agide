import { describe, expect, it } from 'vitest';
import type { ProviderCapabilities } from '../isolation/types';
import { PermissionLaunchContributor } from './launchContributor';
import { ACTION_CLASSES } from './classTable';
import { defaultPermissionSettings } from './defaults';
import { resolveSessionMode } from './modeRules';
import { DefaultPolicyBuilder } from './policyBuilder';
import { PermissionError, type ModeRequest } from './types';
import { permissionOptions } from './options';

const caps = (filesystem: ProviderCapabilities['filesystem'], network: ProviderCapabilities['network']): ProviderCapabilities => ({ filesystem, network, login: 'host-keychain', hookTransports: ['inbox-dir'], transcripts: 'host-files' });
const LOCAL = caps('host-user', 'none');
const ISOLATED = caps('enforced', 'allowlist');
const settings = defaultPermissionSettings({ isDefaultProfile: false });
const resolve = (request: Partial<ModeRequest>, override?: Parameters<typeof resolveSessionMode>[2]) => resolveSessionMode({ capabilities: LOCAL, ...request }, settings, override);
const code = (run: () => unknown): string | undefined => {
  try {
    run();
  } catch (error) {
    return error instanceof PermissionError ? error.code : 'other';
  }
  return undefined;
};

describe('session mode resolution', () => {
  it('starts in auto without any choice and follows the profile default', () => {
    expect(resolve({}), 'no choice').toBe('auto');
    expect(resolveSessionMode({ capabilities: LOCAL }, { ...settings, defaultMode: 'plan' }, undefined), 'profile default').toBe('plan');
  });

  it('lets the request beat the test override and the override beat the profile default', () => {
    expect(resolve({ requested: 'acceptEdits' }, 'plan'), 'request wins').toBe('acceptEdits');
    expect(resolve({}, 'plan'), 'override beats default').toBe('plan');
  });

  it('refuses bypass on the local provider even with a confirmation, and without one inside an isolating provider', () => {
    expect(code(() => resolve({ requested: 'bypassPermissions', confirmBypassPermissions: true })), 'local').toBe('bypass_refused');
    expect(code(() => resolve({ requested: 'bypassPermissions', capabilities: ISOLATED })), 'no confirmation').toBe('confirmation_needed');
    expect(resolve({ requested: 'bypassPermissions', capabilities: ISOLATED, confirmBypassPermissions: true }), 'isolated and confirmed').toBe('bypassPermissions');
    expect(code(() => resolve({ requested: 'bypassPermissions', capabilities: caps('enforced', 'none'), confirmBypassPermissions: true })), 'container without egress policy').toBe('bypass_refused');
  });

  it('refuses bypass when the inspector cannot run for the launch', () => {
    expect(code(() => resolve({ requested: 'bypassPermissions', capabilities: ISOLATED, confirmBypassPermissions: true, inspectorAvailable: false })), 'no inspector').toBe('bypass_refused');
    expect(resolve({ requested: 'bypassPermissions', capabilities: ISOLATED, confirmBypassPermissions: true, inspectorAvailable: true }), 'inspector present').toBe('bypassPermissions');
    expect(resolve({ requested: 'auto', inspectorAvailable: false }), 'other modes do not need it').toBe('auto');
  });

  it('refuses a mode looser than the starting session', () => {
    expect(code(() => resolve({ requested: 'auto', callerMode: 'default' })), 'looser').toBe('looser_than_caller');
    expect(resolve({ requested: 'plan', callerMode: 'auto' }), 'stricter').toBe('plan');
  });

  it('offers bypass in the options only for an isolating provider', () => {
    expect(permissionOptions(settings, 'local').modes.map((mode) => mode.id), 'local modes').toEqual(['auto', 'default', 'acceptEdits', 'plan']);
    expect(permissionOptions(settings, 'srt').modes.map((mode) => mode.id), 'srt modes').toContain('bypassPermissions');
    expect(permissionOptions(settings, 'local').runsAsUser, 'local runs as the user').toBe(true);
  });
});

describe('launch contribution', () => {
  const context = (written: string[]) => ({
    session: { id: 's1' },
    permissionMode: 'auto',
    provider: { id: 'local', capabilities: LOCAL },
    hookDir: '/hooks',
    writeSessionFile: (_name: string, content: string) => {
      written.push(content);
      return Promise.resolve('/files/gate.json');
    },
  }) as never;
  const contributor = (command: string | undefined) =>
    new PermissionLaunchContributor({ settings: () => settings, table: ACTION_CLASSES, builder: new DefaultPolicyBuilder(), inspectorCommand: () => command });

  it('writes the gate file with the inbox directory and replaces the base PreToolUse hook', async () => {
    const written: string[] = [];
    const result = await contributor('run-inspector').contribute(context(written));
    expect(JSON.parse(written[0] ?? '{}'), 'gate file').toMatchObject({ schema: 1, sessionId: 's1', inboxDir: '/hooks' });
    expect(result.replacesBaseHooks, 'base hook replaced').toEqual(['PreToolUse']);
    expect(result.settings?.hooks?.PreToolUse?.[0], 'hook entry').toMatchObject({ type: 'command', command: 'run-inspector', timeout: 10 });
    expect(result.settings?.permissions?.ask, 'ask rules').toContain('Bash(git push *)');
    expect(result.settings?.sandbox, 'sandbox of a new profile').toMatchObject({ enabled: true });
    expect(result.env?.['GIT_CONFIG_COUNT'], 'https rewrite').toBe('2');
  });

  it('adds no inspector hook for a provider whose CLI cannot run it, such as a container', async () => {
    const written: string[] = [];
    const base = context(written) as { provider: { capabilities: ProviderCapabilities } };
    const container = { ...base, provider: { id: 'container', capabilities: { ...LOCAL, inspectorHook: 'unavailable' } } } as never;
    const result = await contributor('run-inspector').contribute(container);
    expect(result.settings?.hooks, 'no hook entry').toBeUndefined();
    expect(result.replacesBaseHooks, 'no replacement').toBeUndefined();
    expect(result.settings?.permissions?.ask, 'the ask rules stay').toContain('Bash(git push *)');
  });

  it('keeps the base hook when no inspector is available', async () => {
    const result = await contributor(undefined).contribute(context([]));
    expect(result.replacesBaseHooks, 'no replacement').toBeUndefined();
    expect(result.settings?.hooks, 'no hook entry').toBeUndefined();
  });
});
