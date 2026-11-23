import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findExecutable, hostLaunch, insideArgv, isWithinAny, locateHostBinary, neutralDirectory, trustedPath } from './hostLaunch';
import { IsolationError } from './types';

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

describe('hostLaunch', () => {
  it('returns the absolute file and the trusted PATH of the app', () => {
    const file = program(join(dir, 'bin'));
    expect(hostLaunch('srt', ['bin', '', join(dir, 'bin'), '/usr/bin', '.'].join(':'), []), 'the file and the PATH without the relative and empty entries').toEqual({ file, path: `${join(dir, 'bin')}:/usr/bin` });
  });

  it('refuses when no trusted entry holds the program', () => {
    program(join(dir, 'checkout'));
    expect(() => hostLaunch('srt', `${join(dir, 'checkout')}:checkout:`, [join(dir, 'checkout')]), 'the only srt is in the checkout').toThrow(IsolationError);
  });
});

describe('insideArgv', () => {
  it('sets the PATH of the profile for the program, verbatim, and removes it when the profile has none', () => {
    expect(insideArgv('a::b:.', ['x', 'y']), 'a PATH with an empty and a relative entry is passed on unchanged').toEqual(['/usr/bin/env', 'PATH=a::b:.', 'x', 'y']);
    expect(insideArgv(undefined, ['x']), 'no PATH').toEqual(['/usr/bin/env', '-u', 'PATH', 'x']);
  });
});

describe('neutralDirectory', () => {
  it('is the empty system directory when there is one', () => {
    expect(neutralDirectory(join(dir, 'root'), dir), 'the directory it is given as the system one').toBe(dir);
  });

  it('makes a private empty directory below the fallback root when the system has none', () => {
    const made = neutralDirectory(join(dir, 'root'), join(dir, 'absent'));
    expect([made, statSync(made).mode & 0o777], 'below the root, mode 0700').toEqual([join(dir, 'root', '.cwd'), 0o700]);
    expect(neutralDirectory(join(dir, 'root'), join(dir, 'absent')), 'the same directory the second time').toBe(made);
  });
});
