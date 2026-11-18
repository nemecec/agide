#!/usr/bin/env node
// A stand-in for the gh CLI. `pr view` prints the JSON in the file named by FAKE_GH_PR, or fails with the
// text in FAKE_GH_ERROR. Each call is appended to FAKE_GH_RECORD as a JSON line of its arguments.
import { appendFileSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2);
if (process.env.FAKE_GH_RECORD) appendFileSync(process.env.FAKE_GH_RECORD, `${JSON.stringify(args)}\n`);
if (process.env.FAKE_GH_ERROR) {
  process.stderr.write(`${process.env.FAKE_GH_ERROR}\n`);
  process.exit(1);
}
if (args[0] === 'pr' && args[1] === 'view' && process.env.FAKE_GH_PR) {
  process.stdout.write(readFileSync(process.env.FAKE_GH_PR, 'utf8'));
} else {
  process.stderr.write('fake gh: unsupported call\n');
  process.exit(2);
}
