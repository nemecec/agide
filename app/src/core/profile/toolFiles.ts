import { dirname } from 'node:path';
import type { ProfilePaths } from './paths';
import { ensureDir, writeFileAtomic } from './fsio';
import { ProfileError, type ProfileSettings } from './types';

const hasControlCharacter = (value: string): boolean => [...value].some((char) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f);

function assertSingleLine(label: string, value: string): void {
  if (hasControlCharacter(value)) throw new ProfileError('invalid', `${label} holds a control character`);
}

/** A git config value in double quotes. */
const gitQuote = (value: string): string => `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;

/** A word for a POSIX shell in single quotes. */
const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

/** An ssh_config argument in double quotes. */
const sshQuote = (value: string): string => `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;

/** `GIT_CONFIG_GLOBAL` of an isolated profile (design 0022 section 1). */
export function renderGitConfig(settings: ProfileSettings, paths: ProfilePaths): string {
  const lines = ['[user]', '\tuseConfigOnly = true'];
  if (settings.tools.mode === 'isolated' && settings.tools.git) {
    const { userName, userEmail } = settings.tools.git;
    assertSingleLine('git user name', userName);
    assertSingleLine('git user e-mail', userEmail);
    lines.push(`\tname = ${gitQuote(userName)}`, `\temail = ${gitQuote(userEmail)}`);
  }
  assertSingleLine('ssh config path', paths.tools.sshConfig);
  lines.push(
    '[credential]',
    // An empty entry clears the helpers of the system file, such as the macOS Keychain helper.
    '\thelper =',
    '\thelper = !gh auth git-credential',
    '[core]',
    `\tsshCommand = ${gitQuote(`ssh -F ${shellQuote(paths.tools.sshConfig)}`)}`,
  );
  return `${lines.join('\n')}\n`;
}

/**
 * The file `ssh -F` reads. `IdentitiesOnly` alone does not stop ssh from offering the default key files, so a
 * profile without a key names an identity file that does not exist.
 */
export function renderSshConfig(settings: ProfileSettings, paths: ProfilePaths): string {
  const ssh = settings.tools.mode === 'isolated' ? settings.tools.ssh : undefined;
  const socket = ssh ? ssh.agentSocket : 'none';
  const identityFile = ssh ? ssh.publicKeyFile : `${dirname(paths.tools.sshConfig)}/no-identity`;
  for (const value of [socket, identityFile]) assertSingleLine('ssh config value', value);
  return ['Host *', `\tIdentityAgent ${ssh ? sshQuote(socket) : 'none'}`, `\tIdentityFile ${sshQuote(identityFile)}`, '\tIdentitiesOnly yes', ''].join('\n');
}

/** Creates the tool directories and writes the generated files of an isolated profile. */
export function writeToolFiles(settings: ProfileSettings, paths: ProfilePaths): void {
  if (settings.tools.mode !== 'isolated') return;
  for (const dir of [dirname(paths.tools.gitconfig), paths.tools.gh, paths.tools.docker, dirname(paths.tools.awsConfig)]) ensureDir(dir);
  writeFileAtomic(paths.tools.gitconfig, renderGitConfig(settings, paths));
  writeFileAtomic(paths.tools.sshConfig, renderSshConfig(settings, paths));
}
