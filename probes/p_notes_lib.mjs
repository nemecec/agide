// README: shared helpers for the notes and mounts probes P50 to P53 (Node ESM, no dependencies, no model calls).
// Every directory a probe makes lives under /tmp/agide-notes-design/ and is removed by the probe at its end.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const OUT = join(HERE, 'out');
export const TMP_BASE = '/tmp/agide-notes-design';
mkdirSync(OUT, { recursive: true });
mkdirSync(TMP_BASE, { recursive: true });

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** `node` for plain Node, `electron-node` under ELECTRON_RUN_AS_NODE, `electron-main` in the Electron main process. */
export function runtimeLabel() {
  if (!process.versions.electron) return 'node';
  return process.type === 'browser' ? 'electron-main' : 'electron-node';
}

export function runtimeFacts() {
  return { runtime: runtimeLabel(), node: process.versions.node, electron: process.versions.electron ?? null, uv: process.versions.uv, sqlite: process.versions.sqlite ?? null, platform: process.platform, release: process.release.name };
}

/** A fresh directory under the probe base. */
export function tempDir(label) {
  return mkdtempSync(join(TMP_BASE, `${label}-`));
}

export function removeDir(path) {
  rmSync(path, { recursive: true, force: true });
}

export function writeOut(name, data) {
  const path = join(OUT, name);
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
  return path;
}

/** Collects fs.watch events with their time since `start`. */
export class EventLog {
  constructor() {
    this.start = performance.now();
    this.events = [];
    this.mark = 0;
  }
  push(type, filename) {
    this.events.push({ t: Math.round(performance.now() - this.start), type, filename: filename === null ? null : String(filename) });
  }
  /** Events since the previous call. */
  take() {
    const slice = this.events.slice(this.mark);
    this.mark = this.events.length;
    return slice;
  }
}

/** CPU milliseconds (user plus system) used by this process since `since`. */
export function cpuMs(since) {
  const usage = process.cpuUsage(since);
  return Math.round((usage.user + usage.system) / 1000);
}

export const mb = (bytes) => Math.round((bytes / 1024 / 1024) * 10) / 10;
