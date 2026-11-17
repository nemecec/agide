import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { claudeArgsFromEnv, claudeEnv, defaultPermissionModeFromEnv, defaultSessionCwd } from './env';

describe('launch environment', () => {
  it('drops variables a parent Claude Code session injects and keeps the config directory', () => {
    const env = claudeEnv({ CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_CONFIG_DIR: '/c', HOME: '/h' });
    expect(env['CLAUDECODE'], 'CLAUDECODE is removed').toBeUndefined();
    expect(env['CLAUDE_CODE_ENTRYPOINT'], 'CLAUDE_CODE_* is removed').toBeUndefined();
    expect(env['CLAUDE_CONFIG_DIR'], 'the config directory stays').toBe('/c');
  });

  it('reads extra launch arguments as a JSON array of strings', () => {
    expect(claudeArgsFromEnv({}), 'no variable means no arguments').toEqual([]);
    expect(claudeArgsFromEnv({ AGIDE_CLAUDE_ARGS: '["--model","haiku"]' }), 'arguments from the variable').toEqual(['--model', 'haiku']);
  });

  it('refuses extra launch arguments that are not a list of strings', () => {
    expect(() => claudeArgsFromEnv({ AGIDE_CLAUDE_ARGS: '--model haiku' }), 'plain text is rejected').toThrow();
    expect(() => claudeArgsFromEnv({ AGIDE_CLAUDE_ARGS: '["--max-budget-usd",0.25]' }), 'a number is rejected').toThrow(
      'JSON array of strings',
    );
  });

  it('starts sessions in the configured directory, else in the home directory', () => {
    expect(defaultSessionCwd('f1', { AGIDE_SESSION_CWD: '/work' }), 'configured directory').toBe('/work');
    expect(defaultSessionCwd('f1', {}), 'a directory per folder below the home directory').toBe(join(homedir(), 'Agide', 'f1'));
  });

  it('defaults the permission mode to the prompting mode and reads AGIDE_PERMISSION_MODE', () => {
    expect(defaultPermissionModeFromEnv({}), 'no variable').toBe('default');
    expect(defaultPermissionModeFromEnv({ AGIDE_PERMISSION_MODE: 'auto' }), 'auto from the variable').toBe('auto');
  });

  it('refuses unknown permission modes and bypassPermissions as a default', () => {
    expect(() => defaultPermissionModeFromEnv({ AGIDE_PERMISSION_MODE: 'autoo' }), 'typo').toThrow('AGIDE_PERMISSION_MODE');
    expect(() => defaultPermissionModeFromEnv({ AGIDE_PERMISSION_MODE: 'bypassPermissions' }), 'bypass needs confirmation per session').toThrow();
  });
});
