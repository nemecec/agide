import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** True when the volume of the temporary directory ignores letter case (the default APFS volume does). For tests that need a case variant of a directory. */
export function caseInsensitiveVolume(): boolean {
  const probe = mkdtempSync(join(tmpdir(), 'case-probe-'));
  try {
    mkdirSync(join(probe, 'Probe'));
    return existsSync(join(probe, 'PROBE'));
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
}
