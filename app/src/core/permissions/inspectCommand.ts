import { randomBytes } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runGate } from './gateRun';
import type { GateFile } from './types';

/**
 * The `PreToolUse` hook command (0028 section 3): the gate file path and the payload text in, the hook output
 * out. It writes the payload with its decision into the session's inbox directory through a temporary file
 * and a rename, so the app never reads a half-written file. Returns the hook's stdout. A missing path or a
 * payload that is not a `PreToolUse` event leaves the decision to the mode and the static ask rules.
 */
export function inspectCommand(gatePath: string | undefined, readPayload: () => string): string {
  if (gatePath === undefined) return '';
  const gate = JSON.parse(readFileSync(gatePath, 'utf8')) as GateFile;
  const run = runGate(readPayload(), gate);
  if (run === undefined) return '';
  const file = join(gate.inboxDir, `tmp-${randomBytes(6).toString('hex')}`);
  writeFileSync(file, JSON.stringify(run.record), { mode: 0o600, flag: 'wx' });
  renameSync(file, `${file}.json`);
  return run.stdout;
}
