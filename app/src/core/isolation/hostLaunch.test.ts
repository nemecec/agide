import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { caseInsensitiveVolume } from './caseProbe';
import { findExecutable, INSIDE_PREFIX, insideRoute, isHostSideVariable, isWithinAny, splitHostVariables, trustedPath } from './hostLaunch';

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

const dataVolume = process.platform === 'darwin' && existsSync('/System/Volumes/Data/private');

describe('isWithinAny and the firmlinks of the data volume', () => {

  it.skipIf(!dataVolume)('treats a path through /System/Volumes/Data and the same path without it as one place, in either role', () => {
    const excluded = join(dir, 'agide');
    mkdirSync(join(excluded, 'x', 'bin'), { recursive: true });
    const viaData = (path: string): string => `/System/Volumes/Data${path.startsWith('/private/') ? path : `/private${path}`}`;
    expect(existsSync(viaData(join(excluded, 'x', 'bin'))), 'the data volume spelling names an existing directory').toBe(true);
    expect(isWithinAny(viaData(join(excluded, 'x', 'bin')), [excluded]), 'a candidate spelled through the data volume').toBe(true);
    expect(isWithinAny(join(excluded, 'x', 'bin'), [viaData(excluded)]), 'an excluded directory spelled through the data volume').toBe(true);
    expect(isWithinAny(viaData(join(dir, 'other')), [excluded]), 'a sibling stays outside').toBe(false);
    expect(trustedPath(`${viaData(join(excluded, 'x', 'bin'))}:/usr/bin`, [excluded]), 'the PATH entry is dropped').toBe('/usr/bin');
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

describe('the variables of the host-side process of srt', () => {
  it('keeps the identity and locale of the user, the temporary directory and the names srt reads or sets', () => {
    const kept = ['HOME', 'USER', 'LOGNAME', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'SRT_DEBUG', 'CLAUDE_CODE_TMPDIR', 'CLAUDE_TMPDIR', 'HTTPS_proxy'.toLowerCase(), 'HTTP_PROXY', 'NO_PROXY', 'NODE_EXTRA_CA_CERTS', 'JAVA_TOOL_OPTIONS', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_3'];
    expect(kept.map(isHostSideVariable), 'each of these stays on the host side').toEqual(kept.map(() => true));
  });

  it('does not keep a variable that makes a shell or Node run code before or while the program starts, or any name it does not know', () => {
    const inside = ['BASH_FUNC_uname%%', 'BASH_FUNC_x%%', 'SHELLOPTS', 'BASHOPTS', 'PS4', 'ENV', 'BASH_ENV', 'CDPATH', 'IFS', 'PROMPT_COMMAND', 'NODE_OPTIONS', 'NODE_PATH', 'DYLD_INSERT_LIBRARIES', 'LD_PRELOAD', 'GIT_EXEC_PATH', 'ANYTHING_ELSE', 'LDFLAGS'];
    expect(inside.map(isHostSideVariable), 'each of these goes inside the sandbox').toEqual(inside.map(() => false));
  });

  it('splits an environment into the host-side part and the variables for inside the sandbox, the PATH of the profile among them', () => {
    const { host, inside } = splitHostVariables({ PATH: '/p', HOME: '/h', LC_ALL: 'C', 'BASH_FUNC_uname%%': '() { ./x; }', SHELLOPTS: 'xtrace', PS4: '$(./x)', NODE_OPTIONS: '--require ./x.cjs', MY_TOKEN_NAME: 'v' });
    expect(host, 'the allowed names only, without PATH').toEqual({ HOME: '/h', LC_ALL: 'C' });
    expect(inside, 'every other variable with its value').toEqual({ PATH: '/p', 'BASH_FUNC_uname%%': '() { ./x; }', SHELLOPTS: 'xtrace', PS4: '$(./x)', NODE_OPTIONS: '--require ./x.cjs', MY_TOKEN_NAME: 'v' });
  });
});

describe('insideRoute', () => {
  it('carries each value under the prefix and names it, and drops what the launcher shell cannot set', () => {
    const route = insideRoute({ PATH: 'a::b:.', NODE_OPTIONS: '--a b', 'BASH_FUNC_f%%': '() { :; }', SHELLOPTS: 'xtrace', _: '/x', 'A-B': '1', AGIDE_INSIDE_NAMES: 'X', AGIDE_INSIDE: 'y', lower_case: 'v' });
    expect(route.carriers, 'the values under the prefix, nothing else').toEqual({ [`${INSIDE_PREFIX}PATH`]: 'a::b:.', [`${INSIDE_PREFIX}NODE_OPTIONS`]: '--a b', [`${INSIDE_PREFIX}lower_case`]: 'v' });
    expect(route.names, 'the names the launcher sets').toEqual(['PATH', 'NODE_OPTIONS', 'lower_case']);
    expect(route.dropped, 'an exported function, a read-only name of bash, a name bash sets, a name with a dash and the names of the route itself').toEqual(['BASH_FUNC_f%%', 'SHELLOPTS', '_', 'A-B', 'AGIDE_INSIDE_NAMES', 'AGIDE_INSIDE']);
  });

  it('drops the DYLD_ names on macOS, which the protected programs of the route remove, and carries them elsewhere', () => {
    const env = { DYLD_INSERT_LIBRARIES: './x.dylib', DYLD_LIBRARY_PATH: '/l', LD_PRELOAD: './x.so' };
    const mac = insideRoute(env, 'darwin');
    expect([mac.dropped, mac.names, Object.keys(mac.carriers)], 'on macOS: both DYLD_ names dropped, no carrier for them').toEqual([['DYLD_INSERT_LIBRARIES', 'DYLD_LIBRARY_PATH'], ['LD_PRELOAD'], [`${INSIDE_PREFIX}LD_PRELOAD`]]);
    expect(insideRoute(env, 'linux').names, 'on Linux every name is carried').toEqual(['DYLD_INSERT_LIBRARIES', 'DYLD_LIBRARY_PATH', 'LD_PRELOAD']);
  });
});
