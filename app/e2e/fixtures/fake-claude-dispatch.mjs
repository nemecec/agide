#!/usr/bin/env node
// A stand-in for the claude CLI when one test needs both launch paths: a launch with --input-format (a swarm
// agent on the stream-json path) runs the stream-json fake, every other launch (a PTY session) runs the
// session fake. Both read process.argv and the environment themselves.
const stream = process.argv.includes('--input-format');
await import(new URL(stream ? '../../src/core/swarm/fixtures/fake-claude-stream.mjs' : '../../src/core/session/fixtures/fake-claude.mjs', import.meta.url).href);
