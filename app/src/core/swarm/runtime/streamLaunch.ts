import type { LaunchContribution } from '../../session/launchContributions';
import type { AgentLaunchSpec } from './types';

/** The flags that turn `claude` into a stream-json process on the subscription login (`--bare` is never passed). */
export const STREAM_JSON_FLAGS: readonly string[] = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--permission-prompt-tool', 'stdio'];

/**
 * What the runtime adds to the launch of an agent, on top of the session service's own arguments
 * (`--session-id` or `--resume`, `--permission-mode`, `--setting-sources`, `--settings`, `--mcp-config`).
 */
export function streamContribution(spec: AgentLaunchSpec, toEnv: (hostPath: string) => string): LaunchContribution {
  const args = [
    ...STREAM_JSON_FLAGS,
    '--model',
    spec.model,
    '--effort',
    spec.effort,
    '--max-budget-usd',
    String(spec.maxBudgetUsd),
    '--max-turns',
    String(spec.maxTurnsPerMessage),
    ...(spec.connectors ? [] : ['--strict-mcp-config']),
    ...(spec.tools === undefined ? [] : ['--tools', spec.tools.join(',')]),
    ...(spec.allowedTools === undefined ? [] : ['--allowedTools', spec.allowedTools.join(',')]),
    ...spec.addDirs.flatMap((dir) => ['--add-dir', toEnv(dir)]),
  ];
  return {
    args,
    env: {
      CLAUDE_CODE_SUBAGENT_MODEL: spec.model,
      CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '1',
      ...spec.env,
    },
    ...(spec.denyRules.length === 0 ? {} : { settings: { permissions: { deny: spec.denyRules } } }),
  };
}
