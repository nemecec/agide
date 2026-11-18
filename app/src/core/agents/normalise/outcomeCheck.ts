import { closeSync, openSync, readSync, statSync } from 'node:fs';
import type { AgentOutcome } from '../types';
import { isApiErrorLine, isInterruptLine } from './transcriptAdapter';

const TAIL_BYTES = 64 * 1024;

/** The last lines of a file, at most 64 KiB from the end; undefined when the file cannot be read. */
export function readTailLines(path: string, maxBytes = TAIL_BYTES): string[] | undefined {
  try {
    const size = statSync(path).size;
    const start = Math.max(0, size - maxBytes);
    const fd = openSync(path, 'r');
    try {
      const buffer = Buffer.alloc(size - start);
      readSync(fd, buffer, 0, buffer.length, start);
      const lines = buffer.toString('utf8').split('\n').filter((line) => line.trim() !== '');
      // A read that starts mid-file begins inside a line.
      return start > 0 ? lines.slice(1) : lines;
    } finally {
      closeSync(fd);
    }
  } catch {
    return undefined;
  }
}

/**
 * After `SubagentStop` the PTY path cannot tell a failed or stopped agent from a finished one, so it looks at
 * the end of the agent transcript (0027 section 1). Only the interrupt line and an API error line are
 * recognised; every other end stays `completed`.
 */
export function outcomeFromTail(lines: readonly string[] | undefined): AgentOutcome {
  const last = lines?.at(-1);
  if (last === undefined) return 'completed';
  if (isInterruptLine(last)) return 'stopped';
  if (isApiErrorLine(last)) return 'failed';
  return 'completed';
}
