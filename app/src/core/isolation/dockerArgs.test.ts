import { describe, expect, it } from 'vitest';
import { buildDockerRunArgs, containerEnvNames, containerName, mountSpec } from './dockerArgs';

const input = {
  sessionId: 's1',
  user: '501:20',
  hostAlias: 'host.docker.internal',
  image: 'img',
  command: ['claude'],
  cwd: '/work',
  mounts: [
    { hostPath: '/work', readOnly: false },
    { hostPath: '/sessions/s1', readOnly: true },
  ],
  envNames: ['TERM', 'CLAUDE_CONFIG_DIR'],
  fixedEnv: { HOME: '/tmp' },
  claudeArgs: ['--session-id', 's1'],
};

describe('buildDockerRunArgs', () => {
  it('runs one labelled, named, init-supervised container that is removed on exit', () => {
    const args = buildDockerRunArgs({ ...input, ownerId: 'abc' });
    expect(args.slice(0, 4), 'interactive run with removal and init').toEqual(['run', '-it', '--rm', '--init']);
    expect(args, 'session label').toEqual(expect.arrayContaining(['--label', 'agide.session=s1']));
    expect(args, 'owner label').toEqual(expect.arrayContaining(['--label', 'agide.owner=abc']));
    expect(args, 'name from the session id').toEqual(expect.arrayContaining(['--name', containerName('s1')]));
    expect(args, 'host user').toEqual(expect.arrayContaining(['--user', '501:20']));
    expect(args, 'host alias resolves to the host gateway').toEqual(expect.arrayContaining(['--add-host', 'host.docker.internal:host-gateway']));
  });

  it('runs interactive without a terminal for a process that speaks NDJSON on stdin and stdout', () => {
    expect(buildDockerRunArgs({ ...input, tty: false }).slice(0, 4), 'no -t').toEqual(['run', '-i', '--rm', '--init']);
    expect(buildDockerRunArgs({ ...input, tty: true }).slice(0, 2), 'explicit terminal').toEqual(['run', '-it']);
  });

  it('mounts every path at the same absolute path, read-only where asked, and puts the image, command and Claude arguments last', () => {
    const args = buildDockerRunArgs(input);
    expect(args, 'workspace mount').toEqual(expect.arrayContaining(['--mount', 'type=bind,src=/work,dst=/work']));
    expect(args, 'session mount read-only').toEqual(expect.arrayContaining(['--mount', 'type=bind,src=/sessions/s1,dst=/sessions/s1,readonly']));
    expect(args.slice(-6), 'working directory, image, command, then the Claude arguments').toEqual(['-w', '/work', 'img', 'claude', '--session-id', 's1']);
  });

  it('refuses a mount path that a --mount value cannot carry', () => {
    expect(() => mountSpec({ hostPath: '/a,b', readOnly: false }), 'comma').toThrow('comma or a line break');
    expect(() => mountSpec({ hostPath: '/a\nb', readOnly: true }), 'line break').toThrow('comma or a line break');
    expect(mountSpec({ hostPath: '/a:b', readOnly: false }), 'a colon is fine in a --mount value').toBe('type=bind,src=/a:b,dst=/a:b');
  });

  it('passes variables by name so no value is an argument', () => {
    const args = buildDockerRunArgs(input);
    expect(args, 'name only').toEqual(expect.arrayContaining(['-e', 'CLAUDE_CONFIG_DIR']));
    expect(args, 'fixed value').toEqual(expect.arrayContaining(['-e', 'HOME=/tmp']));
    expect(args.some((arg) => arg.startsWith('CLAUDE_CONFIG_DIR=')), 'no variable assignment with a value').toBe(false);
  });

  it('omits the owner label without an owner', () => {
    expect(buildDockerRunArgs(input).join(' '), 'no owner label').not.toContain('agide.owner');
  });
});

describe('containerEnvNames', () => {
  const profile = { claudeConfigDir: '/c', ghConfigDir: '/gh', env: {}, extraEnv: { GIT_AUTHOR_NAME: 'x' }, toolFiles: [{ hostPath: '/g', envVar: 'GIT_CONFIG_GLOBAL' }] };
  const available = { PATH: '/bin', HOME: '/Users/x', TERM: 't', COLORTERM: 'c', CLAUDE_CONFIG_DIR: '/c', GH_CONFIG_DIR: '/gh', GIT_AUTHOR_NAME: 'x', GIT_CONFIG_GLOBAL: '/g', AWS_SECRET: 's', LAUNCH: '1' };

  it('lets the profile, launch and tool variables in and keeps the host environment out', () => {
    const names = containerEnvNames(profile, { LAUNCH: '1' }, available);
    expect(names, 'entering variables').toEqual(expect.arrayContaining(['TERM', 'COLORTERM', 'CLAUDE_CONFIG_DIR', 'GH_CONFIG_DIR', 'GIT_AUTHOR_NAME', 'GIT_CONFIG_GLOBAL', 'LAUNCH']));
    expect(names, 'host variables stay out').not.toEqual(expect.arrayContaining(['PATH']));
    expect(names.includes('HOME') || names.includes('AWS_SECRET'), 'neither HOME nor an unlisted credential variable enters').toBe(false);
  });

  it('refuses a name that is not a variable name', () => {
    expect(containerEnvNames({ ...profile, extraEnv: { 'A=B': '1' } }, undefined, { ...available, 'A=B': '1' }), 'invalid name dropped').not.toContain('A=B');
  });
});
