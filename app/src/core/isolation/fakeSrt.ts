import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A stand-in for `srt -s <settings> -- <argv>` with the end-of-run behaviour of srt 0.0.83 that matters to a check: it
 * runs the program as its child, forwards SIGINT and SIGTERM to it, exits 0 when the child ends by SIGINT or SIGTERM,
 * exits 1 for any other signal and otherwise exits with the child's status. Tests of the check use it where no real
 * `srt` is installed; the tests against the real one are the reference.
 */
const SCRIPT = `#!${process.execPath}
const { spawn } = require('node:child_process');
const argv = process.argv.slice(process.argv.indexOf('--') + 1);
const child = spawn(argv[0], argv.slice(1), { stdio: 'inherit' });
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
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
