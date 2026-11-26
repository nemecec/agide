import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { agentWritableDirectories, claudeTempDir, sessionWriteAllowances, srtDefaultWritePaths } from './agentWritable';
import { isWithinAny } from './hostLaunch';
import { buildSrtSettings } from './srtSettings';

const base = { writeDirs: ['/work/project', '/work/inbox'], claudeConfigDir: '/data/claude', home: '/home/u', uid: 501, platform: 'darwin' as const };

let dir: string;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'agent-writable-')));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('sessionWriteAllowances', () => {
  it('holds the launch directories, the Claude configuration, the CLI temp directory and the extra write paths, in this order', () => {
    expect(sessionWriteAllowances({ ...base, extraWritePaths: ['/cache'] }), 'the parts of the allowance').toEqual(['/work/project', '/work/inbox', '/data/claude', '/private/tmp/claude-501', '/cache']);
  });

  it('names the default login files when the profile has no Claude configuration directory', () => {
    expect(sessionWriteAllowances({ ...base, claudeConfigDir: undefined }), 'the CLI default').toEqual(expect.arrayContaining(['/home/u/.claude', '/home/u/.claude.json']));
    expect(claudeTempDir(7, 'linux'), 'the Linux temp directory').toBe('/tmp/claude-7');
  });
});

describe('srtDefaultWritePaths', () => {
  it('names what srt makes writable whatever its settings say: /tmp/claude, /private/tmp/claude, ~/.npm/_logs and ~/.claude/debug (sandbox-utils.js of 0.0.83)', () => {
    expect(srtDefaultWritePaths('/home/u'), 'SANDBOX_OWN_WRITE_PATHS and HOME_CONVENIENCE_WRITE_DIRS').toEqual(['/tmp/claude', '/private/tmp/claude', '/home/u/.npm/_logs', '/home/u/.claude/debug']);
  });
});

describe('agentWritableDirectories', () => {
  it('adds the defaults of srt and the roots of the agents to the allowances of a session', () => {
    const set = agentWritableDirectories({ ...base, extraWritePaths: ['/cache'], agentRoots: ['/home/u/Agide'] });
    expect(set, 'allowances, srt defaults, agent roots').toEqual(expect.arrayContaining(['/work/project', '/data/claude', '/private/tmp/claude-501', '/cache', '/tmp/claude', '/private/tmp/claude', '/home/u/.npm/_logs', '/home/u/.claude/debug', '/home/u/Agide']));
  });

  it('holds every path that buildSrtSettings lets a session write, in both spellings, so the settings and the host-side lookup cannot drift', () => {
    mkdirSync(join(dir, 'real', 'work'), { recursive: true });
    symlinkSync(join(dir, 'real'), join(dir, 'linked'));
    const input = { writeDirs: [join(dir, 'linked', 'work')], claudeConfigDir: join(dir, 'claude'), extraWritePaths: [join(dir, 'cache')], home: dir, uid: 501, platform: 'darwin' as const };
    const set = agentWritableDirectories(input);
    const { allowWrite } = buildSrtSettings({ ...input, network: { mode: 'unrestricted' } }).filesystem;
    expect(allowWrite.length, 'the settings allow something').toBeGreaterThan(0);
    for (const path of allowWrite) expect(isWithinAny(path, set), `${path} is allowed by the settings and excluded from the host-side lookup`).toBe(true);
    expect(allowWrite, 'the link and its target are both allowed').toEqual(expect.arrayContaining([join(dir, 'linked', 'work'), join(dir, 'real', 'work')]));
  });

  it('holds the default login directory when the profile names none', () => {
    const input = { writeDirs: [], claudeConfigDir: undefined, home: dir, uid: 501, platform: 'darwin' as const };
    const set = agentWritableDirectories(input);
    for (const path of buildSrtSettings({ ...input, network: { mode: 'unrestricted' } }).filesystem.allowWrite) expect(isWithinAny(path, set), `${path} is excluded`).toBe(true);
  });

  it('lists a directory once', () => {
    const set = agentWritableDirectories({ ...base, writeDirs: ['/data/claude', '/data/claude'], agentRoots: ['/data/claude'] });
    expect(set.filter((path) => path === '/data/claude'), 'one entry').toHaveLength(1);
  });
});
