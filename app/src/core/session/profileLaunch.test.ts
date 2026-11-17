import { describe, expect, it } from 'vitest';
import { profilePaths } from '../profile/paths';
import type { ProfileSettings } from '../profile/types';
import { profileLaunchSpec } from './profileLaunch';

const paths = profilePaths('/root', 'work');
const settings = (claudeConfig: ProfileSettings['claudeConfig']): ProfileSettings => ({
  schema: 1,
  claudeConfig,
  tools: { mode: 'inherit' },
  isolation: { provider: 'local' },
  showBadge: true,
  shareUnread: true,
});
const base = { PATH: '/bin', CLAUDECODE: '1', ANTHROPIC_API_KEY: 'k', CLAUDE_CONFIG_DIR: '/shell' };

describe('profile launch inputs', () => {
  it('name the Claude directory of a profile with its own directory', () => {
    const spec = profileLaunchSpec(settings({ mode: 'directory', path: '/profiles/work/claude' }), paths, base);
    expect(spec.claudeConfigDir, 'directory of the profile').toBe('/profiles/work/claude');
    expect(spec.env['CLAUDE_CONFIG_DIR'], 'same value in the environment').toBe('/profiles/work/claude');
  });

  it('leave the Claude directory out for a profile on the CLI default and drop the shell value', () => {
    const spec = profileLaunchSpec(settings({ mode: 'cli-default' }), paths, base);
    expect(spec.claudeConfigDir, 'no directory').toBeUndefined();
    expect(spec.env['CLAUDE_CONFIG_DIR'], 'the shell value does not select a login').toBeUndefined();
  });

  it('remove credential variables and variables of a parent Claude Code session', () => {
    const spec = profileLaunchSpec(settings({ mode: 'cli-default' }), paths, base);
    expect(spec.env['ANTHROPIC_API_KEY'], 'credential variable removed').toBeUndefined();
    expect(spec.env['CLAUDECODE'], 'injected variable removed').toBeUndefined();
    expect(spec.env['PATH'], 'ordinary variables stay').toBe('/bin');
  });
});
