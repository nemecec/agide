import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Writes an executable `docker` that does nothing into `directory` and returns its path, for tests that build a command and never talk to an engine. */
export function fakeDockerClient(directory: string): string {
  mkdirSync(directory, { recursive: true });
  const path = join(directory, 'docker');
  writeFileSync(path, '#!/bin/sh\nexit 0\n');
  chmodSync(path, 0o755);
  return path;
}
