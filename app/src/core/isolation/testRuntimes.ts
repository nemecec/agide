import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findExecutable } from './SrtProvider';

/** The image the container tests use. It must already be local; the tests never pull. */
export const TEST_IMAGE = 'alpine:latest';

/**
 * The `srt` executable the tests use: `AGIDE_SRT_BIN`, else the install prefix the isolation probe recorded in
 * `/tmp/agide-srt-prefix.txt`, else `srt` on PATH. Undefined when none runs.
 */
export function findTestSrt(): string | undefined {
  const explicit = process.env['AGIDE_SRT_BIN'];
  if (explicit) return findExecutable(explicit);
  const pointer = '/tmp/agide-srt-prefix.txt';
  if (existsSync(pointer)) {
    const candidate = join(readFileSync(pointer, 'utf8').trim(), 'node_modules', '.bin', 'srt');
    if (findExecutable(candidate)) return candidate;
  }
  return findExecutable('srt');
}

/** Why the container tests cannot run here, or undefined when Docker runs and the test image is local. */
export function containerTestsUnavailable(): string | undefined {
  if (findExecutable('docker') === undefined) return 'docker is not installed';
  try {
    execFileSync('docker', ['image', 'inspect', TEST_IMAGE], { stdio: 'ignore', timeout: 8000 });
    return undefined;
  } catch {
    return `docker is not running or ${TEST_IMAGE} is not local`;
  }
}

export function srtTestsUnavailable(): string | undefined {
  return findTestSrt() === undefined ? 'srt is not installed' : undefined;
}
