import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { archiveTranscript, entriesOfLine, pruneArchive, readTranscript, safeTranscriptPath, transcriptMetaFinished } from './transcriptFiles';

let dirs: string[] = [];
const temp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'agents-transcripts-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

describe('safeTranscriptPath', () => {
  it('accepts a regular file below an allowed root', () => {
    const root = temp();
    const file = join(root, 'proj', 's.jsonl');
    mkdirSync(join(root, 'proj'));
    writeFileSync(file, '{}\n');
    expect(safeTranscriptPath(file, [root]), 'inside').toContain('s.jsonl');
  });

  it('refuses a path outside the roots, a symbolic link that leaves them and a missing file', () => {
    const root = temp();
    const outside = temp();
    writeFileSync(join(outside, 'secret.txt'), 'x');
    symlinkSync(join(outside, 'secret.txt'), join(root, 'link.jsonl'));
    expect(safeTranscriptPath(join(outside, 'secret.txt'), [root]), 'outside the root').toBeUndefined();
    expect(safeTranscriptPath(join(root, 'link.jsonl'), [root]), 'link to a file outside').toBeUndefined();
    expect(safeTranscriptPath(join(root, 'missing.jsonl'), [root]), 'missing').toBeUndefined();
    expect(safeTranscriptPath(root, [root]), 'a directory is no regular file').toBeUndefined();
  });

  it('accepts a link that stays inside the root', () => {
    const root = temp();
    writeFileSync(join(root, 'real.jsonl'), '{}');
    symlinkSync(join(root, 'real.jsonl'), join(root, 'inside.jsonl'));
    expect(safeTranscriptPath(join(root, 'inside.jsonl'), [root]), 'resolved to the real file').toContain('real.jsonl');
  });
});

describe('transcript entries', () => {
  it('renders user, assistant, tool use and tool result lines as plain text', () => {
    const line = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hello <b>x</b>' }, { type: 'tool_use', name: 'Read', input: { file_path: 'a' } }] } });
    expect(entriesOfLine(line), 'assistant entries').toEqual([
      { role: 'assistant', text: 'hello <b>x</b>' },
      { role: 'tool_use', text: 'Read {"file_path":"a"}' },
    ]);
    const result = JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: [{ type: 'text', text: 'out' }] }] } });
    expect(entriesOfLine(result), 'tool result').toEqual([{ role: 'tool_result', text: 'out' }]);
    expect(entriesOfLine(JSON.stringify({ type: 'user', message: { content: 'plain prompt' } })), 'string content').toEqual([{ role: 'user', text: 'plain prompt' }]);
  });

  it('shows unknown line types and broken lines as raw text', () => {
    expect(entriesOfLine('{"type":"cost-state","totalCostUSD":1}'), 'unknown type').toEqual([{ role: 'raw', text: '{"type":"cost-state","totalCostUSD":1}' }]);
    expect(entriesOfLine('not json'), 'broken line').toEqual([{ role: 'raw', text: 'not json' }]);
  });
});

describe('readTranscript and archive', () => {
  it('reads a file, flags a read that starts mid-file as truncated and reads a gzip copy', async () => {
    const root = temp();
    const file = join(root, 't.jsonl');
    const lines = Array.from({ length: 50 }, (_, i) => JSON.stringify({ type: 'user', message: { content: `line ${i}` } }));
    writeFileSync(file, `${lines.join('\n')}\n`);
    expect(readTranscript(file).entries.length, 'whole file').toBe(50);
    const cut = readTranscript(file, false, 300);
    expect(cut.truncated, 'limit smaller than the file').toBe(true);
    expect(cut.entries.every((e) => e.role === 'user'), 'no half line at the start').toBe(true);

    const copy = join(root, 'out', 'copy.jsonl.gz');
    await archiveTranscript(file, copy);
    expect(readTranscript(copy, true).entries.length, 'the copy reads like the original').toBe(50);
    writeFileSync(join(root, 'plain.gz'), gzipSync('{"type":"user","message":{"content":"z"}}\n'));
    expect(readTranscript(join(root, 'plain.gz'), true).entries, 'gzip').toEqual([{ role: 'user', text: 'z' }]);
  });

  it('removes the oldest copies first until the directory fits the limit', () => {
    const root = temp();
    const big = Buffer.alloc(600 * 1024, 1);
    for (const [name, age] of [['old', 300], ['mid', 200], ['new', 100]] as const) {
      const path = join(root, `${name}.jsonl.gz`);
      writeFileSync(path, big);
      const time = Date.now() / 1000 - age;
      utimesSync(path, time, time);
    }
    const removed = pruneArchive(root, 1).map((path) => path.split('/').pop());
    expect(removed, 'two oldest go').toEqual(['old.jsonl.gz', 'mid.jsonl.gz']);
    expect(pruneArchive(root, 0), 'zero limit removes the rest').toHaveLength(1);
  });
});

describe('transcriptMetaFinished', () => {
  it('reads the finished flag of the meta file beside the transcript', () => {
    const dir = temp();
    writeFileSync(join(dir, 'agent-1.jsonl'), '');
    writeFileSync(join(dir, 'agent-1.meta.json'), '{"finished":true}');
    writeFileSync(join(dir, 'agent-2.meta.json'), '{"finished":false}');
    writeFileSync(join(dir, 'agent-3.meta.json'), '{"finished":"true"}');
    expect(transcriptMetaFinished(join(dir, 'agent-1.jsonl')), 'finished').toBe(true);
    expect(transcriptMetaFinished(join(dir, 'agent-2.jsonl')), 'not finished').toBe(false);
    expect(transcriptMetaFinished(join(dir, 'agent-3.jsonl')), 'a string is not true').toBe(false);
  });

  it('says no for a missing, broken or non-transcript file', () => {
    const dir = temp();
    writeFileSync(join(dir, 'broken.meta.json'), '{');
    expect(transcriptMetaFinished(join(dir, 'missing.jsonl')), 'missing meta').toBe(false);
    expect(transcriptMetaFinished(join(dir, 'broken.jsonl')), 'broken meta').toBe(false);
    expect(transcriptMetaFinished(join(dir, 'notes.txt')), 'not a transcript name').toBe(false);
  });
});
