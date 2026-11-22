import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/** Temporary repositories and the agent turn of probe P42 (`notes/probes-m5-review.md`) for the capture tests. */

const AUTHOR = { GIT_AUTHOR_NAME: 'fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' };

/** Plain git for fixtures: the safe switches, no hooks and no signing. */
export function sh(cwd: string, args: readonly string[], env: Record<string, string> = {}): string {
  const result = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'core.fsmonitor=false', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', ...AUTHOR, ...env },
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout;
}

export function write(path: string, content: string | Buffer, mode?: number): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, mode === undefined ? undefined : { mode });
}

export const numbered = (count: number, line: (index: number) => string): string => Array.from({ length: count }, (_, index) => line(index)).join('\n') + '\n';

export interface Repo {
  readonly root: string;
  readonly main: string;
  readonly commonDir: string;
  readonly base: string;
  /** A worktree of the repository on a branch of its own, as a swarm agent has one. */
  worktree(name: string): string;
  cleanup(): void;
}

const created: string[] = [];

/** A temporary directory that `removeTempDirs` removes. */
export function tempDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `agide-${label}-`));
  created.push(dir);
  return dir;
}

export function removeTempDirs(): void {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/** A repository with one commit made of `files`. */
export function makeRepo(files: Record<string, string | Buffer>, label = 'cap'): Repo {
  const root = tempDir(label);
  const main = join(root, 'main');
  mkdirSync(main);
  sh(main, ['init', '-q', '-b', 'main']);
  for (const [path, content] of Object.entries(files)) write(join(main, path), content);
  sh(main, ['add', '-A']);
  sh(main, ['commit', '-q', '--no-verify', '-m', 'base']);
  const base = sh(main, ['rev-parse', 'HEAD']).trim();
  const commonDir = join(main, '.git');
  return {
    root,
    main,
    commonDir,
    base,
    worktree(name) {
      const path = join(root, name);
      sh(main, ['worktree', 'add', '-q', '-b', `agide/${name}`, path, base]);
      return path;
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

export const ODD_NAMES = ['sp ace.txt', 'tab\there.txt', 'ünï-çødé.txt', 'q"uote.txt', 'new\nline.txt', '-dash.txt', 'back\\slash.txt', 'dir with space/inner file.txt', '日本語.txt'];

export function seedP42(main: string): void {
  write(join(main, 'edit.txt'), numbered(40, (i) => `line ${i}`));
  write(join(main, 'del.txt'), numbered(10, (i) => `del ${i}`));
  write(join(main, 'rename-me.txt'), numbered(30, (i) => `rename content ${i}`));
  write(join(main, 'mode.sh'), '#!/bin/sh\necho hi\n');
  write(join(main, 'crlf.txt'), 'a\r\nb\r\nc\r\n');
  write(join(main, 'noeol.txt'), 'no newline at end');
  write(join(main, 'bin-old.dat'), randomBytes(2048));
  write(join(main, 'typechange'), 'plain file\n');
}

/** What the agent of P42 did in its turn: edit, add, delete, rename with an edit, chmod, binary, symlink, empty, CRLF, odd names, header-like content and a large file. */
export function agentTurn(dir: string, largeLines = 20_000): void {
  const at = (file: string): string => join(dir, file);
  writeFileSync(at('edit.txt'), numbered(40, (i) => (i % 7 === 0 ? `line ${i} edited` : `line ${i}`)));
  write(at('new.txt'), 'brand new\n');
  rmSync(at('del.txt'));
  renameSync(at('rename-me.txt'), at('renamed.txt'));
  writeFileSync(at('renamed.txt'), numbered(30, (i) => (i === 5 ? 'rename content 5 changed' : `rename content ${i}`)));
  chmodSync(at('mode.sh'), 0o755);
  writeFileSync(at('bin-old.dat'), randomBytes(4096));
  write(at('bin-new.dat'), Buffer.concat([Buffer.from([0, 1, 2, 3]), randomBytes(1000)]));
  symlinkSync('edit.txt', at('link-to-edit'));
  write(at('empty.txt'), '');
  write(at('crlf.txt'), 'a\r\nB\r\nc\r\n');
  write(at('noeol.txt'), 'no newline at end, edited');
  rmSync(at('typechange'));
  symlinkSync('edit.txt', at('typechange'));
  write(at('tricky-content.txt'), ['normal', '+++ b/fake.txt', '--- a/fake.txt', 'diff --git a/fake.txt b/fake.txt', '@@ -1,1 +1,1 @@', 'index 000..111', ' trailing'].join('\n') + '\n');
  for (const name of ODD_NAMES) write(at(name), `content of ${JSON.stringify(name)}\n`);
  write(at('large.txt'), numbered(largeLines, (i) => `large file line number ${i} with some padding text to make it longer`));
}

export const exists = (path: string): boolean => existsSync(path);

/** The names `git diff -z --raw` reports, never quoted: the truth the parser is compared with. */
export function rawTruth(repo: string, base: string, checkpoint: string): { status: string; oldPath: string | null; newPath: string | null }[] {
  const parts = sh(repo, ['diff', '-z', '--raw', '--find-renames', base, checkpoint]).split('\0');
  const files: { status: string; oldPath: string | null; newPath: string | null }[] = [];
  for (let i = 0; i < parts.length - 1; ) {
    const status = parts[i++]!.split(' ').pop()![0]!;
    if (status === 'R' || status === 'C') files.push({ status, oldPath: parts[i++]!, newPath: parts[i++]! });
    else {
      const path = parts[i++]!;
      files.push({ status, oldPath: status === 'A' ? null : path, newPath: status === 'D' ? null : path });
    }
  }
  return files;
}
