import { describe, expect, it } from 'vitest';
import { buildLaunchArgs, cliPermissionMode } from './launchArgs';

const base = { sessionId: '11111111-1111-4111-8111-111111111111', inboxDir: '/tmp/inbox' } as const;

describe('launch arguments', () => {
  it('start a new session with --session-id and an explicit permission mode', () => {
    const args = buildLaunchArgs({ ...base, resume: false, permissionMode: 'acceptEdits' });
    expect(args.slice(0, 4), 'session id and permission mode').toEqual(['--session-id', base.sessionId, '--permission-mode', 'acceptEdits']);
    expect(args, 'user settings only').toContain('--setting-sources');
    expect(args[args.indexOf('--setting-sources') + 1], 'setting sources').toBe('user');
    expect(args, 'no resume flag').not.toContain('--resume');
  });

  it('reopen a session with --resume and the same id', () => {
    const args = buildLaunchArgs({ ...base, resume: true, permissionMode: 'plan' });
    expect(args.slice(0, 2), 'resume flag and id').toEqual(['--resume', base.sessionId]);
    expect(args, 'no session id flag').not.toContain('--session-id');
  });

  it('carry the hook settings as JSON and put the integrator arguments last', () => {
    const args = buildLaunchArgs({ ...base, resume: false, permissionMode: 'default', extraArgs: ['--mcp-config', '{}'] });
    const settings = JSON.parse(args[args.indexOf('--settings') + 1] ?? '') as { hooks: Record<string, unknown> };
    expect(Object.keys(settings.hooks), 'hooks in --settings').toContain('Stop');
    expect(args.slice(-2), 'extra arguments').toEqual(['--mcp-config', '{}']);
  });

  it('add permission rules that deny reading and editing the listed paths', () => {
    const args = buildLaunchArgs({ ...base, resume: false, permissionMode: 'default', denyPaths: ['/app/root'] });
    const settings = JSON.parse(args[args.indexOf('--settings') + 1] ?? '') as { permissions?: { deny: string[] } };
    expect(settings.permissions?.deny, 'absolute paths use a double slash').toEqual(['Read(//app/root/**)', 'Edit(//app/root/**)']);
    const none = JSON.parse(buildLaunchArgs({ ...base, resume: false, permissionMode: 'default' }).at(buildLaunchArgs({ ...base, resume: false, permissionMode: 'default' }).indexOf('--settings') + 1) ?? '') as object;
    expect(Object.keys(none), 'no permissions without paths').toEqual(['hooks']);
  });

  it('name the prompting mode manual for the CLI', () => {
    expect(cliPermissionMode('default'), 'default maps to manual').toBe('manual');
    expect(cliPermissionMode('bypassPermissions'), 'other modes pass through').toBe('bypassPermissions');
  });

  it('pass the MCP config as a file path before the integrator arguments', () => {
    const args = buildLaunchArgs({ ...base, resume: false, permissionMode: 'default', mcpConfigPath: '/s/mcp.json', extraArgs: ['--model', 'haiku'] });
    expect(args.slice(-4), 'config path then extra arguments').toEqual(['--mcp-config', '/s/mcp.json', '--model', 'haiku']);
  });
});
