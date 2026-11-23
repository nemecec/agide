import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A stand-in for `srt -s <settings> -- <argv>` with the end-of-run behaviour of srt 0.0.83 that matters to a check: it
 * runs the program as its child, forwards SIGINT, SIGTERM and SIGHUP to it, exits 0 when the child ends by SIGINT or
 * SIGTERM, exits 1 for any other named signal and otherwise exits with the child's status. Node reports a death by a
 * signal it has no name for (SIGEMT on macOS) as exit code 0 with no signal, so the stand-in, a Node program like
 * `srt`, exits 0 for it too. The child runs in a process group of its own: under the real `srt` a signal that the
 * program sends to its group cannot reach `srt` (the sandbox refuses it). Tests of the check use it where no real
 * `srt` is installed; the tests against the real one are the reference.
 */
const SCRIPT = `#!${process.execPath}
const { spawn } = require('node:child_process');
const argv = process.argv.slice(process.argv.indexOf('--') + 1);
const child = spawn(argv[0], argv.slice(1), { stdio: 'inherit', detached: true });
const forward = (signal) => {
  try {
    process.kill(-child.pid, signal);
  } catch {}
};
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => forward(signal));
process.on('exit', () => forward('SIGKILL'));
child.on('exit', (code, signal) => {
  if (signal === 'SIGINT' || signal === 'SIGTERM') process.exit(0);
  if (signal) {
    console.error('Process killed by signal: ' + signal);
    process.exit(1);
  }
  process.exit(code === null ? 0 : code);
});
`;

/** Writes the stand-in into `directory` and returns its path. */
export function writeFakeSrt(directory: string): string {
  const path = join(directory, 'srt');
  writeFileSync(path, SCRIPT);
  chmodSync(path, 0o755);
  return path;
}
