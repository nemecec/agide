import { ACTION_CLASSES } from './classTable';
import type { LaunchPolicy, PolicyBuilder, PolicyInput } from './types';

const GITHUB_REWRITES: readonly (readonly [string, string])[] = [
  ['url.https://github.com/.insteadOf', 'git@github.com:'],
  ['url.https://github.com/.insteadOf', 'ssh://git@github.com/'],
];

/** Builds the rules, the sandbox settings, the environment and the gate file content of one launch (0028 sections 2 and 5). */
export class DefaultPolicyBuilder implements PolicyBuilder {
  build(input: PolicyInput): LaunchPolicy {
    const { settings, table, capabilities } = input;
    const ask = new Set<string>();
    const deny = new Set<string>();
    for (const row of table) {
      const mode = settings.outward?.[row.id] ?? row.defaultMode;
      if (mode === 'draft' || mode === 'approve') row.askRules.forEach((rule) => ask.add(rule));
      else if (mode === 'deny') row.askRules.forEach((rule) => deny.add(rule));
    }
    // The provider's own allowlist covers the whole process, so the Bash sandbox is for providers without one.
    const sandboxed = settings.network.bashSandbox && capabilities.network !== 'allowlist';
    const env: Record<string, string> = {};
    if (sandboxed) {
      env['GIT_CONFIG_COUNT'] = String(GITHUB_REWRITES.length);
      GITHUB_REWRITES.forEach(([key, value], index) => {
        env[`GIT_CONFIG_KEY_${index}`] = key;
        env[`GIT_CONFIG_VALUE_${index}`] = value;
      });
    }
    return {
      ask: [...ask],
      deny: [...deny],
      ...(sandboxed
        ? {
            sandbox: {
              enabled: true,
              allowUnsandboxedCommands: false,
              network: { allowedDomains: [...settings.network.allow], deniedDomains: [...settings.network.deny], strictAllowlist: true },
            },
          }
        : {}),
      env,
      gate: {
        schema: 1,
        sessionId: input.sessionId,
        table,
        outward: settings.outward ?? {},
        allowedHosts: [...settings.network.allow],
        ...(input.ownBranch === undefined ? {} : { ownBranch: input.ownBranch }),
      },
      network: capabilities.network === 'allowlist' ? { mode: 'allowlist', allow: settings.network.allow.map((host) => ({ host })) } : { mode: 'unrestricted' },
    };
  }
}

export const DEFAULT_TABLE = ACTION_CLASSES;
