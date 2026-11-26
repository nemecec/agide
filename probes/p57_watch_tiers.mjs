// P57: costs and latencies that decide the adaptive mount watching (node only, no model).
// Usage: node p57_watch_tiers.mjs <workdir>
import { mkdirSync, writeFileSync, appendFileSync, readdirSync, lstatSync, rmSync, watch, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

const work = realpathSync(process.argv[2]);
const sizes = [200, 1000, 5000, 20000];
const PER_DIR = 100;
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r2 = (x) => Math.round(x * 100) / 100;

function build(root, n) {
  mkdirSync(root, { recursive: true });
  const dirs = [];
  for (let d = 0; d < Math.ceil(n / PER_DIR); d++) {
    const dir = join(root, `d${d}`); mkdirSync(dir); dirs.push(dir);
    for (let f = 0; f < PER_DIR && d * PER_DIR + f < n; f++) writeFileSync(join(dir, `f${f}.md`), `# note ${d}-${f}\n`);
  }
  return dirs;
}
function listDir(dir) { const out = []; for (const e of readdirSync(dir, { withFileTypes: true })) { const s = lstatSync(join(dir, e.name)); out.push([e.name, s.size, s.mtimeMs]); } return out; }
function reconcile(root) { let entries = 0; const stack = ['']; while (stack.length) { const rel = stack.pop(); const dir = join(root, rel); for (const e of readdirSync(dir, { withFileTypes: true })) { lstatSync(join(dir, e.name)); entries++; if (e.isDirectory()) stack.push(join(rel, e.name)); } } return entries; }
function count(root) { return readdirSync(root, { recursive: true }).length; }

const report = { node: process.version, platform: process.platform, tiers: [] };
for (const n of sizes) {
  const root = join(work, `m${n}`);
  const dirs = build(root, n);
  const t = { files: n, dirs: dirs.length };
  // entry count at mount time
  const c = []; for (let i = 0; i < 5; i++) { const a = performance.now(); t.entries = count(root); c.push(performance.now() - a); }
  t.countMs = r2(median(c));
  // full reconcile (readdir with types + lstat per entry, every directory)
  const rc = []; const cpu = [];
  for (let i = 0; i < 5; i++) { const u = process.cpuUsage(); const a = performance.now(); reconcile(root); rc.push(performance.now() - a); const d = process.cpuUsage(u); cpu.push((d.user + d.system) / 1000); }
  t.reconcileMs = r2(median(rc)); t.reconcileCpuMs = r2(median(cpu));
  // one directory re-list (100 entries)
  const rl = []; for (let i = 0; i < 20; i++) { const a = performance.now(); listDir(dirs[0]); rl.push(performance.now() - a); }
  t.relistDirMs = r2(median(rl));
  // event latency for single appends, 40 changes 150 ms apart
  const seen = new Map(); const w = watch(root, { recursive: true }, (_type, name) => { if (name && !seen.has(name)) seen.set(name, performance.now()); });
  await sleep(300);
  const lat = []; let lost = 0;
  for (let i = 0; i < 40; i++) {
    const dir = dirs[(i * 7) % dirs.length]; const f = `f${(i * 13) % PER_DIR}.md`; const rel = join(dir.slice(root.length + 1), f);
    seen.delete(rel); const a = performance.now(); appendFileSync(join(dir, f), `line ${i}\n`);
    await sleep(150); const b = seen.get(rel); if (b === undefined) lost++; else lat.push(b - a);
  }
  t.singleChangeMs = { median: r2(median(lat)), p95: r2(pct(lat, 0.95)), max: r2(Math.max(...lat)), lost };
  // a burst of 100 new files in one directory: first and last event after the burst started
  seen.clear(); const bdir = join(root, 'burst'); const a0 = performance.now(); mkdirSync(bdir);
  for (let i = 0; i < 100; i++) writeFileSync(join(bdir, `b${i}.md`), 'x');
  await sleep(1500); const times = [...seen.values()].map((v) => v - a0);
  t.burst100 = { events: times.length, firstMs: r2(Math.min(...times)), lastMs: r2(Math.max(...times)) };
  w.close();
  rmSync(root, { recursive: true, force: true });
  report.tiers.push(t);
}
console.log(JSON.stringify(report, null, 2));
