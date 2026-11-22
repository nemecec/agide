import { performance } from 'node:perf_hooks';
import { fieldsHash } from '../rungs';
import type { ChangesetFile, FileKind, Hunk } from '../schemas';

/**
 * Parses the diff of a changeset (0040 section 5). The file list, modes, blob ids, statuses and rename pairs come
 * from `git diff --raw -z`, which never quotes names; the hunk text comes from the unified diff, read header by header
 * and by the counts of each `@@` line, so content that looks like a header does not start a file (probe P42).
 * Both inputs are one character per byte (`latin1`); text is decoded as UTF-8 per line after the split.
 */

export interface DiffLimits {
  /** Hunk body bytes of one file above which it becomes `large`. */
  readonly fileBytes: number;
  /** Changed lines of one file above which it becomes `large`. */
  readonly fileChangedLines: number;
  /** Hunk body bytes of the whole changeset; later files become `large`. */
  readonly totalBytes: number;
  /** Files read from the patch; the rest are listed from `--raw` only, as `large`. */
  readonly files: number;
  readonly parseMs: number;
}

export const DEFAULT_DIFF_LIMITS: DiffLimits = { fileBytes: 512 * 1024, fileChangedLines: 5_000, totalBytes: 8 * 1024 * 1024, files: 2_000, parseMs: 10_000 };

export class DiffParseError extends Error {
  constructor(
    message: string,
    readonly kind: 'timeout' | 'malformed',
  ) {
    super(message);
    this.name = 'DiffParseError';
  }
}

export type ParsedFile = Omit<ChangesetFile, 'changesetId'>;
export type ParsedHunk = Omit<Hunk, 'changesetId'>;

export interface ParsedDiff {
  readonly files: readonly ParsedFile[];
  readonly hunks: readonly ParsedHunk[];
}

export interface RawEntry {
  readonly status: 'A' | 'M' | 'D' | 'R' | 'T';
  readonly oldMode: string | null;
  readonly newMode: string | null;
  readonly oldBlob: string | null;
  readonly newBlob: string | null;
  readonly similarity: number | null;
  readonly oldPath: string | null;
  readonly newPath: string | null;
  /** True when a path is not valid UTF-8 (the stored string has replacement characters). */
  readonly nonUtf8: boolean;
}

const ZERO_MODE = /^0+$/;
const strictUtf8 = new TextDecoder('utf-8', { fatal: true });
const lenientUtf8 = new TextDecoder('utf-8');

/** Bytes (one character each) to text; reports whether the bytes were valid UTF-8. */
function decode(latin: string): { text: string; valid: boolean } {
  const bytes = Buffer.from(latin, 'latin1');
  try {
    return { text: strictUtf8.decode(bytes), valid: true };
  } catch {
    return { text: lenientUtf8.decode(bytes), valid: false };
  }
}

/** Parses `git diff --raw -z --find-renames --abbrev=40` output. */
export function parseRaw(raw: string): RawEntry[] {
  const parts = raw.split('\0');
  const entries: RawEntry[] = [];
  for (let i = 0; i < parts.length; ) {
    const meta = parts[i++]!;
    if (meta === '') continue;
    const match = /^:(\d+) (\d+) ([0-9a-f]+) ([0-9a-f]+) ([A-Z])(\d*)$/.exec(meta);
    if (match === null) throw new DiffParseError('a --raw entry that does not parse', 'malformed');
    const [, oldMode, newMode, oldBlob, newBlob, letter, score] = match;
    const first = decode(parts[i++] ?? '');
    const status = letter === 'C' ? 'A' : (letter as RawEntry['status']);
    if (!['A', 'M', 'D', 'R', 'T'].includes(status)) throw new DiffParseError(`status ${letter} of a --raw entry is not handled`, 'malformed');
    const second = letter === 'R' || letter === 'C' ? decode(parts[i++] ?? '') : undefined;
    const oldPath = status === 'A' ? null : first.text;
    const newPath = second !== undefined ? second.text : status === 'D' ? null : first.text;
    entries.push({
      status,
      oldMode: ZERO_MODE.test(oldMode!) ? null : oldMode!,
      newMode: ZERO_MODE.test(newMode!) ? null : newMode!,
      oldBlob: ZERO_MODE.test(oldBlob!) ? null : oldBlob!,
      newBlob: ZERO_MODE.test(newBlob!) ? null : newBlob!,
      similarity: letter === 'R' ? Number(score) : null,
      oldPath: letter === 'C' ? null : oldPath,
      newPath: letter === 'C' ? second!.text : newPath,
      nonUtf8: !first.valid || (second !== undefined && !second.valid),
    });
  }
  return entries;
}

interface Block {
  /** `new file mode`, `deleted file mode`, `rename from` or nothing, as the header said. */
  readonly marker: 'A' | 'D' | 'R' | 'M';
  readonly binary: boolean;
  readonly hunks: BlockHunk[];
}

interface BlockHunk {
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  readonly section: string | null;
  /** Lines with their prefixes, one character per byte. */
  readonly lines: string[];
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: ?(.*))?$/;

/** Walks the unified diff and returns one block per `diff --git` header, in order. Stops after `maxBlocks`. */
function readBlocks(patch: string, maxBlocks: number, deadline: number, clock: () => number): Block[] {
  const lines = patch.split('\n');
  const blocks: Block[] = [];
  let i = 0;
  let ticks = 0;
  const checkClock = (): void => {
    if (++ticks % 4_096 === 0 && clock() > deadline) throw new DiffParseError('the diff did not parse within the time limit', 'timeout');
  };
  while (i < lines.length && blocks.length < maxBlocks) {
    if (!lines[i]!.startsWith('diff --git ')) {
      i++;
      continue;
    }
    i++;
    let marker: Block['marker'] = 'M';
    let binary = false;
    for (; i < lines.length && !lines[i]!.startsWith('@@ ') && !lines[i]!.startsWith('diff --git '); i++) {
      const line = lines[i]!;
      if (line.startsWith('new file mode ')) marker = 'A';
      else if (line.startsWith('deleted file mode ')) marker = 'D';
      else if (line.startsWith('rename from ')) marker = 'R';
      else if (line === 'GIT binary patch' || (line.startsWith('Binary files ') && line.endsWith(' differ'))) binary = true;
    }
    if (binary) {
      while (i < lines.length && !lines[i]!.startsWith('diff --git ')) i++;
      blocks.push({ marker, binary, hunks: [] });
      continue;
    }
    const hunks: BlockHunk[] = [];
    while (i < lines.length && lines[i]!.startsWith('@@ ')) {
      const header = HUNK_HEADER.exec(lines[i]!);
      if (header === null) break;
      const oldLines = header[2] === undefined ? 1 : Number(header[2]);
      const newLines = header[4] === undefined ? 1 : Number(header[4]);
      const hunk: BlockHunk = { oldStart: Number(header[1]), oldLines, newStart: Number(header[3]), newLines, section: header[5] === undefined || header[5] === '' ? null : header[5], lines: [] };
      let oldLeft = oldLines;
      let newLeft = newLines;
      i++;
      while (i < lines.length && (oldLeft > 0 || newLeft > 0 || lines[i]!.startsWith('\\'))) {
        checkClock();
        const line = lines[i]!;
        const mark = line[0];
        if (mark === '\\') {
          hunk.lines.push(line);
        } else if (mark === '+') {
          newLeft--;
          hunk.lines.push(line);
        } else if (mark === '-') {
          oldLeft--;
          hunk.lines.push(line);
        } else if (mark === ' ') {
          oldLeft--;
          newLeft--;
          hunk.lines.push(line);
        } else {
          break;
        }
        i++;
      }
      hunks.push(hunk);
    }
    blocks.push({ marker, binary, hunks });
  }
  return blocks;
}

const REPLACEMENT_CHARACTER = String.fromCharCode(0xfffd);
const BIDI_CONTROLS = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/** A name the UI must show escaped: control characters, bidirectional controls, a leading dash or bytes that are not UTF-8. */
export function isOddName(path: string, nonUtf8: boolean): boolean {
  return nonUtf8 || CONTROL_CHARACTERS.test(path) || BIDI_CONTROLS.test(path) || path.startsWith('-') || path.includes(REPLACEMENT_CHARACTER);
}

/** The patch blocks of an entry say the same about it as `--raw` does; a type change shows as a deletion and an addition. */
function matchesEntry(entry: RawEntry, blocks: readonly Block[]): boolean {
  const markers = blocks.map((block) => block.marker).sort().join('');
  const wanted = { A: 'A', D: 'D', R: 'R', M: 'M', T: 'AD' }[entry.status];
  return markers === wanted;
}

const countChanged = (lines: readonly string[], mark: '+' | '-'): number => lines.reduce((sum, line) => (line[0] === mark ? sum + 1 : sum), 0);

/**
 * Files and hunks of base..checkpoint from the two diff texts. A file over a limit is kept without hunks as `large`; a
 * type change (`T` in `--raw`) is one file although the patch shows a deletion and an addition.
 */
export function parseDiff(rawText: string, patchText: string, limits: DiffLimits = DEFAULT_DIFF_LIMITS, clock: () => number = () => performance.now()): ParsedDiff {
  const entries = parseRaw(rawText);
  const deadline = clock() + limits.parseMs;
  const blocks = readBlocks(patchText, blocksFor(entries, limits.files), deadline, clock);

  const files: ParsedFile[] = [];
  const hunks: ParsedHunk[] = [];
  let storedBytes = 0;
  let blockAt = 0;
  for (const [idx, entry] of entries.entries()) {
    if (idx >= limits.files) {
      files.push(buildFile(idx, entry, 'large', 0, 0));
      continue;
    }
    const take = entry.status === 'T' ? 2 : 1;
    const mine = blocks.slice(blockAt, blockAt + take);
    blockAt += take;
    if (mine.length < take || !matchesEntry(entry, mine)) {
      throw new DiffParseError(`the diff of file ${idx} does not match its --raw entry`, 'malformed');
    }
    const binary = mine.some((block) => block.binary);
    const blockHunks = mine.flatMap((block) => block.hunks);
    const allLines = blockHunks.flatMap((hunk) => hunk.lines);
    const added = countChanged(allLines, '+');
    const removed = countChanged(allLines, '-');
    const bytes = allLines.reduce((sum, line) => sum + line.length + 1, 0);
    const submodule = entry.oldMode === '160000' || entry.newMode === '160000';
    const symlink = entry.oldMode === '120000' || entry.newMode === '120000';
    let kind: FileKind = submodule ? 'submodule' : symlink ? 'symlink' : binary ? 'binary' : 'text';
    if (kind === 'text' && (bytes > limits.fileBytes || added + removed > limits.fileChangedLines || storedBytes + bytes > limits.totalBytes)) kind = 'large';
    const keepHunks = kind === 'text' || kind === 'symlink';
    if (keepHunks) storedBytes += bytes;
    files.push(buildFile(idx, entry, kind, added, removed));
    if (!keepHunks) continue;
    hunks.push(...buildHunks(idx, files[idx]!, blockHunks));
  }
  return { files, hunks };
}

/** Patch blocks the first `fileLimit` entries account for. */
function blocksFor(entries: readonly RawEntry[], fileLimit: number): number {
  return entries.slice(0, fileLimit).reduce((sum, entry) => sum + (entry.status === 'T' ? 2 : 1), 0);
}

function buildFile(idx: number, entry: RawEntry, kind: FileKind, added: number, removed: number): ParsedFile {
  const path = entry.newPath ?? entry.oldPath ?? '';
  return {
    idx,
    status: entry.status,
    oldPath: entry.oldPath,
    newPath: entry.newPath,
    oldMode: entry.oldMode,
    newMode: entry.newMode,
    oldBlob: entry.oldBlob,
    newBlob: entry.newBlob,
    similarity: entry.similarity,
    kind,
    added,
    removed,
    oddName: isOddName(entry.oldPath ?? path, entry.nonUtf8) || isOddName(path, entry.nonUtf8),
    fileHash: fileHash(entry),
  };
}

/** SHA-256 over old path, new path, old and new mode, old and new blob (0040 section 3.2). */
export const fileHash = (entry: Pick<RawEntry, 'oldPath' | 'newPath' | 'oldMode' | 'newMode' | 'oldBlob' | 'newBlob'>): string =>
  fieldsHash(entry.oldPath ?? '', entry.newPath ?? '', entry.oldMode ?? '', entry.newMode ?? '', entry.oldBlob ?? '', entry.newBlob ?? '');

/**
 * SHA-256 over the new path (the old path for a deletion), the body lines with their prefixes and the ordinal of the
 * body among identical bodies of the file (0040 section 3.2). The `@@` positions are not part of it.
 */
export const hunkHash = (path: string, bodyLatin1: string, ordinal: number): string => fieldsHash(path, bodyLatin1, String(ordinal));

function buildHunks(fileIdx: number, file: ParsedFile, blockHunks: readonly BlockHunk[]): ParsedHunk[] {
  const path = file.newPath ?? file.oldPath ?? '';
  const seen = new Map<string, number>();
  return blockHunks.map((hunk, idx) => {
    const bodyLatin1 = hunk.lines.join('\n');
    const ordinal = seen.get(bodyLatin1) ?? 0;
    seen.set(bodyLatin1, ordinal + 1);
    return {
      fileIdx,
      idx,
      oldStart: hunk.oldStart,
      oldLines: hunk.oldLines,
      newStart: hunk.newStart,
      newLines: hunk.newLines,
      section: hunk.section === null ? null : decode(hunk.section).text,
      body: decode(bodyLatin1).text,
      hunkHash: hunkHash(path, bodyLatin1, ordinal),
    };
  });
}
