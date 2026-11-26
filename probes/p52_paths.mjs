// README: P52. Path rules for a mount on macOS: real paths (/tmp is /private/tmp), symlinks that leave the mount,
// links inside it, dangling links, case and Unicode spellings on APFS, hard links, FIFOs and devices, O_NOFOLLOW,
// a parent directory swapped for a link between the check and the open, the check by (dev, ino) after the open,
// an atomic write that meets a link, and the cost of reading large files and of telling text from binary.
// Output: probes/out/p52_paths_<runtime>.json.
import { closeSync, constants, fstatSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync, writeSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative, sep, isAbsolute, normalize } from 'node:path';
import { removeDir, runtimeFacts, runtimeLabel, tempDir, writeOut } from './p_notes_lib.mjs';

/** The rule under test: the real path of the target must be the real root or lie below it, and be a file or directory. */
function resolveInside(realRoot, relativePath) {
  if (isAbsolute(relativePath)) return { ok: false, reason: 'absolute' };
  const joined = normalize(join(realRoot, relativePath));
  if (joined !== realRoot && !joined.startsWith(realRoot + sep)) return { ok: false, reason: 'lexical escape' };
  let real;
  try {
    real = realpathSync.native(joined);
  } catch (error) {
    return { ok: false, reason: `realpath ${error.code}` };
  }
  if (real !== realRoot && !real.startsWith(realRoot + sep)) return { ok: false, reason: 'leaves the mount', real };
  const stat = statSync(real);
  if (!stat.isFile() && !stat.isDirectory()) return { ok: false, reason: 'not a regular file or directory', real };
  return { ok: true, real, viaLink: lstatSync(joined).isSymbolicLink(), nlink: stat.nlink };
}

/** Opens with O_NOFOLLOW and confirms that the descriptor is the file the real path names now. */
function openChecked(realRoot, relativePath) {
  const verdict = resolveInside(realRoot, relativePath);
  if (!verdict.ok) return verdict;
  let fd;
  try {
    fd = openSync(verdict.real, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    return { ok: false, reason: `open ${error.code}` };
  }
  try {
    const opened = fstatSync(fd);
    const again = resolveInside(realRoot, relativePath);
    if (!again.ok) return { ok: false, reason: `after open: ${again.reason}` };
    const now = statSync(again.real);
    if (now.dev !== opened.dev || now.ino !== opened.ino) return { ok: false, reason: 'changed between check and open' };
    if (!opened.isFile()) return { ok: false, reason: 'descriptor is not a regular file' };
    return { ok: true, size: opened.size };
  } finally {
    closeSync(fd);
  }
}

function looksBinary(path) {
  const fd = openSync(path, 'r');
  const buffer = Buffer.alloc(8192);
  const read = readSync(fd, buffer, 0, buffer.length, 0);
  closeSync(fd);
  const head = buffer.subarray(0, read);
  if (head.includes(0)) return 'binary (NUL byte)';
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(head);
    return 'text';
  } catch {
    return 'binary (not UTF-8)';
  }
}

function main() {
  const base = tempDir('p52');
  const root = join(base, 'mount');
  const outside = join(base, 'outside');
  mkdirSync(join(root, 'sub'), { recursive: true });
  mkdirSync(outside);
  writeFileSync(join(root, 'a.md'), '# a\n');
  writeFileSync(join(root, 'sub', 'b.md'), '# b\n');
  writeFileSync(join(outside, 'secret.md'), 'secret\n');
  symlinkSync(join(outside, 'secret.md'), join(root, 'link-file-out.md'));
  symlinkSync(outside, join(root, 'link-dir-out'));
  symlinkSync(join(root, 'a.md'), join(root, 'link-in.md'));
  symlinkSync('sub', join(root, 'link-dir-in'));
  symlinkSync(join(root, 'link-file-out.md'), join(root, 'chain.md'));
  symlinkSync(join(root, 'missing.md'), join(root, 'dangling.md'));
  symlinkSync('/dev/zero', join(root, 'dev-zero'));
  linkSync(join(outside, 'secret.md'), join(root, 'hardlink-out.md'));
  execFileSync('/usr/bin/mkfifo', [join(root, 'fifo')]);
  const nfd = 'café.md';
  writeFileSync(join(root, nfd), 'nfd\n');

  const realRoot = realpathSync.native(root);
  const facts = { ...runtimeFacts(), givenRoot: root, realRoot, rootDiffers: root !== realRoot, caseSensitiveVolume: (() => { try { statSync(join(root, 'A.MD')); return false; } catch { return true; } })() };

  const cases = {};
  for (const name of ['a.md', 'sub/b.md', 'link-file-out.md', 'link-dir-out/secret.md', 'link-in.md', 'link-dir-in/b.md', 'chain.md', 'dangling.md', 'dev-zero', 'hardlink-out.md', 'fifo', '../outside/secret.md', 'sub/../../outside/secret.md', '/etc/hosts', 'A.MD', 'SUB/B.md', 'café.md', nfd]) {
    cases[name] = resolveInside(realRoot, name);
  }
  cases['realpath of A.MD (case spelling returned)'] = (() => { try { return realpathSync.native(join(realRoot, 'A.MD')); } catch (e) { return e.code; } })();
  cases['realpath (JS) of A.MD'] = (() => { try { return realpathSync(join(realRoot, 'A.MD')); } catch (e) { return e.code; } })();
  cases['readdir spelling of the NFD name'] = JSON.stringify(execFileSync('/bin/ls', [realRoot]).toString().split('\n').filter((n) => n.startsWith('caf')).map((n) => n.normalize('NFC') === n ? 'NFC' : 'NFD'));

  const opens = {};
  for (const name of ['a.md', 'link-in.md', 'fifo', 'dev-zero', 'link-file-out.md']) opens[name] = openChecked(realRoot, name);
  opens['O_NOFOLLOW on a link'] = (() => { try { closeSync(openSync(join(realRoot, 'link-in.md'), constants.O_RDONLY | constants.O_NOFOLLOW)); return 'opened'; } catch (e) { return e.code; } })();
  opens['O_NOFOLLOW with a link in a parent component'] = (() => { try { closeSync(openSync(join(realRoot, 'link-dir-out', 'secret.md'), constants.O_RDONLY | constants.O_NOFOLLOW)); return 'opened (parent links are followed)'; } catch (e) { return e.code; } })();

  // The race: the check sees a real directory, then the directory is swapped for a link to the outside before the open.
  const race = {};
  mkdirSync(join(realRoot, 'swap'));
  writeFileSync(join(realRoot, 'swap', 'secret.md'), 'inside\n');
  const checked = resolveInside(realRoot, 'swap/secret.md');
  renameSync(join(realRoot, 'swap'), join(realRoot, 'swap-old'));
  symlinkSync(outside, join(realRoot, 'swap'));
  race.checkBeforeSwap = checked.ok;
  race.plainOpenAfterSwapReads = readFileSync(checked.real.replace(realRoot, realRoot), 'utf8').trim();
  race.plainOpenOfCheckedRealPath = (() => { try { return readFileSync(join(realRoot, 'swap', 'secret.md'), 'utf8').trim(); } catch (e) { return e.code; } })();
  race.openCheckedAfterSwap = openChecked(realRoot, 'swap/secret.md');

  // An atomic write (temporary file and rename) whose target is a link: rename replaces the link and does not write through it.
  const write = {};
  const target = join(realRoot, 'link-file-out.md');
  const tmp = join(realRoot, '.link-file-out.md.agide-tmp');
  const fd = openSync(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o644);
  writeSync(fd, 'written by the app\n');
  closeSync(fd);
  renameSync(tmp, target);
  write.targetIsLinkAfter = lstatSync(target).isSymbolicLink();
  write.outsideFileAfter = readFileSync(join(outside, 'secret.md'), 'utf8').trim();
  write.exclusiveCreateOverExistingLink = (() => { symlinkSync(join(outside, 'secret.md'), join(realRoot, 'trap')); try { openSync(join(realRoot, 'trap'), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW); return 'opened'; } catch (e) { return e.code; } })();
  write.hardLinkWriteInPlace = 'a write in place to hardlink-out.md would change the outside file; nlink > 1 is the only sign';

  // Large files: stat first, then read.
  const large = {};
  for (const megabytes of [1, 10, 50]) {
    const path = join(realRoot, `large-${megabytes}.md`);
    writeFileSync(path, Buffer.alloc(megabytes * 1024 * 1024, 'a'));
    const t0 = performance.now();
    const size = statSync(path).size;
    const statMs = performance.now() - t0;
    const t1 = performance.now();
    const text = readFileSync(path, 'utf8');
    const readMs = performance.now() - t1;
    const t2 = performance.now();
    let lines = 0;
    for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) lines += 1;
    large[`${megabytes} MB`] = { size, statMs: Math.round(statMs * 100) / 100, readUtf8Ms: Math.round(readMs), scanMs: Math.round(performance.now() - t2) };
  }
  const binary = {};
  writeFileSync(join(realRoot, 'image.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0x0d]));
  writeFileSync(join(realRoot, 'latin1.txt'), Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]));
  writeFileSync(join(realRoot, 'utf8.md'), 'õäöü 日本\n');
  for (const name of ['image.png', 'latin1.txt', 'utf8.md', 'a.md']) binary[name] = looksBinary(join(realRoot, name));

  rmSync(join(realRoot, 'fifo'));
  removeDir(base);
  console.log(writeOut(`p52_paths_${runtimeLabel()}.json`, { facts, cases, opens, race, write, large, binary, relativeExample: relative(realRoot, join(realRoot, 'sub', 'b.md')) }));
}

main();
