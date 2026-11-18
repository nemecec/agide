import type { LaunchContext, LaunchContribution, LaunchContributor } from '../session/launchContributions';
import { shellQuote } from '../session/hooks';
import type { ActionClassTable, PermissionSettings, PolicyBuilder } from './types';

export interface PermissionContributorDeps {
  readonly settings: () => PermissionSettings;
  readonly table: ActionClassTable;
  readonly builder: PolicyBuilder;
  /** The command that runs the inspector on a gate file, or undefined when no inspector script is available. */
  readonly inspectorCommand: (gateFile: string) => string | undefined;
}

/** The hook command of the inspector for an executable and a script, run as Node (`ELECTRON_RUN_AS_NODE`). */
export function inspectorCommandFor(executable: string, script: string): (gateFile: string) => string {
  return (gateFile) => `ELECTRON_RUN_AS_NODE=1 ${shellQuote(executable)} ${shellQuote(script)} ${shellQuote(gateFile)}`;
}

/** Adds the ask and deny rules, the sandbox settings, the inspector hook and the gate file to every launch. */
export class PermissionLaunchContributor implements LaunchContributor {
  readonly id = 'permissions';

  constructor(private readonly deps: PermissionContributorDeps) {}

  async contribute(context: LaunchContext): Promise<LaunchContribution> {
    const policy = this.deps.builder.build({
      sessionId: context.session.id,
      permissionMode: context.permissionMode,
      settings: this.deps.settings(),
      table: this.deps.table,
      capabilities: context.provider.capabilities,
    });
    const gateFile = await context.writeSessionFile('gate.json', JSON.stringify({ ...policy.gate, inboxDir: context.hookDir }));
    const command = context.provider.capabilities.inspectorHook === 'unavailable' ? undefined : this.deps.inspectorCommand(gateFile);
    return {
      settings: {
        permissions: { ask: policy.ask, deny: policy.deny },
        ...(policy.sandbox === undefined ? {} : { sandbox: policy.sandbox }),
        ...(command === undefined ? {} : { hooks: { PreToolUse: [{ type: 'command' as const, command, timeout: 10 }] } }),
      },
      ...(command === undefined ? {} : { replacesBaseHooks: ['PreToolUse' as const] }),
      env: policy.env,
    };
  }
}
