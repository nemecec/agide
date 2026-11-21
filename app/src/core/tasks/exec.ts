import { execFile } from 'node:child_process';

export interface ExecOptions {
  readonly env: NodeJS.ProcessEnv;
  readonly timeoutMs: number;
  /** How stdout is decoded; `latin1` keeps every byte, for output that is written back unchanged. Default `utf8`. */
  readonly encoding?: 'utf8' | 'latin1';
}

export interface ExecResult {
  readonly stdout: string;
}

/** Runs a program without a shell. Every caller passes values as separate arguments. */
export type Exec = (file: string, args: readonly string[], options: ExecOptions) => Promise<ExecResult>;

export class ExecError extends Error {
  constructor(
    message: string,
    readonly stderr: string,
  ) {
    super(message);
    this.name = 'ExecError';
  }

  /** The first non-empty line of stderr, or the message. */
  get firstLine(): string {
    return this.stderr.split('\n').find((line) => line.trim() !== '')?.trim() ?? this.message;
  }
}

export const execFileNoShell: Exec = (file, args, { env, timeoutMs, encoding = 'utf8' }) =>
  new Promise((resolve, reject) => {
    execFile(file, [...args], { env, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, encoding }, (error, stdout, stderr) => {
      if (error) reject(new ExecError(error.message, String(stderr)));
      else resolve({ stdout: String(stdout) });
    });
  });
