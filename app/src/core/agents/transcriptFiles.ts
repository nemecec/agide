import { closeSync, createReadStream, createWriteStream, existsSync, mkdirSync, openSync, readdirSync, readSync, realpathSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative, isAbsolute, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip, gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { asRecord, str } from './normalise/payload';
import type { TranscriptEntry } from './view';

export const VIEW_LIMIT_BYTES = 20 * 1024 * 1024;

const within = (root: string, path: string): boolean => {
  const from = relative(root, path);
  return from !== '' && !from.startsWith('..') && !isAbsolute(from);
};

/**
 * A path the viewer or the copier may open (0027 section 13): after `realpath` it lies below one of the allowed
 * roots (a configuration directory's `projects` directory or the profile's `transcripts` directory) and it is a
 * regular file. A link that leaves the roots, a path outside them and a missing file all give undefined.
 */
export function safeTranscriptPath(path: string, roots: readonly string[]): string | undefined {
  try {
    const real = realpathSync(resolve(path));
    if (!statSync(real).isFile()) return undefined;
    for (const root of roots) {
      let realRoot: string;
      try {
        realRoot = realpathSync(root);
      } catch {
        continue;
      }
      if (within(realRoot, real)) return real;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export type { TranscriptEntry, TranscriptRole } from './view';

export interface TranscriptView {
  readonly entries: readonly TranscriptEntry[];
  /** The file was over the limit: the view starts at its last 20 MB. */
  readonly truncated: boolean;
}

const RAW_LIMIT = 2000;
const clip = (text: string): string => (text.length > RAW_LIMIT ? `${text.slice(0, RAW_LIMIT)}…` : text);

function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((part) => (typeof part === 'string' ? part : (str(asRecord(part)?.['text']) ?? JSON.stringify(part)))).join('\n');
  return JSON.stringify(content);
}

/** Turns one transcript line into entries; an unknown line type gives its raw JSON as text. */
export function entriesOfLine(line: string): TranscriptEntry[] {
  let entry: Record<string, unknown> | undefined;
  try {
    entry = asRecord(JSON.parse(line));
  } catch {
    return [{ role: 'raw', text: clip(line) }];
  }
  const type = entry?.['type'];
  const message = asRecord(entry?.['message']);
  if (!entry || (type !== 'user' && type !== 'assistant') || !message) return [{ role: 'raw', text: clip(line) }];
  const content = message['content'];
  if (typeof content === 'string') return [{ role: type, text: clip(content) }];
  if (!Array.isArray(content)) return [{ role: 'raw', text: clip(line) }];
  const entries: TranscriptEntry[] = [];
  for (const part of content) {
    const block = asRecord(part);
    switch (block?.['type']) {
      case 'text':
        entries.push({ role: type, text: clip(str(block['text']) ?? '') });
        break;
      case 'tool_use':
        entries.push({ role: 'tool_use', text: clip(`${str(block['name']) ?? 'tool'} ${JSON.stringify(block['input'] ?? {})}`) });
        break;
      case 'tool_result':
        entries.push({ role: 'tool_result', text: clip(contentText(block['content'])) });
        break;
      default:
        entries.push({ role: 'raw', text: clip(JSON.stringify(part)) });
    }
  }
  return entries;
}

/** Reads a transcript for the viewer: plain text entries, at most the last 20 MB of the file. */
export function readTranscript(path: string, compressed = false, limit = VIEW_LIMIT_BYTES): TranscriptView {
  let text: string;
  let truncated = false;
  if (compressed) {
    const buffer = gunzipSync(readFileSync(path));
    truncated = buffer.length > limit;
    text = buffer.subarray(Math.max(0, buffer.length - limit)).toString('utf8');
  } else {
    const size = statSync(path).size;
    const start = Math.max(0, size - limit);
    truncated = start > 0;
    const buffer = Buffer.alloc(size - start);
    const fd = openSync(path, 'r');
    try {
      readSync(fd, buffer, 0, buffer.length, start);
    } finally {
      closeSync(fd);
    }
    text = buffer.toString('utf8');
  }
  const lines = text.split('\n').filter((line) => line.trim() !== '');
  return { entries: (truncated ? lines.slice(1) : lines).flatMap(entriesOfLine), truncated };
}

/** Gzip copy of a transcript under the profile's `transcripts` directory (0027 section 4); returns the copy's path. */
export async function archiveTranscript(source: string, destination: string): Promise<void> {
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
  await pipeline(createReadStream(source), createGzip(), createWriteStream(destination, { mode: 0o600 }));
}

/** Removes the oldest copies until the directory is within the limit; returns the removed paths. */
export function pruneArchive(root: string, limitMb: number): string[] {
  const files: { path: string; size: number; mtime: number }[] = [];
  const walk = (dir: string): void => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const path = join(dir, name);
      const info = statSync(path);
      if (info.isDirectory()) walk(path);
      else if (name.endsWith('.gz')) files.push({ path, size: info.size, mtime: info.mtimeMs });
    }
  };
  if (!existsSync(root)) return [];
  walk(root);
  let total = files.reduce((sum, file) => sum + file.size, 0);
  const removed: string[] = [];
  for (const file of files.sort((a, b) => a.mtime - b.mtime)) {
    if (total <= limitMb * 1024 * 1024) break;
    rmSync(file.path, { force: true });
    total -= file.size;
    removed.push(file.path);
  }
  return removed;
}

/** Whether the `<name>.meta.json` beside a subagent transcript says the agent finished. A missing or unreadable file says no. */
export function transcriptMetaFinished(transcriptPath: string): boolean {
  const name = /^(.*)\.jsonl$/.exec(transcriptPath.split('/').pop() ?? '')?.[1] ?? '';
  const metaPath = join(dirname(transcriptPath), `${name}.meta.json`);
  if (!existsSync(metaPath)) return false;
  try {
    return (JSON.parse(readFileSync(metaPath, 'utf8')) as { finished?: unknown }).finished === true;
  } catch {
    return false;
  }
}
