#!/usr/bin/env node
// A stand-in for `claude` whose stdout is a script, for runtime tests that need output a real CLI rarely
// produces: lines cut in two, garbage, lines over the size limit, unknown requests, silence.
//
// $FAKE_SCRIPT_FILE: JSON array of steps, played when the first line arrives on stdin:
//   { "write": "<text>" }    writes the text as it is (a line needs its own "\n")
//   { "fill": <bytes> }      writes that many "x" characters and a newline
//   { "delayMs": <ms> }      waits
//   { "exit": <code> }       exits
// $FAKE_SCRIPT_STDIN: every line that arrives on stdin is appended to this file.
// $FAKE_SCRIPT_ACK_CONTROL: when set, every control request is answered with a success response.
// Closing stdin ends the process with code 0.
import { appendFileSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const steps = JSON.parse(readFileSync(process.env.FAKE_SCRIPT_FILE, 'utf8'));
let played = false;

async function play() {
  for (const step of steps) {
    if (step.write !== undefined) process.stdout.write(step.write);
    else if (step.fill !== undefined) process.stdout.write('x'.repeat(step.fill) + '\n');
    else if (step.delayMs !== undefined) await new Promise((resolve) => setTimeout(resolve, step.delayMs));
    else if (step.exit !== undefined) process.stdout.write('', () => process.exit(step.exit));
  }
}

const lines = createInterface({ input: process.stdin });
lines.on('line', (line) => {
  if (process.env.FAKE_SCRIPT_STDIN) appendFileSync(process.env.FAKE_SCRIPT_STDIN, line + '\n');
  if (process.env.FAKE_SCRIPT_ACK_CONTROL && line.includes('"control_request"')) {
    const request = JSON.parse(line);
    process.stdout.write(`${JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: request.request_id, response: {} } })}\n`);
    return;
  }
  if (!played) {
    played = true;
    void play();
  }
});
lines.on('close', () => process.stdout.write('', () => process.exit(0)));
