#!/usr/bin/env node
// A stand-in for Anthropic's sandbox runtime: `srt -s <settings> -- <command> <args>`. It records its arguments
// and the settings file to $FAKE_SRT_RECORD and runs the command after `--` with the same terminal.
import { spawn } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const split = args.indexOf('--');
const settingsPath = args[args.indexOf('-s') + 1];
appendFileSync(process.env.FAKE_SRT_RECORD, JSON.stringify({ args, settings: JSON.parse(readFileSync(settingsPath, 'utf8')) }) + '\n');
const [command, ...rest] = args.slice(split + 1);
const child = spawn(command, rest, { stdio: 'inherit' });
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => child.kill(signal));
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
