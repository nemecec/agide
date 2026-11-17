import { describe, expect, it } from 'vitest';
import { profilePaths } from './paths';
import { profileEnv } from './profileEnv';
import { defaultSettings } from './schemas';
import type { ProfileSettings } from './types';

const paths = profilePaths('/root', 'work');
const inherited: ProfileSettings = defaultSettings({ isDefaultProfile: true, claudeConfigDir: paths.claude });
const isolated: ProfileSettings = defaultSettings({ isDefaultProfile: false, claudeConfigDir: paths.claude });
const base = {
  PATH: '/bin',
  HOME: '/home/u',
  ANTHROPIC_API_KEY: 'k',
  ANTHROPIC_AUTH_TOKEN: 't',
  CLAUDE_CONFIG_DIR: '/other',
  CLAUDECODE: '1',
  CLAUDE_CODE_OAUTH_TOKEN: 'o',
  GH_TOKEN: 'g',
  GITHUB_TOKEN: 'g2',
  GH_HOST: 'h',
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'x',
  GIT_SSH_COMMAND: 'ssh',
  SSH_AUTH_SOCK: '/sock',
  AWS_PROFILE: 'p',
  AWS_SECRET_ACCESS_KEY: 's',
  NPM_CONFIG_USERCONFIG: '/npmrc',
  DOCKER_CONFIG: '/docker',
};

describe('profile launch environment', () => {
  it('removes Claude credential variables and the inherited config directory for a CLI-default profile', () => {
    const env = profileEnv(base, inherited, paths);
    for (const key of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CONFIG_DIR', 'CLAUDECODE', 'CLAUDE_CODE_OAUTH_TOKEN']) {
      expect(env[key], `${key} removed`).toBeUndefined();
    }
    expect(env['GH_TOKEN'], 'inherited tool credential kept in inherit mode').toBe('g');
    expect(env['SSH_AUTH_SOCK'], 'inherited agent socket kept in inherit mode').toBe('/sock');
  });

  it('sets the config directory of a profile with its own directory', () => {
    const env = profileEnv(base, isolated, paths);
    expect(env['CLAUDE_CONFIG_DIR'], 'profile directory').toBe(paths.claude);
  });

  it('removes every tool credential variable of the base environment in isolated mode', () => {
    const env = profileEnv(base, isolated, paths);
    for (const key of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_HOST', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_SSH_COMMAND', 'SSH_AUTH_SOCK', 'AWS_PROFILE', 'AWS_SECRET_ACCESS_KEY']) {
      expect(env[key], `${key} removed`).toBeUndefined();
    }
    const baseValues = new Set(Object.values(base));
    const credentialKeys = Object.keys(env).filter((key) => /TOKEN|SECRET|SOCK|KEY/.test(key));
    expect(credentialKeys.filter((key) => baseValues.has(env[key] ?? '')), 'no credential value of the base survives').toEqual([]);
  });

  it('drops credential variables it has no name for in isolated mode and keeps the basics', () => {
    const env = profileEnv({ ...base, GITLAB_TOKEN: 'a', NPM_TOKEN: 'b', KUBECONFIG: '/k', GOOGLE_APPLICATION_CREDENTIALS: '/g', AZURE_CLIENT_SECRET: 'c', LANG: 'en_US.UTF-8' }, isolated, paths);
    for (const key of ['GITLAB_TOKEN', 'NPM_TOKEN', 'KUBECONFIG', 'GOOGLE_APPLICATION_CREDENTIALS', 'AZURE_CLIENT_SECRET']) {
      expect(env[key], `${key} dropped`).toBeUndefined();
    }
    expect([env['PATH'], env['HOME'], env['LANG']], 'process basics kept').toEqual(['/bin', '/home/u', 'en_US.UTF-8']);
    expect(profileEnv({ ...base, GITLAB_TOKEN: 'a' }, inherited, paths)['GITLAB_TOKEN'], 'inherit mode keeps the environment').toBe('a');
  });

  it('sets each removed location variable to a path inside the profile', () => {
    const env = profileEnv(base, isolated, paths);
    const expected = {
      GH_CONFIG_DIR: paths.tools.gh,
      GIT_CONFIG_GLOBAL: paths.tools.gitconfig,
      AWS_CONFIG_FILE: paths.tools.awsConfig,
      AWS_SHARED_CREDENTIALS_FILE: paths.tools.awsCredentials,
      NPM_CONFIG_USERCONFIG: paths.tools.npmrc,
      DOCKER_CONFIG: paths.tools.docker,
    };
    for (const [key, value] of Object.entries(expected)) {
      expect(env[key], `${key} points into the profile`).toBe(value);
      expect(value.startsWith(paths.dir), `${key} value lies under the profile directory`).toBe(true);
    }
  });
});
