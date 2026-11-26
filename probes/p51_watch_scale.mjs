// README: P51. Cost of watching and listing a mounted directory of 20000 files in 200 directories: the time of a
// full scan, the memory, descriptors and CPU of one recursive fs.watch, idle and under a burst of 2000 changes,
// how a trailing debounce batches the burst, and the same for one non-recursive watcher per directory and for
// ten recursive watchers. Run with plain Node and with ELECTRON_RUN_AS_NODE=1 and the Electron binary.
// Output: probes/out/p51_watch_scale_<runtime>.json. P51_FILES and P51_DIRS change the size.
import { appendFileSync, mkdirSync, readdirSync, lstatSync, writeFileSync, watch } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { cpuMs, mb, removeDir, runtimeFacts, runtimeLabel, sleep, tempDir, writeOut } from './p_notes_lib.mjs';

const FILES = Number(process.env.P51_FILES ?? 20000);
const DIRS = Number(process.env.P51_DIRS ?? 200);
const BURST = 2000;
const DEBOUNCE_MS = 100;

const openDescriptors = () => readdirSync('/dev/fd').length;
const memory = () => {
  const usage = process.memoryUsage();
  return { rssMb: mb(usage.rss), heapUsedMb: mb(usage.heapUsed), externalMb: mb(usage.external) };
};

function build(root) {
  const t0 = performance.now();
  const perDir = Math.ceil(FILES / DIRS);
  let made = 0;
  for (let d = 0; d < DIRS; d += 1) {
    const dir = join(root, `dir${d}`);
    mkdirSync(dir);
    for (let f = 0; f < perDir && made < FILES; f += 1, made += 1) writeFileSync(join(dir, `note${f}.md`), `# note ${d}/${f}\n`);
  }
  return { files: made, dirs: DIRS, ms: Math.round(performance.now() - t0) };
}

async function scan(root) {
  const t0 = performance.now();
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const readdirMs = Math.round(performance.now() - t0);
  const t1 = performance.now();
  let files = 0;
  for (const entry of entries) {
    const stat = lstatSync(join(entry.parentPath, entry.name));
    if (stat.isFile()) files += 1;
  }
  return { entries: entries.length, files, readdirMs, lstatAllMs: Math.round(performance.now() - t1) };
}

/** Feeds events into a trailing debounce and counts the batches it would deliver. */
function debouncer() {
  const state = { batches: [], pending: new Set(), timer: undefined, events: 0, firstAt: undefined, lastAt: undefined };
  const flush = () => {
    state.batches.push(state.pending.size);
    state.pending = new Set();
    state.timer = undefined;
  };
  return {
    state,
    push(filename) {
      const now = performance.now();
      state.events += 1;
      state.firstAt ??= now;
      state.lastAt = now;
      state.pending.add(String(filename));
      clearTimeout(state.timer);
      state.timer = setTimeout(flush, DEBOUNCE_MS);
    },
  };
}

async function burst(root, deb, label) {
  const t0 = performance.now();
  const cpu0 = process.cpuUsage();
  const perDir = Math.ceil(FILES / DIRS);
  for (let i = 0; i < BURST; i += 1) appendFileSync(join(root, `dir${i % DIRS}`, `note${Math.floor(i / DIRS) % perDir}.md`), 'x\n');
  const writeMs = Math.round(performance.now() - t0);
  await sleep(1500);
  const s = deb.state;
  return {
    label,
    writes: BURST,
    writeMs,
    events: s.events,
    uniqueFilenamesInBatches: s.batches.reduce((a, b) => a + b, 0),
    batches: s.batches.length,
    largestBatch: Math.max(0, ...s.batches),
    firstEventAfterMs: s.firstAt === undefined ? null : Math.round(s.firstAt - t0),
    lastEventAfterMs: s.lastAt === undefined ? null : Math.round(s.lastAt - t0),
    cpuMsDuringBurstAndSettle: cpuMs(cpu0),
  };
}

async function idleCpu(ms) {
  const cpu0 = process.cpuUsage();
  await sleep(ms);
  return { windowMs: ms, cpuMs: cpuMs(cpu0) };
}

async function main() {
  const facts = { ...runtimeFacts(), files: FILES, dirs: DIRS, burst: BURST, debounceMs: DEBOUNCE_MS };
  const base = tempDir('p51');
  const root = join(base, 'vault');
  mkdirSync(root);
  const result = { facts };
  try {
    result.build = build(root);
    result.scan = await scan(root);
    result.baseline = { memory: memory(), descriptors: openDescriptors(), idle: await idleCpu(2000) };

    const deb = debouncer();
    const t0 = performance.now();
    const recursive = watch(root, { recursive: true }, (_type, filename) => deb.push(filename));
    const setupMs = Math.round(performance.now() - t0);
    await sleep(1000);
    result.recursive = { setupMs, memory: memory(), descriptors: openDescriptors(), idle: await idleCpu(3000), eventsWhileIdle: deb.state.events };
    result.recursive.burst = await burst(root, deb, 'one recursive watcher');
    recursive.close();
    await sleep(300);
    result.afterClose = { memory: memory(), descriptors: openDescriptors() };

    const deb2 = debouncer();
    const t1 = performance.now();
    const perDirectory = [root, ...Array.from({ length: DIRS }, (_, d) => join(root, `dir${d}`))].map((dir) => watch(dir, (_type, filename) => deb2.push(filename)));
    const setup2 = Math.round(performance.now() - t1);
    await sleep(1000);
    result.perDirectory = { watchers: perDirectory.length, setupMs: setup2, memory: memory(), descriptors: openDescriptors(), idle: await idleCpu(3000) };
    result.perDirectory.burst = await burst(root, deb2, 'one non-recursive watcher per directory');
    for (const w of perDirectory) w.close();
    await sleep(300);

    const deb3 = debouncer();
    const ten = Array.from({ length: 10 }, (_, d) => watch(join(root, `dir${d}`), { recursive: true }, (_type, filename) => deb3.push(filename)));
    await sleep(1000);
    result.tenRecursive = { watchers: ten.length, memory: memory(), descriptors: openDescriptors(), idle: await idleCpu(3000) };
    for (const w of ten) w.close();

    const deb4 = debouncer();
    const late = watch(root, { recursive: true }, (_type, filename) => deb4.push(filename));
    await sleep(500);
    const t2 = performance.now();
    const fresh = join(root, 'fresh');
    mkdirSync(fresh);
    for (let i = 0; i < 5000; i += 1) writeFileSync(join(fresh, `n${i}.md`), 'n\n');
    await sleep(2000);
    result.createBurst = { created: 5000, writeAndSettleMs: Math.round(performance.now() - t2), events: deb4.state.events, uniqueInBatches: deb4.state.batches.reduce((a, b) => a + b, 0), batches: deb4.state.batches.length };
    late.close();
  } finally {
    removeDir(base);
  }
  console.log(writeOut(`p51_watch_scale_${runtimeLabel()}.json`, result));
}

await main();
