import { execFile } from 'node:child_process';

export interface ExecOptions {
  readonly env: NodeJS.ProcessEnv;
  readonly timeoutMs: number;
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

export const execFileNoShell: Exec = (file, args, { env, timeoutMs }) =>
  new Promise((resolve, reject) => {
    execFile(file, [...args], { env, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error) reject(new ExecError(error.message, String(stderr)));
      else resolve({ stdout: String(stdout) });
    });
  });
