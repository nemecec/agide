import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { removeTempDirs, tempDir } from './gitFixtures';
import { userConfigPaths } from './userConfigPaths';

afterEach(() => {
  vi.unstubAllEnvs();
  removeTempDirs();
});

function pathsFor(command: string, dir: string): string[] {
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command }] }] } }));
  return userConfigPaths(dir);
}

describe('userConfigPaths', () => {
  it('names the instructions, settings, skills, agents, commands, output styles, hooks and the plugin manifest', () => {
    const dir = tempDir('claude');
    const paths = userConfigPaths(dir);
    for (const name of ['CLAUDE.md', 'settings.json', 'skills', 'agents', 'commands', 'output-styles', 'hooks', join('plugins', 'installed_plugins.json')])
      expect(paths, `the path ${name} is hashed`).toContain(join(dir, name));
  });

  it('adds the scripts that hook commands in settings.json name, with their arguments left out', () => {
    const dir = tempDir('claude');
    mkdirSync(join(dir, 'scripts'));
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: '"${CLAUDE_CONFIG_DIR}/scripts/check.sh" --strict' }, { type: 'command', command: '/opt/tools/audit.py log' }, { type: 'command', command: 'echo done' }] }] } }));
    const paths = userConfigPaths(dir);
    expect(paths, 'a script under the configuration directory').toContain(join(dir, 'scripts', 'check.sh'));
    expect(paths, 'an absolute script').toContain('/opt/tools/audit.py');
    expect(paths.filter((path) => path.includes('no-such-program')), 'a bare name that is on no PATH entry is no path').toEqual([]);
  });

  it('expands ~ and $HOME in the program of a hook command', () => {
    const home = tempDir('home');
    vi.stubEnv('HOME', home);
    const dir = tempDir('claude');
    expect(pathsFor('~/bin/a.sh run && $HOME/bin/b.sh', dir), 'both home forms resolve to the home directory').toEqual(expect.arrayContaining([join(home, 'bin', 'a.sh'), join(home, 'bin', 'b.sh')]));
    expect(pathsFor('${HOME}/bin/c.sh', dir), 'the braced form too').toContain(join(home, 'bin', 'c.sh'));
  });

  it('leaves arguments and directories out and keeps the script of an interpreter and of each simple command', () => {
    const dir = tempDir('claude');
    const project = tempDir('project');
    const paths = pathsFor(`cd ${project} && /opt/h/run.sh --root ${project} /var/log/hook.log; python3 -u /opt/h/audit.py --out /var/log/audit.log; node ${project}`, dir);
    expect(paths.includes(project), 'a directory named as the script of an interpreter is not hashed').toBe(false);
    expect(paths.includes('/var/log/hook.log'), 'an argument of a program is not hashed').toBe(false);
    expect(paths.includes('/var/log/audit.log'), 'an argument of a script is not hashed').toBe(false);
    expect(paths, 'the program after cd and the script of the interpreter').toEqual(expect.arrayContaining(['/opt/h/run.sh', '/opt/h/audit.py']));
  });

  it('resolves a bare program through PATH', () => {
    const bin = tempDir('bin');
    writeFileSync(join(bin, 'audit-hook'), '#!/bin/sh\n');
    chmodSync(join(bin, 'audit-hook'), 0o755);
    vi.stubEnv('PATH', `/nonexistent${delimiter}${bin}`);
    expect(pathsFor('audit-hook --strict', tempDir('claude')), 'the executable found on PATH').toContain(join(bin, 'audit-hook'));
  });

  it('names the fixed paths when settings.json is missing or not JSON', () => {
    const dir = tempDir('claude');
    writeFileSync(join(dir, 'settings.json'), '{ not json');
    expect(userConfigPaths(dir).length, 'the fixed paths remain').toBeGreaterThan(5);
  });
});
