#!/usr/bin/env node
// A stand-in for the claude CLI that shows the folder-trust dialog first (the frame recorded in P24) and then
// behaves like fake-claude.mjs. Down moves the highlight to "Yes, I trust this folder"; Enter on "No, exit"
// exits with code 1. FAKE_TRUST_MODE=stuck keeps the highlight on "No, exit" after Down.
import { readFileSync } from 'node:fs';

const { frame } = JSON.parse(readFileSync(new URL('./trust-dialog.json', import.meta.url), 'utf8'));
const mode = process.env.FAKE_TRUST_MODE ?? '';
let highlighted = 'no';

process.stdin.setRawMode?.(true);
process.stdin.setEncoding('utf8');

const onKey = async (chunk) => {
  // Two keys written back to back can arrive in one read; each is handled in order.
  for (const key of chunk.match(/\u001b\[B|\r/g) ?? []) if (await handleKey(key)) return;
};

const handleKey = async (chunk) => {
  if (chunk.includes('\u001b[B') && mode !== 'stuck') {
    highlighted = 'yes';
    process.stdout.write('\u001b[2G\u001b[38;2;177;185;249m❯\u001b[4GYes,\u001b[9GI\u001b[11Gtrust\u001b[17Gthis\u001b[22Gfolder\u001b[39m\r\n');
  } else if (chunk.includes('\u001b[B')) {
    process.stdout.write('\u001b[2G\u001b[38;2;177;185;249m❯\u001b[4GNo,\u001b[8Gexit\u001b[39m\r\n');
  } else if (chunk.includes('\r')) {
    if (highlighted === 'no') {
      process.stdout.write("\r\nClaude Code didn't start because this folder isn't trusted.\r\n");
      process.exit(1);
    }
    process.stdin.off('data', onKey);
    await import('../../session/fixtures/fake-claude.mjs');
    return true;
  }
  return false;
};
process.stdin.on('data', onKey);
// The frame goes out last: a reader that answers as soon as it sees the dialog finds the input handler in place.
process.stdout.write(frame);
