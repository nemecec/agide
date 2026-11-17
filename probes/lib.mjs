// README: shared helpers for the probes (Node ESM, no dependencies). Not run directly.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const WORK = join(HERE, 'work');
export const OUT = join(HERE, 'out');
export const CLAUDE = process.env.CLAUDE_BIN || 'claude';
mkdirSync(WORK, { recursive: true });
mkdirSync(OUT, { recursive: true });

// Flags every probe passes. Hooks are disabled unless a probe needs them.
export const BASE = ['--model', 'haiku', '--max-budget-usd', '0.25', '--setting-sources', 'user'];
export const NOHOOKS = ['--settings', '{"disableAllHooks":true}'];

export const userMsg = (text, extra = []) => ({
  type: 'user',
  message: { role: 'user', content: [...extra, { type: 'text', text }] },
});

// The probes run from inside another Claude Code session. Variables that session injects are removed so the
// child behaves as if launched by a desktop app. CLAUDE_CONFIG_DIR is kept: it selects the user's login.
export function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (/^(CLAUDECODE|CLAUDE_CODE_.*|CLAUDE_JOB_DIR|CLAUDE_PID|CLAUDE_AGENTS_.*|CLAUDE_EFFORT|AI_AGENT)$/.test(k)) delete env[k];
  }
  return { ...env, ...extra };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Starts claude in stream-json in/out mode. Returns a handle with events[], send(), waitFor(), end().
export function startStream(extraArgs = [], { cwd = WORK, env = {}, log } = {}) {
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
    '--include-partial-messages', ...BASE, ...extraArgs];
  const child = spawn(CLAUDE, args, { cwd, env: cleanEnv(env), stdio: ['pipe', 'pipe', 'pipe'] });
  const h = { child, events: [], stderr: '', exit: null, waiters: [], args };
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      let ev; try { ev = JSON.parse(line); } catch { ev = { type: '_unparsed', line }; }
      ev._t = Date.now();
      h.events.push(ev);
      if (log) log.write(JSON.stringify(ev) + '\n');
      h.waiters = h.waiters.filter((w) => { if (w.pred(ev)) { w.res(ev); return false; } return true; });
    }
  });
  child.stderr.on('data', (d) => { h.stderr += d; });
  h.closed = new Promise((res) => child.on('close', (code, sig) => { h.exit = { code, sig }; h.waiters.forEach((w) => w.res(null)); res(h.exit); }));
  h.send = (obj) => child.stdin.write(JSON.stringify(obj) + '\n');
  h.waitFor = (pred, ms = 90000) => {
    const hit = h.events.find(pred);
    if (hit) return Promise.resolve(hit);
    return new Promise((res) => {
      const t = setTimeout(() => res(null), ms);
      h.waiters.push({ pred, res: (e) => { clearTimeout(t); res(e); } });
    });
  };
  h.waitResult = (n = 1, ms = 90000) => new Promise((res) => {
    const check = () => h.events.filter((e) => e.type === 'result').length >= n;
    if (check()) return res(true);
    const t = setTimeout(() => res(false), ms);
    const iv = setInterval(() => { if (check() || h.exit) { clearTimeout(t); clearInterval(iv); res(check()); } }, 100);
  });
  h.end = () => { try { child.stdin.end(); } catch {} return h.closed; };
  h.kill = (sig = 'SIGTERM') => child.kill(sig);
  return h;
}

// One-shot run of claude with arbitrary args (non-stream input). Returns {stdout, stderr, code}.
export function runOnce(args, { cwd = WORK, env = {}, input, timeoutMs = 120000 } = {}) {
  return new Promise((res) => {
    const child = spawn(CLAUDE, args, { cwd, env: cleanEnv(env), stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const t = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code, sig) => { clearTimeout(t); res({ stdout, stderr, code, sig }); });
    if (input !== undefined) child.stdin.write(input);
    child.stdin.end();
  });
}

export const parseLines = (s) => s.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return { type: '_unparsed', line: l }; } });
export const save = (name, obj) => writeFileSync(join(OUT, name), typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2));
export const initOf = (events) => events.find((e) => e.type === 'system' && e.subtype === 'init');
export const resultsOf = (events) => events.filter((e) => e.type === 'result');
export const text = (ev) => (ev?.message?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
