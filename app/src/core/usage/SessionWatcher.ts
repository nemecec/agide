import { closeSync, openSync, readdirSync, readFileSync, readSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { outcomeFromTail, readTailLines } from '../agents/normalise/outcomeCheck';
import { parseCostState, parseUsageLine, usageFact } from '../agents/normalise/transcriptAdapter';
import type { AgentFact } from '../agents/types';
import { parseStatusSnapshot, snapshotFacts, STATUS_SNAPSHOT_FILE } from './statusLine';

const MAX_LINE_BYTES = 1024 * 1024;
const MAX_READ_BYTES = 8 * 1024 * 1024;
const STALE_TEMP_MS = 60_000;

interface FileCursor {
  offset: number;
  agentKey: string;
  /** Set while skipping the rest of a line over the size limit. */
  discarding: boolean;
}

export interface SessionWatcherOptions {
  readonly sessionId: string;
  /** The session's hook inbox directory on the host; the status snapshot lands there. */
  readonly eventsDir: string;
  readonly now: () => number;
  readonly onFacts: (facts: AgentFact[]) => void;
}

/**
 * Reads what one running session writes: the status snapshot (cost and plan usage) and the appended lines of the
 * main transcript and of `subagents/agent-*.jsonl` (usage by message id). It keeps a byte offset per file and
 * parses complete lines only. `poll` is called on a timer for running sessions; `finish` reads the rest and the
 * `cost-state` the CLI writes at exit (0027 section 7).
 */
export class SessionWatcher {
  private transcriptPath: string | undefined;
  private statusMtime = 0;
  private lastSweep = 0;
  private readonly cursors = new Map<string, FileCursor>();

  constructor(private readonly options: SessionWatcherOptions) {}

  setTranscript(path: string): void {
    if (this.transcriptPath === path) return;
    this.transcriptPath = path;
    this.cursors.set(path, this.cursors.get(path) ?? { offset: 0, agentKey: 'main', discarding: false });
  }

  poll(): void {
    const facts = [...this.readStatus(), ...this.readTranscripts()];
    this.sweepTemporaryFiles();
    if (facts.length > 0) this.options.onFacts(facts);
  }

  /** The final read: the rest of every transcript and the exit cost, when the process has written it. */
  finish(): void {
    const facts = [...this.readStatus(), ...this.readTranscripts()];
    const cost = this.exitCost();
    if (cost !== undefined) facts.push({ kind: 'session-cost', sessionId: this.options.sessionId, at: this.iso(), costUsd: cost, basis: 'cost-state' });
    if (facts.length > 0) this.options.onFacts(facts);
  }

  /** The `.meta.json` of a finished agent says whether it finished (repair after a crash). */
  agentFinished(agentId: string): boolean {
    const dir = this.subagentDir();
    if (dir === undefined) return false;
    try {
      const meta = JSON.parse(readFileSync(join(dir, `agent-${agentId}.meta.json`), 'utf8')) as { finished?: unknown };
      return meta.finished === true;
    } catch {
      return false;
    }
  }

  private iso(): string {
    return new Date(this.options.now()).toISOString();
  }

  private readStatus(): AgentFact[] {
    const path = join(this.options.eventsDir, STATUS_SNAPSHOT_FILE);
    try {
      const mtime = statSync(path).mtimeMs;
      if (mtime === this.statusMtime) return [];
      this.statusMtime = mtime;
      const snapshot = parseStatusSnapshot(readFileSync(path, 'utf8'));
      return snapshot ? snapshotFacts(this.options.sessionId, snapshot, this.iso()) : [];
    } catch {
      return [];
    }
  }

  private subagentDir(): string | undefined {
    return this.transcriptPath === undefined ? undefined : join(dirname(this.transcriptPath), this.options.sessionId, 'subagents');
  }

  private readTranscripts(): AgentFact[] {
    if (this.transcriptPath === undefined) return [];
    const facts: AgentFact[] = [];
    const dir = this.subagentDir();
    if (dir !== undefined) {
      try {
        for (const name of readdirSync(dir)) {
          const match = /^agent-(.+)\.jsonl$/.exec(name);
          const path = join(dir, name);
          if (match?.[1] !== undefined && !this.cursors.has(path)) this.cursors.set(path, { offset: 0, agentKey: match[1], discarding: false });
        }
      } catch {
        // No subagents yet.
      }
    }
    for (const [path, cursor] of this.cursors) {
      for (const line of this.readAppended(path, cursor)) {
        const usage = parseUsageLine(line);
        if (usage) facts.push(usageFact(this.options.sessionId, cursor.agentKey, usage, this.iso()));
      }
    }
    return facts;
  }

  private readAppended(path: string, cursor: FileCursor): string[] {
    let size: number;
    try {
      size = statSync(path).size;
    } catch {
      return [];
    }
    if (size < cursor.offset) cursor.offset = 0;
    if (size === cursor.offset) return [];
    const length = Math.min(size - cursor.offset, MAX_READ_BYTES);
    const buffer = Buffer.alloc(length);
    try {
      const fd = openSync(path, 'r');
      try {
        readSync(fd, buffer, 0, length, cursor.offset);
      } finally {
        closeSync(fd);
      }
    } catch {
      return [];
    }
    const lines: string[] = [];
    let start = 0;
    for (;;) {
      const end = buffer.indexOf(0x0a, start);
      if (end < 0) break;
      if (cursor.discarding) cursor.discarding = false;
      else if (end - start <= MAX_LINE_BYTES) lines.push(buffer.toString('utf8', start, end));
      start = end + 1;
    }
    cursor.offset += start;
    if (length - start > MAX_LINE_BYTES) {
      cursor.offset += length - start;
      cursor.discarding = true;
    }
    return lines;
  }

  private exitCost(): number | undefined {
    if (this.transcriptPath === undefined) return undefined;
    const lines = readTailLines(this.transcriptPath, 256 * 1024) ?? [];
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const cost = parseCostState(lines[index] ?? '');
      if (cost !== undefined) return cost;
    }
    return undefined;
  }

  private sweepTemporaryFiles(): void {
    const now = this.options.now();
    if (now - this.lastSweep < STALE_TEMP_MS) return;
    this.lastSweep = now;
    try {
      for (const name of readdirSync(this.options.eventsDir)) {
        if (!name.startsWith('tmp-') || name.endsWith('.json')) continue;
        const path = join(this.options.eventsDir, name);
        try {
          if (now - statSync(path).mtimeMs > STALE_TEMP_MS) rmSync(path, { recursive: true, force: true });
        } catch {
          // One entry that cannot be read or removed does not stop the sweep.
        }
      }
    } catch {
      // The directory is gone with the session.
    }
  }
}

/** The outcome check of 0027 section 1 on an agent transcript file. */
export const outcomeOfAgentTranscript = (path: string) => outcomeFromTail(readTailLines(path));

export const agentKeyOfFile = (path: string): string => /^agent-(.+)\.jsonl$/.exec(basename(path))?.[1] ?? 'main';
