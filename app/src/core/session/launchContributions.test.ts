import { describe, expect, it } from 'vitest';
import { launchSettings } from './launchArgs';
import { LaunchContributors, mergeContributions } from './launchContributions';

const hook = (command: string) => ({ type: 'command' as const, command });

describe('merging launch contributions', () => {
  it('appends hooks, permission rules and arguments in registration order', () => {
    const merged = mergeContributions([
      { id: 'permissions', contribution: { settings: { permissions: { ask: ['Bash(git push *)'] }, hooks: { PreToolUse: [hook('inspect')] } }, args: ['--a'] } },
      { id: 'browser', contribution: { settings: { hooks: { UserPromptSubmit: [hook('digest')] } }, args: ['--no-chrome'] } },
      { id: 'agents', contribution: { settings: { permissions: { ask: ['mcp__app__task_start'] } } } },
    ]);
    expect(merged.settings.permissions?.ask, 'ask rules of both contributors').toEqual(['Bash(git push *)', 'mcp__app__task_start']);
    expect(Object.keys(merged.settings.hooks ?? {}).sort(), 'hook events').toEqual(['PreToolUse', 'UserPromptSubmit']);
    expect(merged.args, 'arguments in order').toEqual(['--a', '--no-chrome']);
  });

  it('refuses a settings key, variable, MCP server or replaced hook that more than one contributor sets', () => {
    const twice = (contribution: object) => () =>
      mergeContributions([
        { id: 'one', contribution },
        { id: 'two', contribution },
      ]);
    expect(twice({ settings: { statusLine: { type: 'command', command: 'x' } } }), 'same settings key').toThrow('both set settings.statusLine');
    expect(twice({ env: { GIT_CONFIG_COUNT: '2' } }), 'same variable').toThrow('both set env GIT_CONFIG_COUNT');
    expect(twice({ mcpServers: { 'agide-browser': {} } }), 'same server').toThrow('both set mcp agide-browser');
    expect(twice({ replacesBaseHooks: ['PreToolUse'] }), 'same replaced hook').toThrow('both set hook PreToolUse');
  });

  it('never lets a contributor replace the app MCP server', () => {
    expect(() => mergeContributions([{ id: 'x', contribution: { mcpServers: { app: {} } } }]), 'reserved server name').toThrow('cannot replace the app');
  });

  it('give an empty result for no contributions', () => {
    expect(mergeContributions([]), 'nothing merged').toEqual({ settings: {}, replacesBaseHooks: [], args: [], env: {}, mcpServers: {} });
  });
});

describe('launch settings with contributions', () => {
  it('keep the app hook of every event, add contributed entries after it and drop a replaced base hook', () => {
    const settings = launchSettings({
      inboxDir: '/inbox',
      denyPaths: ['/app'],
      settings: { hooks: { PreToolUse: [hook('inspect')], Stop: [hook('extra')] }, permissions: { deny: ['Bash(rm *)'], ask: ['Bash(git push *)'] }, statusLine: { type: 'command', command: 's' } },
      replacesBaseHooks: ['PreToolUse'],
    }) as { hooks: Record<string, { hooks: { command: string }[] }[]>; permissions: { deny: string[]; ask: string[] }; statusLine: unknown };
    expect(settings.hooks['PreToolUse']?.map((entry) => entry.hooks[0]?.command), 'replaced base hook').toEqual(['inspect']);
    expect(settings.hooks['Stop']?.length, 'base hook and the contributed one').toBe(2);
    expect(settings.hooks['SessionStart']?.length, 'other base hooks unchanged').toBe(1);
    expect(settings.permissions.deny, 'app root rules first, then contributed').toEqual(['Read(//app/**)', 'Edit(//app/**)', 'Bash(rm *)']);
    expect(settings.permissions.ask, 'contributed ask rules').toEqual(['Bash(git push *)']);
    expect(settings.statusLine, 'other keys pass through').toEqual({ type: 'command', command: 's' });
  });
});

describe('LaunchContributors', () => {
  it('lists contributors in registration order, refuses a duplicate id and removes one on request', () => {
    const contributors = new LaunchContributors();
    const remove = contributors.register({ id: 'a', contribute: () => ({}) });
    contributors.register({ id: 'b', contribute: () => ({}) });
    expect(() => contributors.register({ id: 'a', contribute: () => ({}) }), 'duplicate id').toThrow('registered twice');
    expect(contributors.list().map((entry) => entry.id), 'order').toEqual(['a', 'b']);
    remove();
    expect(contributors.list().map((entry) => entry.id), 'after removal').toEqual(['b']);
  });
});
