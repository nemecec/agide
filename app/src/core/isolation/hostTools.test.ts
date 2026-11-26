import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HostTools, hostDirectory, hostTools, INSTALL_DIRECTORIES, requireAbsoluteFile, setHostTools, SYSTEM_DIRECTORIES, systemExecFile, systemExecFileSync, systemTool } from './hostTools';
import { IsolationError } from './types';

let dir: string;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'host-tools-')));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const program = (directory: string, name: string, body = '#!/bin/sh\nexit 0\n'): string => {
  mkdirSync(directory, { recursive: true });
  const path = join(directory, name);
  writeFileSync(path, body);
  chmodSync(path, 0o755);
  return path;
};

const exec = (tools: HostTools, name: string, args: string[], options: Parameters<HostTools['execFile']>[2] = {}) =>
  new Promise<{ error: Error | null; stdout: string; stderr: string }>((resolve) => tools.execFile(name, args, options, (error, stdout, stderr) => resolve({ error, stdout, stderr })));

describe('systemTool', () => {
  it('is a fixed absolute path for every system tool on macOS', () => {
    const names = ['df', 'chmod', 'ps', 'lsof', 'cp', 'env', 'open'] as const;
    expect(names.map((name) => systemTool(name, 'darwin')), 'the macOS locations').toEqual(['/bin/df', '/bin/chmod', '/bin/ps', '/usr/sbin/lsof', '/bin/cp', '/usr/bin/env', '/usr/bin/open']);
  });

  it('differs on Linux for lsof and the opener only', () => {
    expect([systemTool('lsof', 'linux'), systemTool('open', 'linux'), systemTool('df', 'linux')], 'the Linux locations').toEqual(['/usr/bin/lsof', '/usr/bin/xdg-open', '/bin/df']);
  });
});

describe('systemExecFile', () => {
  it('runs a tool with a fixed environment of the PATH of the system directories and a locale, in a directory that holds nothing', async () => {
    const stdout = await new Promise<string>((resolve, reject) => {
      systemExecFile('env', [], {}, (error, out) => (error === null ? resolve(out) : reject(error)));
    });
    expect(stdout.trim().split('\n').sort(), 'exactly these variables and no variable of the app').toEqual(['LC_ALL=C', `PATH=${SYSTEM_DIRECTORIES.join(':')}`]);
  });

  it('does not run a tool of the same name that the PATH of the app or the working directory holds', async () => {
    const marker = join(dir, 'marker');
    program(join(dir, 'bin'), 'df', `#!/bin/sh\ntouch '${marker}'\n`);
    const saved = process.env['PATH'];
    process.env['PATH'] = `${join(dir, 'bin')}:${saved ?? ''}`;
    try {
      const stdout = await new Promise<string>((resolve, reject) => systemExecFile('df', ['-P', dir], { cwd: join(dir, 'bin') }, (error, out) => (error === null ? resolve(out) : reject(error))));
      expect(stdout, 'the real df answered').toContain('Filesystem');
    } finally {
      process.env['PATH'] = saved;
    }
    expect(existsSync(marker), 'the planted df did not run').toBe(false);
  });

  it('reads the process table synchronously through the fixed path', () => {
    expect(systemExecFileSync('ps', ['-o', 'pid=', '-p', String(process.pid)]).trim(), 'the pid of this process').toBe(String(process.pid));
  });
});

describe('requireAbsoluteFile', () => {
  it('accepts an absolute program and refuses a name, a relative path and an empty one', () => {
    expect(() => requireAbsoluteFile({ file: '/usr/bin/env' }), 'an absolute path').not.toThrow();
    for (const file of ['env', './env', 'bin/env', '', '.']) expect(() => requireAbsoluteFile({ file }), `the program ${JSON.stringify(file)}`).toThrow(IsolationError);
  });
});

describe('hostDirectory', () => {
  it('is the empty system directory when there is one and the temporary directory otherwise', () => {
    expect(hostDirectory(dir), 'the directory it is given as the system one').toBe(dir);
    expect(hostDirectory(join(dir, 'absent')), 'a system without it').toBe(tmpdir());
  });
});

describe('HostTools lookup', () => {
  it('searches the trusted entries of the app PATH first, then the system directories, Homebrew and Docker Desktop', () => {
    const tools = new HostTools({ appPath: ['', 'bin', '.', join(dir, 'a'), '/usr/bin'].join(':') });
    expect(tools.directories(), 'the explicit list, in order, without relative and empty entries').toEqual([join(dir, 'a'), ...SYSTEM_DIRECTORIES, ...INSTALL_DIRECTORIES]);
  });

  it('finds a program on a trusted entry before one in a later directory', () => {
    const first = program(join(dir, 'first'), 'tool');
    program(join(dir, 'second'), 'tool');
    expect(new HostTools({ appPath: `${join(dir, 'first')}:${join(dir, 'second')}` }).find('tool'), 'the first entry').toBe(first);
  });

  it('finds a system program with no PATH at all', () => {
    expect(['/bin/sh', '/usr/bin/sh'], 'the system directory holds sh').toContain(new HostTools({ appPath: '' }).find('sh'));
  });

  it('drops relative and empty entries and the directories of the excluded set, and a link into one', () => {
    program(join(dir, 'agent', 'bin'), 'tool');
    const found = program(join(dir, 'safe'), 'tool');
    const path = [relative(process.cwd(), join(dir, 'agent', 'bin')), '', join(dir, 'agent', 'bin'), join(dir, 'safe')].join(':');
    expect(new HostTools({ appPath: path, excluded: () => [join(dir, 'agent')] }).find('tool'), 'only the safe entry').toBe(found);
    expect(new HostTools({ appPath: path }).find('tool'), 'without the excluded set the agent entry is used').toBe(join(dir, 'agent', 'bin', 'tool'));
  });

  it('adds the directories of one launch to the excluded set', () => {
    program(join(dir, 'checkout', 'bin'), 'tool');
    const tools = new HostTools({ appPath: join(dir, 'checkout', 'bin') });
    expect([tools.find('tool', [join(dir, 'checkout')]), tools.path([join(dir, 'checkout')]).split(':')[0]], 'the checkout entry is not used for this launch').toEqual([undefined, SYSTEM_DIRECTORIES[0]]);
  });

  it('checks a path with a directory part against the excluded set and makes a relative one absolute', () => {
    const file = program(join(dir, 'tools'), 'tool');
    const tools = new HostTools({ excluded: () => [join(dir, 'blocked')] });
    expect([tools.find(file), tools.find(relative(process.cwd(), file))], 'absolute and relative spelling').toEqual([file, file]);
    expect(new HostTools({ excluded: () => [join(dir, 'tools')] }).find(file), 'a path inside an excluded directory').toBeUndefined();
  });

  it('keeps a found program and checks it again before the next use', () => {
    const file = program(join(dir, 'bin'), 'tool');
    let excluded: string[] = [];
    const tools = new HostTools({ appPath: join(dir, 'bin'), excluded: () => excluded });
    expect(tools.find('tool'), 'found').toBe(file);
    rmSync(file);
    expect(tools.find('tool'), 'a removed file is not returned from memory').toBeUndefined();
    program(join(dir, 'bin'), 'tool');
    expect(tools.find('tool'), 'a program installed later is found').toBe(file);
    excluded = [join(dir, 'bin')];
    expect(tools.find('tool'), 'a directory that became excluded is not served from memory').toBeUndefined();
  });

  it('reads the PATH of the app at each lookup when none is given', () => {
    const file = program(join(dir, 'bin'), 'host-tools-probe');
    const saved = process.env['PATH'];
    const tools = new HostTools();
    try {
      process.env['PATH'] = join(dir, 'bin');
      expect(tools.find('host-tools-probe'), 'the PATH of the process now').toBe(file);
    } finally {
      process.env['PATH'] = saved;
    }
    expect(new HostTools().find('host-tools-probe'), 'a new instance does not see the directory once the PATH is back').toBeUndefined();
  });
});

describe('HostTools.require', () => {
  it('names a missing program with a fixed text', () => {
    const tools = new HostTools({ appPath: join(dir, 'none') });
    expect(() => tools.require('host-tools-missing', [], 'the sandbox runtime'), 'the reason').toThrow('the sandbox runtime (host-tools-missing) was not found as an executable on the trusted PATH of the app');
  });

  it('refuses a program that exists only where an agent may write, with a reason that names no path and the path in the detail', () => {
    const planted = program(join(dir, 'agent', 'bin'), 'srt');
    const tools = new HostTools({ appPath: join(dir, 'agent', 'bin'), excluded: () => [join(dir, 'agent')] });
    let error: unknown;
    try {
      tools.require('srt', [], 'the sandbox runtime');
    } catch (thrown) {
      error = thrown;
    }
    expect(error, 'an isolation error').toBeInstanceOf(IsolationError);
    expect((error as IsolationError).message, 'the reason states the rule').toBe('the sandbox runtime (srt) exists only in a directory that an agent may write, so it was not started');
    expect((error as IsolationError).message.includes(dir), 'the reason holds no path').toBe(false);
    expect((error as IsolationError).detail, 'the detail names the file').toBe(planted);
  });

  it('refuseHidden throws for a hidden program and is silent for a missing one and for one that a trusted directory holds', () => {
    program(join(dir, 'agent'), 'node');
    program(join(dir, 'safe'), 'trusted');
    const tools = new HostTools({ appPath: `${join(dir, 'agent')}:${join(dir, 'safe')}`, excluded: () => [join(dir, 'agent')] });
    expect(() => tools.refuseHidden('node'), 'only in the excluded directory').toThrow('exists only in a directory that an agent may write');
    expect(() => tools.refuseHidden('host-tools-missing'), 'not anywhere').not.toThrow();
    expect(() => tools.refuseHidden('trusted'), 'in a trusted directory').not.toThrow();
  });

  it('launch gives the file and a PATH of the trusted entries and the system directories', () => {
    const file = program(join(dir, 'bin'), 'tool');
    const launch = new HostTools({ appPath: ['', join(dir, 'bin'), '.'].join(':') }).launch('tool');
    expect(launch, 'file and PATH').toEqual({ file, path: [join(dir, 'bin'), ...SYSTEM_DIRECTORIES].join(':') });
  });
});

describe('HostTools.execFile', () => {
  it('starts the program that the module found with the trusted PATH and a working directory that holds nothing, whatever the environment says', async () => {
    program(join(dir, 'bin'), 'show', '#!/bin/sh\nprintf "%s|%s|%s" "$PATH" "$PWD" "$KEPT"\n');
    const tools = new HostTools({ appPath: ['', '.', join(dir, 'bin')].join(':') });
    const { error, stdout } = await exec(tools, 'show', [], { env: { PATH: '.:bin:', KEPT: 'yes' } });
    expect(error, 'no error').toBeNull();
    expect(stdout.split('|')[0], 'the PATH of the process is the trusted one').toBe([join(dir, 'bin'), ...SYSTEM_DIRECTORIES].join(':'));
    expect(realpathSync(stdout.split('|')[1]!), 'the working directory is the empty one').toBe(realpathSync(hostDirectory()));
    expect(stdout.split('|')[2], 'the other variables of the caller stay').toBe('yes');
  });

  it('does not run a program of the working directory or of a relative PATH entry', async () => {
    const marker = join(dir, 'marker');
    program(join(dir, 'work'), 'tool', `#!/bin/sh\ntouch '${marker}'\n`);
    const tools = new HostTools({ appPath: ['', '.', 'bin'].join(':') });
    const { error } = await exec(tools, 'tool', [], { cwd: join(dir, 'work'), env: { PATH: '.:bin' } });
    expect(error, 'the program is not found').toBeInstanceOf(IsolationError);
    expect(existsSync(marker), 'nothing ran').toBe(false);
  });

  it('reports a program that is not found through the callback, after the call returns', async () => {
    const order: string[] = [];
    const tools = new HostTools({ appPath: join(dir, 'none') });
    const done = new Promise<void>((resolve) => tools.execFile('host-tools-missing', [], {}, () => { order.push('callback'); resolve(); }));
    order.push('returned');
    await done;
    expect(order, 'the callback is not called before the call returns').toEqual(['returned', 'callback']);
  });

  it('hands an empty buffer to the callback of a failed start of a buffer call', async () => {
    const tools = new HostTools({ appPath: join(dir, 'none') });
    const result = await new Promise<{ stdout: Buffer; stderr: Buffer }>((resolve) => tools.execFileBuffer('host-tools-missing', [], {}, (_error, stdout, stderr) => resolve({ stdout, stderr })));
    expect([result.stdout.length, result.stderr.length], 'two empty buffers').toEqual([0, 0]);
  });

  it('returns the bytes of a buffer call unchanged', async () => {
    program(join(dir, 'bin'), 'bytes', '#!/bin/sh\nprintf "\\377\\376a"\n');
    const bytes = await new Promise<Buffer>((resolve) => new HostTools({ appPath: join(dir, 'bin') }).execFileBuffer('bytes', [], {}, (_error, stdout) => resolve(stdout)));
    expect([...bytes], 'the bytes, not decoded text').toEqual([0xff, 0xfe, 0x61]);
  });

  it('run resolves with the text and rejects with the error and the error output of a failing program', async () => {
    program(join(dir, 'bin'), 'ok', '#!/bin/sh\necho out\n');
    program(join(dir, 'bin'), 'bad', '#!/bin/sh\necho oops >&2\nexit 3\n');
    const tools = new HostTools({ appPath: join(dir, 'bin') });
    expect((await tools.run('ok', [])).stdout, 'the output').toBe('out\n');
    await expect(tools.run('bad', []), 'a failing program').rejects.toMatchObject({ code: 3, stderr: 'oops\n' });
  });

  it('starts a program that is given as a path with the same environment', async () => {
    const file = program(join(dir, 'tools'), 'show', '#!/bin/sh\nprintf "%s" "$PATH"\n');
    const { stdout } = await exec(new HostTools({ appPath: '/usr/bin' }), file, []);
    expect(stdout, 'the trusted PATH').toBe(['/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':'));
  });

  it('adds the directories of the call to the excluded set', async () => {
    const marker = join(dir, 'marker');
    program(join(dir, 'checkout'), 'tool', `#!/bin/sh\ntouch '${marker}'\n`);
    const { error } = await exec(new HostTools({ appPath: join(dir, 'checkout') }), 'tool', [], { excluded: [join(dir, 'checkout')] });
    expect([error instanceof IsolationError, existsSync(marker)], 'refused and not run').toEqual([true, false]);
  });
});

describe('the shared instance', () => {
  it('is replaced for the process and put back', () => {
    const before = hostTools();
    const mine = new HostTools();
    const restore = setHostTools(mine);
    expect(hostTools(), 'the instance that was set').toBe(mine);
    restore();
    expect(hostTools(), 'the previous one again').toBe(before);
  });

  it('is not replaced back by a restore that comes after another set', () => {
    const before = hostTools();
    const restoreFirst = setHostTools(new HostTools());
    const second = new HostTools();
    const restoreSecond = setHostTools(second);
    restoreFirst();
    expect(hostTools(), 'the second instance stays while it is set').toBe(second);
    restoreSecond();
    restoreFirst();
    setHostTools(before);
  });
});
