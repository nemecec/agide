import * as nodePty from 'node-pty';
import type { PtyCommand } from './types';

export interface PtyRun {
  readonly pid: number;
  /** Everything the process printed so far. */
  readonly output: () => string;
  /** Resolves with the elapsed milliseconds since the spawn once the output matches, and rejects after `timeoutMs`. */
  readonly until: (pattern: RegExp, timeoutMs?: number) => Promise<number>;
  readonly write: (text: string) => void;
  readonly exited: Promise<{ exitCode: number; signal: number | undefined }>;
  readonly kill: () => void;
}

/** Spawns a provider's command on a PTY, for tests that look at what the process prints. */
export function runInPty(command: PtyCommand, size: { cols: number; rows: number } = { cols: 80, rows: 24 }): PtyRun {
  const started = Date.now();
  const proc = nodePty.spawn(command.file, [...command.args], { name: 'xterm-256color', ...size, cwd: command.cwd, env: { ...command.env } });
  let text = '';
  proc.onData((data) => {
    text += data;
  });
  const exited = new Promise<{ exitCode: number; signal: number | undefined }>((resolve) => proc.onExit(({ exitCode, signal }) => resolve({ exitCode, signal })));
  return {
    pid: proc.pid,
    output: () => text,
    until: async (pattern, timeoutMs = 15_000) => {
      const end = Date.now() + timeoutMs;
      while (!pattern.test(text)) {
        if (Date.now() > end) throw new Error(`timed out waiting for ${String(pattern)}; output so far: ${text.slice(-400)}`);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      return Date.now() - started;
    },
    write: (data) => proc.write(data),
    exited,
    kill: () => {
      try {
        proc.kill();
      } catch {
        // already gone
      }
    },
  };
}
