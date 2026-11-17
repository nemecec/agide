import { homedir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { claudeArgsFromEnv, claudeEnv, defaultSessionCwd } from './env';

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
    expect(defaultSessionCwd({ AGIDE_SESSION_CWD: '/work' }), 'configured directory').toBe('/work');
    expect(defaultSessionCwd({}), 'home directory').toBe(homedir());
  });
});
