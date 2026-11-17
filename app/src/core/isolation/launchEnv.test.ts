import { describe, expect, it } from 'vitest';
import { launchEnv } from './launchEnv';

describe('launch environment of a profile', () => {
  const profile = {
    claudeConfigDir: '/p/claude',
    ghConfigDir: '/p/gh',
    env: { PATH: '/bin', CLAUDECODE: '1', CLAUDE_CONFIG_DIR: '/shell', GH_CONFIG_DIR: '/shell-gh', KEEP: 'base' },
    extraEnv: { KEEP: 'extra', EXTRA: 'x' },
    toolFiles: [{ hostPath: '/p/gitconfig', envVar: 'GIT_CONFIG_GLOBAL' }],
  };

  it('puts the profile directories over the base values and extra variables over the base', () => {
    const env = launchEnv(profile, (path) => path);
    expect(env['CLAUDE_CONFIG_DIR'], 'Claude directory').toBe('/p/claude');
    expect(env['GH_CONFIG_DIR'], 'gh directory').toBe('/p/gh');
    expect(env['KEEP'], 'extra over base').toBe('extra');
    expect(env['GIT_CONFIG_GLOBAL'], 'tool file variable').toBe('/p/gitconfig');
    expect(env['CLAUDECODE'], 'injected variable removed').toBeUndefined();
  });

  it('maps host paths into the environment', () => {
    const env = launchEnv(profile, (path) => `/mnt${path}`);
    expect(env['CLAUDE_CONFIG_DIR'], 'mapped Claude directory').toBe('/mnt/p/claude');
    expect(env['GIT_CONFIG_GLOBAL'], 'mapped tool file').toBe('/mnt/p/gitconfig');
    expect(env['EXTRA'], 'plain variables are not mapped').toBe('x');
  });

  it('leaves the Claude directory unset for the CLI default and drops an inherited value', () => {
    const env = launchEnv({ claudeConfigDir: undefined, env: { PATH: '/bin' }, toolFiles: [] }, (path) => path);
    expect(env['CLAUDE_CONFIG_DIR'], 'no Claude directory').toBeUndefined();
  });
});
