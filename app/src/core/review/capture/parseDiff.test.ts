import { describe, expect, it } from 'vitest';
import { DEFAULT_DIFF_LIMITS, DiffParseError, fileHash, hunkHash, isOddName, parseDiff, parseRaw } from './parseDiff';

const OLD = 'a'.repeat(40);
const NEW = 'b'.repeat(40);
const ZERO = '0'.repeat(40);

const raw = (...entries: { meta: string; paths: string[] }[]): string => entries.map((entry) => `${entry.meta}\0${entry.paths.join('\0')}\0`).join('');
const modified = (path: string, modes = '100644 100644'): { meta: string; paths: string[] } => ({ meta: `:${modes} ${OLD} ${NEW} M`, paths: [path] });
const added = (path: string, mode = '100644'): { meta: string; paths: string[] } => ({ meta: `:000000 ${mode} ${ZERO} ${NEW} A`, paths: [path] });

const block = (header: string, marker: string[], hunks: string[]): string => ['diff --git ' + header, ...marker, ...hunks].join('\n');
const hunk = (header: string, ...lines: string[]): string => [header, ...lines].join('\n');
const patch = (...blocks: string[]): string => blocks.join('\n') + '\n';

describe('parseRaw', () => {
  it('reads statuses, modes, blob ids and rename pairs without quoting', () => {
    const entries = parseRaw(
      raw(modified('a b.txt'), added('new.txt'), { meta: `:100644 000000 ${OLD} ${ZERO} D`, paths: ['gone.txt'] }, { meta: `:100644 100644 ${OLD} ${NEW} R087`, paths: ['old name.txt', 'new name.txt'] }, { meta: `:100644 120000 ${OLD} ${NEW} T`, paths: ['changed'] }),
    );
    expect(entries.map((entry) => [entry.status, entry.oldPath, entry.newPath]), 'paths per status').toEqual([
      ['M', 'a b.txt', 'a b.txt'],
      ['A', null, 'new.txt'],
      ['D', 'gone.txt', null],
      ['R', 'old name.txt', 'new name.txt'],
      ['T', 'changed', 'changed'],
    ]);
    expect([entries[1]!.oldMode, entries[1]!.oldBlob, entries[2]!.newMode, entries[3]!.similarity], 'zero ids and modes read as absent').toEqual([null, null, null, 87]);
  });

  it('treats a copy as an addition and refuses a status it does not know', () => {
    expect(parseRaw(raw({ meta: `:100644 100644 ${OLD} ${NEW} C100`, paths: ['src.txt', 'copy.txt'] }))[0], 'a copy is a new file').toMatchObject({ status: 'A', oldPath: null, newPath: 'copy.txt' });
    expect(() => parseRaw(raw({ meta: `:100644 100644 ${OLD} ${NEW} U`, paths: ['x'] })), 'an unmerged entry is refused').toThrow(DiffParseError);
    expect(() => parseRaw('garbage\0x\0'), 'a line that is no entry is refused').toThrow(DiffParseError);
  });

  it('flags a name that is not UTF-8', () => {
    const entries = parseRaw(raw(added('bad-\xff-name')));
    expect(entries[0]!.nonUtf8, 'a byte of 0xff is not valid UTF-8').toBe(true);
  });
});

describe('parseDiff', () => {
  it('follows the hunk counts, so lines that look like headers stay content', () => {
    const body = [' ok', '+diff --git a/fake b/fake', '+@@ -1,1 +1,1 @@', '+++ b/phantom', '-old'];
    const result = parseDiff(raw(modified('x.txt')), patch(block('a/x.txt b/x.txt', ['index 1..2 100644', '--- a/x.txt', '+++ b/x.txt'], [hunk('@@ -1,2 +1,4 @@', ...body)])));
    expect(result.files, 'one file').toHaveLength(1);
    expect(result.hunks[0]!.body.split('\n'), 'every line of the hunk is kept').toEqual(body);
    expect([result.files[0]!.added, result.files[0]!.removed], 'counts of the prefixes').toEqual([3, 1]);
  });

  it('keeps the no-newline marker in the body and does not count it', () => {
    const lines = ['-a', '\\ No newline at end of file', '+b', '\\ No newline at end of file'];
    const result = parseDiff(raw(modified('x.txt')), patch(block('a/x.txt b/x.txt', ['--- a/x.txt', '+++ b/x.txt'], [hunk('@@ -1 +1 @@', ...lines)])));
    expect(result.hunks[0]!.body.split('\n'), 'marker lines stay').toEqual(lines);
    expect([result.hunks[0]!.oldLines, result.hunks[0]!.newLines], 'a header without counts means one line').toEqual([1, 1]);
  });

  it('reads two hunks of one file with their positions and section text', () => {
    const first = hunk('@@ -1,2 +1,2 @@ function one()', ' a', '-b', '+c');
    const second = hunk('@@ -50,2 +50,2 @@', ' d', '-e', '+f');
    const result = parseDiff(raw(modified('x.ts')), patch(block('a/x.ts b/x.ts', ['--- a/x.ts', '+++ b/x.ts'], [first, second])));
    expect(result.hunks.map((entry) => [entry.idx, entry.oldStart, entry.newStart, entry.section]), 'positions and the text after the second @@').toEqual([
      [0, 1, 1, 'function one()'],
      [1, 50, 50, null],
    ]);
  });

  it('marks binary files without hunks and skips the payload', () => {
    const result = parseDiff(raw(modified('a.bin'), modified('z.txt')), patch(block('a/a.bin b/a.bin', ['index 1..2 100644', 'Binary files a/a.bin and b/a.bin differ'], []), block('a/z.txt b/z.txt', ['--- a/z.txt', '+++ b/z.txt'], [hunk('@@ -1 +1 @@', '-a', '+b')])));
    expect(result.files.map((file) => [file.newPath, file.kind]), 'kinds').toEqual([['a.bin', 'binary'], ['z.txt', 'text']]);
    expect(result.hunks.map((entry) => entry.fileIdx), 'only the text file has a hunk').toEqual([1]);
    const payload = parseDiff(raw(modified('a.bin')), patch(block('a/a.bin b/a.bin', ['index 1..2 100644', 'GIT binary patch', 'literal 4', 'zcmZQzU|?bX00aO5', ''], [])));
    expect(payload.files[0]!.kind, 'a binary patch body is skipped').toBe('binary');
  });

  it('merges the deletion and the addition of a type change into one file', () => {
    const entry = { meta: `:100644 120000 ${OLD} ${NEW} T`, paths: ['typechange'] };
    const result = parseDiff(
      raw(entry),
      patch(
        block('a/typechange b/typechange', ['deleted file mode 100644', 'index 1..0'], [hunk('@@ -1 +0,0 @@', '-plain')]),
        block('a/typechange b/typechange', ['new file mode 120000', 'index 0..2'], [hunk('@@ -0,0 +1 @@', '+edit.txt', '\\ No newline at end of file')]),
      ),
    );
    expect(result.files, 'one entry for the path').toHaveLength(1);
    expect(result.files[0], 'a symlink after the change').toMatchObject({ status: 'T', kind: 'symlink', added: 1, removed: 1 });
    expect(result.hunks.map((entry) => entry.idx), 'hunks of both blocks are numbered in order').toEqual([0, 1]);
  });

  it('classifies submodules and symlinks by mode, without hunks for a submodule', () => {
    const result = parseDiff(
      raw(modified('vendor/lib', '160000 160000'), added('link', '120000')),
      patch(block('a/vendor/lib b/vendor/lib', ['index 1..2 160000', '--- a/vendor/lib', '+++ b/vendor/lib'], [hunk('@@ -1 +1 @@', '-Subproject commit 1', '+Subproject commit 2')]), block('a/link b/link', ['new file mode 120000'], [hunk('@@ -0,0 +1 @@', '+target')])),
    );
    expect(result.files.map((file) => file.kind), 'kinds from the modes').toEqual(['submodule', 'symlink']);
    expect(result.hunks.map((entry) => entry.fileIdx), 'a submodule keeps no hunk, a symlink keeps its target line').toEqual([1]);
  });

  it('keeps a pure rename and an empty file as rows without hunks', () => {
    const result = parseDiff(
      raw({ meta: `:100644 100644 ${OLD} ${OLD} R100`, paths: ['a.txt', 'b.txt'] }, added('empty.txt')),
      patch(block('a/a.txt b/b.txt', ['similarity index 100%', 'rename from a.txt', 'rename to b.txt'], []), block('a/empty.txt b/empty.txt', ['new file mode 100644', 'index 0000000..e69de29'], [])),
    );
    expect(result.files.map((file) => [file.status, file.similarity, file.added]), 'rename and empty file').toEqual([['R', 100, 0], ['A', null, 0]]);
    expect(result.hunks, 'neither has a hunk').toEqual([]);
  });

  it('refuses a patch that does not match the raw list', () => {
    expect(() => parseDiff(raw(modified('a.txt'), modified('b.txt')), patch(block('a/a.txt b/a.txt', ['--- a/a.txt'], [hunk('@@ -1 +1 @@', '-a', '+b')]))), 'a missing block').toThrow(DiffParseError);
    expect(() => parseDiff(raw(added('a.txt')), patch(block('a/a.txt b/a.txt', ['--- a/a.txt'], [hunk('@@ -1 +1 @@', '-a', '+b')]))), 'an addition raw entry against a modification block').toThrow(DiffParseError);
  });

  describe('limits', () => {
    const manyLines = (count: number): string => hunk(`@@ -0,0 +1,${count} @@`, ...Array.from({ length: count }, (_, i) => `+line ${i}`));
    const one = (name: string, count: number): string => block(`a/${name} b/${name}`, ['new file mode 100644'], [manyLines(count)]);

    it('turns a file over the changed-line cap into a large file without hunks and keeps its counts', () => {
      const result = parseDiff(raw(added('big.txt'), added('small.txt')), patch(one('big.txt', 5_001), one('small.txt', 3)));
      expect(result.files.map((file) => [file.kind, file.added]), 'big is large, small is text').toEqual([['large', 5_001], ['text', 3]]);
      expect(result.hunks.map((entry) => entry.fileIdx), 'only the small file has a hunk').toEqual([1]);
    });

    it('turns a file over the byte cap into a large file', () => {
      const text = Array.from({ length: 100 }, () => `+${'x'.repeat(1_000)}`);
      const result = parseDiff(raw(added('wide.txt')), patch(block('a/wide.txt b/wide.txt', ['new file mode 100644'], [hunk('@@ -0,0 +1,100 @@', ...text)])), { ...DEFAULT_DIFF_LIMITS, fileBytes: 50_000 });
      expect(result.files[0]!.kind, 'over 50,000 bytes').toBe('large');
    });

    it('turns files after the changeset cap into large files', () => {
      const result = parseDiff(raw(added('a.txt'), added('b.txt'), added('c.txt')), patch(one('a.txt', 50), one('b.txt', 50), one('c.txt', 50)), { ...DEFAULT_DIFF_LIMITS, totalBytes: 800 });
      expect(result.files.map((file) => file.kind), 'the first file fits, the later ones do not').toEqual(['text', 'large', 'large']);
    });

    it('lists the files after the file cap from the raw list only', () => {
      const result = parseDiff(raw(added('a.txt'), added('b.txt'), added('c.txt')), patch(one('a.txt', 2)), { ...DEFAULT_DIFF_LIMITS, files: 1 });
      expect(result.files.map((file) => [file.newPath, file.kind, file.added]), 'later files have names and no lines').toEqual([['a.txt', 'text', 2], ['b.txt', 'large', 0], ['c.txt', 'large', 0]]);
    });

    it('fails with a timeout error when the parse takes longer than the limit', () => {
      let now = 0;
      const clock = (): number => (now += 60_000);
      expect(() => parseDiff(raw(added('a.txt')), patch(one('a.txt', 9_000)), DEFAULT_DIFF_LIMITS, clock), 'a clock that runs past the deadline').toThrow(expect.objectContaining({ kind: 'timeout' }));
    });
  });
});

describe('hashes', () => {
  it('gives a hunk the same hash after it moved and another after its lines changed', () => {
    const at = (header: string, ...lines: string[]) => parseDiff(raw(modified('x.ts')), patch(block('a/x.ts b/x.ts', ['--- a/x.ts', '+++ b/x.ts'], [hunk(header, ...lines)]))).hunks[0]!.hunkHash;
    const base = at('@@ -1,2 +1,2 @@', ' keep', '-old', '+new');
    expect(at('@@ -40,2 +45,2 @@', ' keep', '-old', '+new'), 'moved by an unrelated edit above').toBe(base);
    expect(at('@@ -1,2 +1,2 @@', ' keep', '-old', '+newer'), 'a changed line').not.toBe(base);
    expect(at('@@ -1,2 +1,2 @@', ' keep', '-old', '+new\r'), 'a carriage return is part of the line').not.toBe(base);
  });

  it('numbers identical bodies in one file so each has its own hash', () => {
    const body = [' same', '-a', '+b'];
    const result = parseDiff(raw(modified('x.ts')), patch(block('a/x.ts b/x.ts', ['--- a/x.ts', '+++ b/x.ts'], [hunk('@@ -1,2 +1,2 @@', ...body), hunk('@@ -20,2 +20,2 @@', ...body)])));
    expect(new Set(result.hunks.map((entry) => entry.hunkHash)).size, 'two identical bodies, two hashes').toBe(2);
    expect(hunkHash('x.ts', body.join('\n'), 0), 'the first hash is the ordinal 0 one').toBe(result.hunks[0]!.hunkHash);
  });

  it('changes the file hash with the mode, the name or the content id', () => {
    const hashOf = (entry: { meta: string; paths: string[] }) => fileHash(parseRaw(raw(entry))[0]!);
    const base = hashOf(modified('x.ts'));
    expect(hashOf(modified('x.ts', '100644 100755')), 'a mode change').not.toBe(base);
    expect(hashOf(modified('y.ts')), 'another name').not.toBe(base);
    expect(hashOf({ meta: `:100644 100644 ${OLD} ${'c'.repeat(40)} M`, paths: ['x.ts'] }), 'other content').not.toBe(base);
    expect(hashOf(modified('x.ts')), 'the same facts give the same hash').toBe(base);
  });
});

describe('odd names', () => {
  it.each([
    ['a newline', 'a\nb', true],
    ['a tab', 'a\tb', true],
    ['an escape character', 'a\u001bb', true],
    ['a bidirectional control', `a${String.fromCharCode(0x202e)}b`, true],
    ['a leading dash', '-rf', true],
    ['a dash inside', 'dir/-x', false],
    ['spaces and unicode', 'dir with space/日本語 ü.txt', false],
  ])('%s', (_name, path, odd) => {
    expect(isOddName(path, false), `${JSON.stringify(path)} is ${odd ? '' : 'not '}odd`).toBe(odd);
  });
});
