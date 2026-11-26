// README: P50. Which events a recursive fs.watch on macOS reports for the file operations a mount sees:
// create, change, atomic saves of editors, renames, moves out of and into the mount, symlinks that leave it,
// metadata changes, hidden files, a burst of writes, and the removal or rename of the mount root. A second part
// watches a single file (a mounted file) through an atomic save. Run with plain Node, with
// ELECTRON_RUN_AS_NODE=1 and the Electron binary, and as an Electron main script (`electron p50_watch_events.mjs`).
// Output: probes/out/p50_watch_events_<runtime>.json.
import { appendFileSync, chmodSync, mkdirSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, utimesSync, watch, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EventLog, removeDir, runtimeFacts, runtimeLabel, sleep, tempDir, writeOut } from './p_notes_lib.mjs';

const SETTLE_MS = Number(process.env.P50_SETTLE_MS ?? 600);

async function directoryWatch() {
  const base = tempDir('p50');
  const root = join(base, 'mount');
  const outside = join(base, 'outside');
  mkdirSync(root);
  mkdirSync(outside);
  writeFileSync(join(outside, 'secret.md'), 'outside\n');
  const log = new EventLog();
  let errors = [];
  let closed = false;
  const watcher = watch(root, { recursive: true }, (type, filename) => log.push(type, filename));
  watcher.on('error', (error) => errors.push({ code: error.code, message: error.message }));
  watcher.on('close', () => { closed = true; });
  await sleep(SETTLE_MS);
  log.take();
  const steps = [];
  const step = async (name, run) => {
    const t0 = Math.round(performance.now() - log.start);
    run();
    await sleep(SETTLE_MS);
    const events = log.take();
    steps.push({ name, events, firstLatencyMs: events.length ? events[0].t - t0 : null, errors, closed });
    errors = [];
  };
  const p = (...parts) => join(root, ...parts);
  await step('create a.md', () => writeFileSync(p('a.md'), '# A\n'));
  await step('append to a.md', () => appendFileSync(p('a.md'), 'more\n'));
  await step('atomic save: write .a.md.tmp, rename over a.md', () => { writeFileSync(p('.a.md.tmp'), '# A2\n'); renameSync(p('.a.md.tmp'), p('a.md')); });
  await step('backup save: rename a.md to a.md~, write a.md, unlink a.md~', () => { renameSync(p('a.md'), p('a.md~')); writeFileSync(p('a.md'), '# A3\n'); unlinkSync(p('a.md~')); });
  await step('rename a.md to b.md', () => renameSync(p('a.md'), p('b.md')));
  await step('mkdir sub and create sub/c.md', () => { mkdirSync(p('sub')); writeFileSync(p('sub', 'c.md'), 'c\n'); });
  await step('mkdir -p d1/d2/d3 and create a file there', () => { mkdirSync(p('d1', 'd2', 'd3'), { recursive: true }); writeFileSync(p('d1', 'd2', 'd3', 'deep.md'), 'deep\n'); });
  await step('move sub/c.md out of the mount', () => renameSync(p('sub', 'c.md'), join(outside, 'c.md')));
  await step('move outside/c.md into the mount', () => renameSync(join(outside, 'c.md'), p('c-in.md')));
  await step('symlink link-out -> outside directory', () => symlinkSync(outside, p('link-out')));
  await step('write outside/secret.md (reachable through link-out)', () => appendFileSync(join(outside, 'secret.md'), 'changed\n'));
  await step('write through the link: link-out/new.md', () => writeFileSync(p('link-out', 'new.md'), 'via link\n'));
  await step('symlink b-link.md -> b.md inside the mount', () => symlinkSync(p('b.md'), p('b-link.md')));
  await step('chmod b.md 0600', () => chmodSync(p('b.md'), 0o600));
  await step('utimes b.md (touch)', () => utimesSync(p('b.md'), new Date(), new Date()));
  await step('create hidden .hidden/x.md', () => { mkdirSync(p('.hidden')); writeFileSync(p('.hidden', 'x.md'), 'x\n'); });
  await step('burst: 200 appends to b.md', () => { for (let i = 0; i < 200; i += 1) appendFileSync(p('b.md'), `${i}\n`); });
  await step('burst: create 300 files in burst/', () => { mkdirSync(p('burst')); for (let i = 0; i < 300; i += 1) writeFileSync(p('burst', `f${i}.md`), `${i}\n`); });
  await step('delete b.md', () => unlinkSync(p('b.md')));
  await step('rm -r sub and d1', () => { rmSync(p('sub'), { recursive: true }); rmSync(p('d1'), { recursive: true }); });
  await step('rename the mount root to mount-moved', () => renameSync(root, join(base, 'mount-moved')));
  await step('write into the moved root', () => writeFileSync(join(base, 'mount-moved', 'after-move.md'), 'x\n'));
  await step('recreate a directory at the old root path and write a file', () => { mkdirSync(root); writeFileSync(join(root, 'new-root.md'), 'x\n'); });
  await step('remove the root', () => rmSync(root, { recursive: true }));
  watcher.close();
  removeDir(base);
  return { root, realRoot: '(removed)', steps };
}

async function fileWatch() {
  const base = tempDir('p50f');
  const file = join(base, 'note.md');
  writeFileSync(file, 'v1\n');
  const log = new EventLog();
  const watcher = watch(file, (type, filename) => log.push(type, filename));
  const errors = [];
  watcher.on('error', (error) => errors.push(error.code));
  await sleep(SETTLE_MS);
  log.take();
  const steps = [];
  const step = async (name, run) => {
    run();
    await sleep(SETTLE_MS);
    steps.push({ name, events: log.take() });
  };
  await step('append', () => appendFileSync(file, 'v2\n'));
  await step('atomic save (tmp + rename over)', () => { writeFileSync(`${file}.tmp`, 'v3\n'); renameSync(`${file}.tmp`, file); });
  await step('append after the atomic save', () => appendFileSync(file, 'v4\n'));
  await step('second atomic save', () => { writeFileSync(`${file}.tmp`, 'v5\n'); renameSync(`${file}.tmp`, file); });
  await step('unlink', () => unlinkSync(file));
  watcher.close();
  const parentLog = new EventLog();
  writeFileSync(file, 'v1\n');
  const parent = watch(base, (type, filename) => parentLog.push(type, filename));
  await sleep(SETTLE_MS);
  parentLog.take();
  const parentSteps = [];
  const pstep = async (name, run) => {
    run();
    await sleep(SETTLE_MS);
    parentSteps.push({ name, events: parentLog.take() });
  };
  await pstep('parent watch (non-recursive): append', () => appendFileSync(file, 'v2\n'));
  await pstep('parent watch: atomic save', () => { writeFileSync(`${file}.tmp`, 'v3\n'); renameSync(`${file}.tmp`, file); });
  await pstep('parent watch: append after atomic save', () => appendFileSync(file, 'v4\n'));
  parent.close();
  removeDir(base);
  return { steps, errors, parentSteps };
}

async function main() {
  const facts = { ...runtimeFacts(), settleMs: SETTLE_MS, tmpRealpath: realpathSync('/tmp') };
  const directory = await directoryWatch();
  const file = await fileWatch();
  const path = writeOut(`p50_watch_events_${runtimeLabel()}.json`, { facts, directory, file });
  console.log(path);
}

// The Electron main process emits `ready` only after the main module finished loading, so a top-level await on
// `whenReady` never returns; the electron-main branch therefore chains promises.
if (runtimeLabel() === 'electron-main') {
  import('electron').then(({ app }) => {
    app.dock?.hide();
    app.whenReady().then(main).finally(() => app.quit());
  });
} else {
  await main();
}
