import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { caseInsensitiveVolume } from './caseProbe';
import { findExecutable, insideArgv, isLoaderVariable, isWithinAny, locateHostBinary, splitLoaderVariables, trustedPath } from './hostLaunch';

let dir: string;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'host-launch-')));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const program = (directory: string, name = 'srt'): string => {
  mkdirSync(directory, { recursive: true });
  const path = join(directory, name);
  writeFileSync(path, '#!/bin/sh\n');
  chmodSync(path, 0o755);
  return path;
};

describe('trustedPath', () => {
  it('keeps absolute entries and drops empty and relative ones, whatever their position', () => {
    expect(trustedPath(['', '/usr/bin', 'bin', '.', '..', './node_modules/.bin', '/bin', ''].join(':')), 'a leading, middle and trailing empty entry and relative entries are gone').toBe('/usr/bin:/bin');
    expect(trustedPath('/usr/bin::/bin'), 'a double colon is an empty entry').toBe('/usr/bin:/bin');
    expect(trustedPath(undefined), 'no PATH is an empty PATH').toBe('');
    expect(trustedPath('/usr/bin:/bin:/usr/bin'), 'a repeated entry stays once').toBe('/usr/bin:/bin');
  });

  it('drops an entry inside an excluded directory in any spelling, and keeps a sibling with the same name prefix', () => {
    const checkout = join(dir, 'checkout');
    mkdirSync(join(checkout, 'bin'), { recursive: true });
    mkdirSync(join(dir, 'checkout-bin'));
    symlinkSync(join(checkout, 'bin'), join(dir, 'link'));
    const entries = [checkout, join(checkout, 'bin'), join(checkout, 'missing', 'deep'), join(dir, 'link'), join(checkout, 'bin', '..', 'bin'), join(dir, 'checkout-bin'), '/usr/bin'];
    expect(trustedPath(entries.join(':'), [checkout]), 'the checkout, below it, a missing path below it, a link into it, a dotted path into it are gone').toBe([join(dir, 'checkout-bin'), '/usr/bin'].join(':'));
    expect(trustedPath(entries.join(':'), [join(dir, 'link')]).split(':'), 'an excluded link covers the directory it points at').not.toContain(join(checkout, 'bin'));
  });
});

describe('isWithinAny', () => {
  it('is true for the directory itself and below it, false for a sibling and a parent', () => {
    const a = join(dir, 'a');
    mkdirSync(join(a, 'b'), { recursive: true });
    expect([a, join(a, 'b'), join(dir, 'ab'), dir].map((path) => isWithinAny(path, [a])), 'itself, below, a sibling with the same prefix, the parent').toEqual([true, true, false, false]);
    expect(isWithinAny(a, []), 'no directories exclude nothing').toBe(false);
  });
});

describe('isWithinAny and the letter case of a volume', () => {
  it.skipIf(!caseInsensitiveVolume())('finds a path below an excluded directory that is spelled in another case, because the volume names one directory', () => {
    mkdirSync(join(dir, 'CaseDir', 'bin'), { recursive: true });
    expect(isWithinAny(join(dir, 'casedir', 'BIN'), [join(dir, 'CaseDir')]), 'the lower-case spelling of the excluded directory').toBe(true);
    expect(isWithinAny(join(dir, 'CASEDIR'), [join(dir, 'casedir', 'bin')]), 'a parent is not inside its child').toBe(false);
    expect(trustedPath(join(dir, 'CASEDIR', 'bin'), [join(dir, 'casedir')]), 'the PATH entry in another case is dropped').toBe('');
  });

  it.skipIf(!caseInsensitiveVolume())('finds a missing path below an existing excluded directory in another case', () => {
    mkdirSync(join(dir, 'CaseDir'));
    expect(isWithinAny(join(dir, 'casedir', 'later', 'bin'), [join(dir, 'CaseDir')]), 'a directory that does not exist yet').toBe(true);
  });

  it('keeps a directory whose name differs in more than its case', () => {
    mkdirSync(join(dir, 'CaseDir'));
    mkdirSync(join(dir, 'CaseDir2'));
    expect(isWithinAny(join(dir, 'CaseDir2'), [join(dir, 'CaseDir')]), 'a sibling with the same prefix').toBe(false);
  });
});

describe('findExecutable', () => {
  it('finds a name on the PATH it is given and takes a path with a directory part as it is', () => {
    const file = program(join(dir, 'bin'));
    expect([findExecutable('srt', join(dir, 'bin')), findExecutable(file), findExecutable(join(dir, 'none')), findExecutable('srt', '')], 'on the PATH, as a path, missing, no PATH').toEqual([file, file, undefined, undefined]);
  });
});

describe('locateHostBinary', () => {
  it('looks a bare name up on the trusted entries only', () => {
    const file = program(join(dir, 'bin'));
    expect(locateHostBinary('srt', ['bin', '', join(dir, 'bin')].join(':')), 'the absolute entry').toBe(file);
    expect(locateHostBinary('srt', relative(process.cwd(), join(dir, 'bin'))), 'the same directory as a relative entry').toBeUndefined();
    expect(locateHostBinary('srt', `:${join(dir, 'bin')}`.replace(join(dir, 'bin'), '')), 'an empty entry only').toBeUndefined();
    expect(locateHostBinary('srt', join(dir, 'bin'), [dir]), 'an entry inside an excluded directory').toBeUndefined();
  });

  it('makes a path with a directory part absolute against the working directory of the app, and refuses one inside an excluded directory', () => {
    const file = program(join(dir, 'tools'));
    expect(locateHostBinary(file, undefined), 'an absolute path needs no PATH').toBe(file);
    expect(locateHostBinary(relative(process.cwd(), file), undefined), 'a relative path is made absolute').toBe(file);
    expect(locateHostBinary(file, undefined, [join(dir, 'tools')]), 'a path inside an excluded directory').toBeUndefined();
    expect(locateHostBinary(join(dir, 'tools', 'missing'), undefined), 'a missing file').toBeUndefined();
  });
});

describe('loader variables', () => {
  it('names NODE_OPTIONS, NODE_PATH and every DYLD_ and LD_ variable and nothing else', () => {
    const names = ['NODE_OPTIONS', 'NODE_PATH', 'DYLD_INSERT_LIBRARIES', 'DYLD_LIBRARY_PATH', 'LD_PRELOAD', 'LD_LIBRARY_PATH'];
    expect(names.map(isLoaderVariable), 'the loader variables').toEqual(names.map(() => true));
    expect(['PATH', 'HOME', 'NODE_ENV', 'NODE_EXTRA_CA_CERTS', 'OLD_PRELOAD', 'LDFLAGS', 'XDYLD_X'].map(isLoaderVariable), 'names that only look like them').toEqual([false, false, false, false, false, false, false]);
  });

  it('splits an environment into the host-side part and the variables for inside the sandbox', () => {
    const { host, inside } = splitLoaderVariables({ PATH: '/p', HOME: '/h', NODE_OPTIONS: '--require ./x.cjs', NODE_PATH: './lib', DYLD_INSERT_LIBRARIES: './x.dylib', LD_PRELOAD: './x.so' });
    expect(host, 'no loader variable stays').toEqual({ PATH: '/p', HOME: '/h' });
    expect(inside, 'the loader variables with their values').toEqual({ NODE_OPTIONS: '--require ./x.cjs', NODE_PATH: './lib', DYLD_INSERT_LIBRARIES: './x.dylib', LD_PRELOAD: './x.so' });
  });
});

describe('insideArgv', () => {
  it('sets the PATH of the profile for the program, verbatim, and removes it when the profile has none', () => {
    expect(insideArgv('a::b:.', ['x', 'y']), 'a PATH with an empty and a relative entry is passed on unchanged').toEqual(['/usr/bin/env', 'PATH=a::b:.', 'x', 'y']);
    expect(insideArgv(undefined, ['x']), 'no PATH').toEqual(['/usr/bin/env', '-u', 'PATH', 'x']);
    expect(insideArgv('/p', ['x'], { NODE_OPTIONS: '--a b', LD_PRELOAD: 'l' }), 'the variables for the program come after the PATH and before the program').toEqual(['/usr/bin/env', 'PATH=/p', 'NODE_OPTIONS=--a b', 'LD_PRELOAD=l', 'x']);
  });
});
