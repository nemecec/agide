import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ANTHROPIC_HOSTS, buildSrtSettings, buildToolSrtSettings, claudeTempDir, DEVELOPMENT_HOSTS, srtAllowedDomains } from './srtSettings';

const base = { writeDirs: ['/work/project'], claudeConfigDir: '/data/claude', network: { mode: 'unrestricted' } as const, home: '/home/u', uid: 501, platform: 'darwin' as const };

describe('buildSrtSettings', () => {
  it('sets the keys the TUI and the loopback MCP server need', () => {
    const settings = buildSrtSettings(base);
    expect(settings.allowPty, 'pseudo-terminal ioctls allowed').toBe(true);
    expect(settings.network.allowLocalBinding, 'loopback allowed for the app MCP server').toBe(true);
  });

  it('allows writes to the workspace, the Claude directory and the CLI temp directory of the platform', () => {
    const { allowWrite } = buildSrtSettings(base).filesystem;
    expect(allowWrite, 'write paths').toEqual(expect.arrayContaining(['/work/project', '/data/claude', '/private/tmp/claude-501']));
    expect(buildSrtSettings({ ...base, platform: 'linux' }).filesystem.allowWrite, 'Linux temp directory').toContain('/tmp/claude-501');
    expect(claudeTempDir(7, 'darwin'), 'macOS temp directory').toBe('/private/tmp/claude-7');
  });

  it('writes the profile Claude directory only, and the default login files only when the profile has none', () => {
    expect(buildSrtSettings(base).filesystem.allowWrite, 'profile directory excludes the user files').not.toContain('/home/u/.claude.json');
    const cliDefault = buildSrtSettings({ ...base, claudeConfigDir: undefined }).filesystem.allowWrite;
    expect(cliDefault, 'CLI default login files').toEqual(expect.arrayContaining(['/home/u/.claude', '/home/u/.claude.json']));
  });

  it('denies writes to the settings, instructions, commands, agents, skills and plugins of the Claude directory', () => {
    const { denyWrite, allowWrite } = buildSrtSettings(base).filesystem;
    expect(denyWrite, 'protected entries of the profile directory').toEqual(
      expect.arrayContaining(['/data/claude/settings.json', '/data/claude/settings.local.json', '/data/claude/CLAUDE.md', '/data/claude/commands', '/data/claude/agents', '/data/claude/skills', '/data/claude/plugins', '/data/claude/hooks']),
    );
    expect(allowWrite, 'the directory itself stays writable for transcripts').toContain('/data/claude');
    expect(denyWrite, 'transcripts are not denied').not.toContain('/data/claude/projects');
    expect(buildSrtSettings({ ...base, claudeConfigDir: undefined }).filesystem.denyWrite, 'default directory of the user').toEqual(expect.arrayContaining(['/home/u/.claude/settings.json', '/home/u/.claude/CLAUDE.md']));
  });

  it('adds extra write and deny-read paths and leaves reads open otherwise', () => {
    const { filesystem } = buildSrtSettings({ ...base, extraWritePaths: ['/cache'], extraDenyRead: ['/secrets'] });
    expect(filesystem.allowWrite, 'extra write path').toContain('/cache');
    expect(filesystem.denyRead, 'extra deny-read path').toEqual(['/secrets']);
    expect(buildSrtSettings(base).filesystem.denyRead, 'no deny-read by default').toEqual([]);
  });

  it('allows the resolved form of a workspace that is a link, because Seatbelt matches resolved paths', () => {
    const { allowWrite } = buildSrtSettings({ ...base, writeDirs: ['/tmp'] }).filesystem;
    expect(allowWrite, 'tmp and its target').toEqual(expect.arrayContaining(['/tmp', '/private/tmp']));
  });
});

describe('srtAllowedDomains', () => {
  it('always allows the Anthropic hosts and loopback and adds the policy hosts with their ports', () => {
    const domains = srtAllowedDomains({ mode: 'allowlist', allow: [{ host: 'example.com' }, { host: 'api.example.org', port: 8443 }] });
    expect(domains, 'Anthropic hosts').toEqual(expect.arrayContaining([...ANTHROPIC_HOSTS, '127.0.0.1']));
    expect(domains, 'policy hosts').toEqual(expect.arrayContaining(['example.com', 'api.example.org:8443']));
    expect(domains, 'no development hosts outside an unrestricted policy').not.toContain('github.com');
  });

  it('uses the development hosts for an unrestricted policy, because srt has no allow-everything entry', () => {
    expect(srtAllowedDomains({ mode: 'unrestricted' }), 'development hosts').toEqual(expect.arrayContaining([...DEVELOPMENT_HOSTS]));
  });
});

describe('buildToolSrtSettings', () => {
  it('denies reads for each path in both spellings, since Seatbelt matches resolved paths', () => {
    const dir = mkdtempSync(join(tmpdir(), 'srt-deny-'));
    try {
      mkdirSync(join(dir, 'data'));
      const link = join(dir, 'link');
      symlinkSync(dir, link);
      const settings = buildToolSrtSettings({ writeDirs: ['/work'], network: 'none', loopback: false, extraDenyRead: [join(link, 'data'), '/does/not/exist'] });
      expect(new Set(settings.filesystem.denyRead), 'the link spelling, the resolved spelling and a path that does not exist').toEqual(new Set([join(link, 'data'), join(realpathSync(dir), 'data'), '/does/not/exist']));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('denies nothing without entries and allows no host for network none', () => {
    const settings = buildToolSrtSettings({ writeDirs: ['/work'], network: 'none', loopback: false });
    expect([settings.filesystem.denyRead, settings.network.allowedDomains], 'no deny entries and no hosts').toEqual([[], []]);
  });

  it('allows loopback binding, which srt pairs with connections to every loopback port, only when the program needs it', () => {
    expect(buildToolSrtSettings({ writeDirs: ['/work'], network: 'none', loopback: false }).network.allowLocalBinding, 'a program without loopback binding').toBe(false);
    expect(buildToolSrtSettings({ writeDirs: ['/work'], network: 'development', loopback: false }).network.allowLocalBinding, 'the development hosts do not open loopback').toBe(false);
    expect(buildToolSrtSettings({ writeDirs: ['/work'], network: 'none', loopback: true }).network.allowLocalBinding, 'a program that binds a loopback port').toBe(true);
  });
});
