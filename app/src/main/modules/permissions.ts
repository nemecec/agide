import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { CommandError } from '../../core/commands/index';
import {
  ACTION_CLASSES,
  DefaultPolicyBuilder,
  inspectorCommandFor,
  PermissionLaunchContributor,
  permissionOptions,
  permissionSettingsOf,
  permissionSettingsSchema,
  resolveSessionMode,
  type PermissionService,
  type PermissionSettings,
} from '../../core/permissions/index';
import { DEFAULT_PROFILE_ID, type ProfileService } from '../../core/profile/index';
import { defaultPermissionModeFromEnv, type LaunchContributors } from '../../core/session/index';
import type { ModuleContext, ModuleHandle } from '../context';

export interface PermissionModuleOptions {
  /** The bundled inspector script. Defaults to `inspect.js` beside the main bundle. */
  readonly inspectScript?: string;
  /** The executable that runs it as Node. Defaults to the app's own executable. */
  readonly executable?: string;
}

/**
 * Permissions module. Owner: w-permissions.
 * Resolves the mode of a session (request, test override, profile default, bypass rule), contributes the ask and deny
 * rules, the inspector hook, the sandbox settings and the gate file to every launch, and registers
 * `permissions_options` and `permissions_set`. Neither is an MCP tool: an agent does not change its own limits.
 * Without the bundled inspector script (unit tests run the sources) the launch carries the rules and no hook.
 */
export function init(ctx: ModuleContext, deps: { profile: ProfileService; launch: LaunchContributors }, options: PermissionModuleOptions = {}): ModuleHandle<PermissionService> {
  const isDefaultProfile = deps.profile.id === DEFAULT_PROFILE_ID;
  const settings = (): PermissionSettings => permissionSettingsOf(deps.profile.settings(), { isDefaultProfile });
  const script = options.inspectScript ?? join(dirname(fileURLToPath(import.meta.url)), 'inspect.js');
  const hasScript = existsSync(script);
  if (!hasScript) console.warn(`permission inspector script ${script} is missing; launches carry the rules without the PreToolUse inspector`);
  const inspectorCommand = hasScript ? inspectorCommandFor(options.executable ?? process.execPath, script) : () => undefined;

  const contributor = new PermissionLaunchContributor({ settings, table: ACTION_CLASSES, builder: new DefaultPolicyBuilder(), inspectorCommand });
  const service: PermissionService = {
    settings,
    resolveMode: (request) => resolveSessionMode({ ...request, inspectorAvailable: hasScript && request.capabilities.inspectorHook !== 'unavailable' }, settings(), process.env['AGIDE_PERMISSION_MODE'] ? defaultPermissionModeFromEnv() : undefined),
    // Providers that enforce no process-wide allowlist ignore the policy; srt enforces it.
    networkPolicy: () => ({ mode: 'allowlist', allow: settings().network.allow.map((host) => ({ host })) }),
    table: ACTION_CLASSES,
    contributor,
  };

  const unregister = [
    deps.launch.register(contributor),
    ctx.commands.register({
      id: 'permissions_options',
      title: 'Permission options',
      description: 'Returns the permission settings of this profile with the modes, the action classes and whether bypass is offered.',
      input: z.object({}),
      ui: false,
      mcp: false,
      run: () => permissionOptions(settings(), deps.profile.settings().isolation.provider),
    }),
    ctx.commands.register({
      id: 'permissions_set',
      title: 'Save permission settings',
      description: 'Stores the permission settings of this profile. They apply to sessions that start or resume afterwards.',
      input: z.object({ settings: permissionSettingsSchema }),
      ui: false,
      mcp: false,
      run: (input) => {
        try {
          deps.profile.store.updateSettings(deps.profile.id, { permissions: input.settings as PermissionSettings });
        } catch (error) {
          throw new CommandError('invalid_input', error instanceof Error ? error.message : String(error));
        }
        return { saved: true };
      },
    }),
  ];
  return { service, dispose: () => unregister.forEach((off) => off()) };
}
