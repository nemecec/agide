import { describe, expect, it } from 'vitest';
import { checkDenyRead, claudeConfigPaths, HOME_CREDENTIAL_PATHS } from './checkDenyRead';

describe('what a sandboxed check may not read', () => {
  const input = { agent: ['/secrets/other'], appRoot: '/app', appDirs: ['/logs/app', '/dumps/app'], home: '/home/u', claude: ['/home/u/.claude', '/home/u/.claude.json'] };

  it('holds the agent list, the app root, the logs and crash dumps, and the credentials of the home directory', () => {
    const list = checkDenyRead(input);
    expect(list, 'the entries of the agent session').toContain('/secrets/other');
    expect(list, 'the app root holds the data, tools and Claude directories of the other profiles and the registry').toContain('/app');
    expect(list, 'logs and crash dumps').toEqual(expect.arrayContaining(['/logs/app', '/dumps/app']));
    expect(list, 'the Claude directory of the default login lies outside the app root and holds transcripts').toEqual(expect.arrayContaining(['/home/u/.claude', '/home/u/.claude.json']));
    expect(list, 'the credential locations below the real home').toEqual(expect.arrayContaining(['/home/u/.ssh', '/home/u/.aws', '/home/u/.config/gh', '/home/u/.docker/config.json']));
  });

  it('holds every credential location once and no file that tools read by default', () => {
    const list = checkDenyRead({ ...input, agent: ['/home/u/.ssh'] });
    expect(list.filter((entry) => entry === '/home/u/.ssh'), 'a path both lists name is listed once').toHaveLength(1);
    expect(list.length, 'one entry per source').toBe(new Set(list).size);
    expect(HOME_CREDENTIAL_PATHS.some((path) => path.endsWith('.npmrc') || path.endsWith('settings.xml')), 'the files that npm and Maven read by default stay readable').toBe(false);
  });

  it('works without agent entries', () => {
    expect(checkDenyRead({ ...input, agent: undefined })[0], 'the app root comes first').toBe('/app');
  });
});

describe('the Claude configuration of the profile that runs the check', () => {
  it('is the directory of the profile when it has one', () => {
    expect(claudeConfigPaths({ configured: '/app/profiles/p/claude', home: '/home/u' }), 'the configured directory').toEqual(['/app/profiles/p/claude']);
  });

  it('is ~/.claude and ~/.claude.json for the default login', () => {
    expect(claudeConfigPaths({ configured: undefined, home: '/home/u' }), 'the directory and the file the agents of the default login use').toEqual(['/home/u/.claude', '/home/u/.claude.json']);
  });
});
