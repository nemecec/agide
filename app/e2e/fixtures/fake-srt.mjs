#!/usr/bin/env node
// A stand-in for Anthropic's sandbox runtime: `srt -s <settings> -- <command> <args>`. It records its arguments,
// the names of its environment and of its loader variables, its working directory, its PATH and the settings file to $FAKE_SRT_RECORD and runs the command after `--` with the same terminal.
import { spawn } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const split = args.indexOf('--');
const settingsPath = args[args.indexOf('-s') + 1];
const loader = Object.keys(process.env).filter((name) => /^(NODE_OPTIONS|NODE_PATH|DYLD_|LD_)/.test(name));
// The app gives this process the allowed variables, and every other variable of the profile under the prefix AGIDE_INSIDE_, which is where the record path is read from.
const record = process.env.FAKE_SRT_RECORD ?? process.env.AGIDE_INSIDE_FAKE_SRT_RECORD;
appendFileSync(record, JSON.stringify({ args, loader, names: Object.keys(process.env), cwd: process.cwd(), path: process.env.PATH, settings: JSON.parse(readFileSync(settingsPath, 'utf8')) }) + '\n');
const [command, ...rest] = args.slice(split + 1);
const child = spawn(command, rest, { stdio: 'inherit' });
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => child.kill(signal));
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
