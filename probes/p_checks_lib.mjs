// README: shared helpers for the checks-design probes P54 to P56 (Node ESM, no dependencies). Not run directly.
// Holds the prototype of a streaming reader for the JUnit XML subset that test tools write, a libtest text reader,
// and the sanitizer that keeps host names, user names and absolute paths out of stored samples.
import { spawnSync } from 'node:child_process';
import { hostname, homedir, userInfo } from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const OUT = join(HERE, 'out');
export const TMP = '/tmp/agide-checks-design';
export const APP = join(HERE, '..', 'app');
mkdirSync(OUT, { recursive: true });
mkdirSync(TMP, { recursive: true });

export function run(file, args, options = {}) {
  const started = Date.now();
  const result = spawnSync(file, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: options.timeout ?? 300_000, ...options });
  return { status: result.status, signal: result.signal, stdout: result.stdout ?? '', stderr: result.stderr ?? '', ms: Date.now() - started, error: result.error?.message };
}

/** Replaces the host name, the user name, the home directory and the temporary root, so a stored sample names none of them. */
export function sanitize(text) {
  const user = userInfo().username;
  const host = hostname();
  let out = text.split('/private' + TMP).join('<tmp>').split(TMP).join('<tmp>').split(homedir()).join('~');
  if (host) out = out.split(host).join('<host>');
  out = out.split(host.replace(/\.local$/, '')).join('<host>');
  if (user.length > 2) out = out.split(user).join('<user>');
  return out;
}

export function save(name, text) {
  const path = join(OUT, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, sanitize(text));
  return path;
}

// ---------------------------------------------------------------------------------------------------------------
// Prototype streaming reader for the JUnit subset.
//
// It reads bytes in chunks and never builds a tree. It knows elements, attributes, the five predefined entities and
// numeric character references; it refuses a DOCTYPE, an entity declaration, an unknown entity, a processing
// instruction other than the XML declaration, a CDATA section outside failure and system-out text, and any limit
// overrun. Text is kept only inside failure, error and skipped elements (the message), cut to a limit.

export const JUNIT_LIMITS = {
  bytes: 64 * 1024 * 1024,
  depth: 32,
  attributeChars: 8 * 1024,
  nameChars: 1_024,
  testcases: 100_000,
  messageChars: 2_000,
  attributes: 32,
};

export class JUnitRefused extends Error {
  constructor(code, detail) {
    super(`${code}: ${detail}`);
    this.code = code;
  }
}

const PREDEFINED = { lt: '<', gt: '>', amp: '&', apos: "'", quot: '"' };
const KEEP_TEXT = new Set(['failure', 'error', 'skipped']);

function decodeEntities(raw, limits) {
  if (!raw.includes('&')) return raw;
  return raw.replace(/&([^;]{0,12});/g, (_, name) => {
    if (name in PREDEFINED) return PREDEFINED[name];
    const hex = /^#x([0-9a-fA-F]{1,6})$/.exec(name);
    const dec = /^#([0-9]{1,7})$/.exec(name);
    const code = hex ? parseInt(hex[1], 16) : dec ? parseInt(dec[1], 10) : -1;
    if (code < 0) throw new JUnitRefused('entity', `unknown entity &${name.slice(0, 12)};`);
    if (code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) throw new JUnitRefused('entity', 'character reference out of range');
    return String.fromCodePoint(code);
  }).slice(0, limits.attributeChars);
}

/**
 * Reads a JUnit report from an async iterable of Buffers. Returns { suites, cases } where a case is
 * { suite, classname, name, status: 'passed'|'failed'|'error'|'skipped', message, time }.
 */
export async function readJUnit(chunks, limits = JUNIT_LIMITS) {
  const cases = [];
  const suites = [];
  const stack = [];
  let total = 0;
  let buffer = '';
  let current; // the open testcase
  let text = '';
  let ended = false;

  const attrs = (source) => {
    const out = {};
    let count = 0;
    const re = /([A-Za-z_][\w.:-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let match;
    let consumed = 0;
    while ((match = re.exec(source)) !== null) {
      if (source.slice(consumed, match.index).trim() !== '') throw new JUnitRefused('syntax', 'text between attributes');
      consumed = re.lastIndex;
      if (++count > limits.attributes) throw new JUnitRefused('limit', 'too many attributes');
      const raw = match[3] ?? match[4];
      if (raw.length > limits.attributeChars) throw new JUnitRefused('limit', 'attribute too long');
      if (raw.includes('<')) throw new JUnitRefused('syntax', '< in an attribute');
      out[match[1]] = decodeEntities(raw, limits);
    }
    if (source.slice(consumed).trim() !== '') throw new JUnitRefused('syntax', 'malformed attributes');
    return out;
  };

  const open = (name, a, selfClosing) => {
    if (ended) throw new JUnitRefused('syntax', 'content after the root element');
    if (name.length > limits.nameChars) throw new JUnitRefused('limit', 'element name too long');
    if (stack.length + 1 > limits.depth) throw new JUnitRefused('limit', 'nesting too deep');
    const parent = stack.at(-1);
    if (name === 'testsuite') suites.push({ name: (a.name ?? '').slice(0, limits.nameChars), tests: a.tests, failures: a.failures, errors: a.errors, skipped: a.skipped ?? a.disabled });
    if (name === 'testcase') {
      if (cases.length >= limits.testcases) throw new JUnitRefused('limit', 'too many test cases');
      current = { suite: suites.at(-1)?.name ?? '', classname: (a.classname ?? '').slice(0, limits.nameChars), name: (a.name ?? '').slice(0, limits.nameChars), status: 'passed', message: '', time: a.time };
      cases.push(current);
    }
    if (KEEP_TEXT.has(name) && parent === 'testcase' && current) {
      const status = name === 'failure' ? 'failed' : name === 'error' ? 'error' : 'skipped';
      // failed and error win over skipped; nextest flaky reruns use flakyFailure and rerunFailure, which do not change the status
      if (current.status === 'passed' || status !== 'skipped') current.status = status;
      if (a.message !== undefined && current.message === '') current.message = a.message.slice(0, limits.messageChars);
      text = '';
    }
    if (!selfClosing) stack.push(name);
    else if (stack.length === 0) ended = true;
    if (selfClosing && name === 'testcase') current = undefined;
  };

  const close = (name) => {
    const top = stack.pop();
    if (top !== name) throw new JUnitRefused('syntax', 'mismatched end tag');
    if (KEEP_TEXT.has(name) && current && current.message === '') current.message = text.trim().slice(0, limits.messageChars);
    if (name === 'testcase') current = undefined;
    if (stack.length === 0) ended = true;
  };

  const step = (final) => {
    for (;;) {
      const lt = buffer.indexOf('<');
      if (lt < 0) {
        if (stack.length > 0 && KEEP_TEXT.has(stack.at(-1)) && text.length < limits.messageChars) text += decodeEntities(buffer.slice(0, limits.messageChars), limits);
        buffer = '';
        return;
      }
      if (lt > 0) {
        const chunk = buffer.slice(0, lt);
        if (stack.length === 0 && chunk.trim() !== '') throw new JUnitRefused('syntax', 'text outside the root element');
        if (KEEP_TEXT.has(stack.at(-1)) && text.length < limits.messageChars) text += decodeEntities(chunk.slice(0, limits.messageChars), limits);
        buffer = buffer.slice(lt);
      }
      if (buffer.startsWith('<!--')) {
        const end = buffer.indexOf('-->');
        if (end < 0) return keepOrFail(final, 'comment');
        buffer = buffer.slice(end + 3);
        continue;
      }
      if (buffer.startsWith('<![CDATA[')) {
        const end = buffer.indexOf(']]>');
        if (end < 0) {
          // system-out of a long run can hold a long CDATA section: keep only what the message needs and drop the rest
          if (buffer.length > limits.attributeChars * 4) {
            if (KEEP_TEXT.has(stack.at(-1)) && text.length < limits.messageChars) text += buffer.slice(9, 9 + limits.messageChars);
            buffer = '<![CDATA[' + buffer.slice(-2);
          }
          return keepOrFail(final, 'cdata');
        }
        if (KEEP_TEXT.has(stack.at(-1)) && text.length < limits.messageChars) text += buffer.slice(9, Math.min(end, 9 + limits.messageChars));
        buffer = buffer.slice(end + 3);
        continue;
      }
      if (buffer.startsWith('<!')) throw new JUnitRefused('doctype', 'DOCTYPE or declaration');
      if (buffer.startsWith('<?')) {
        const end = buffer.indexOf('?>');
        if (end < 0) return keepOrFail(final, 'declaration');
        if (!/^<\?xml\s/.test(buffer) || suites.length + stack.length > 0) throw new JUnitRefused('pi', 'processing instruction');
        buffer = buffer.slice(end + 2);
        continue;
      }
      const gt = buffer.indexOf('>');
      if (gt < 0) {
        if (buffer.length > limits.attributeChars * limits.attributes + limits.nameChars) throw new JUnitRefused('limit', 'tag too long');
        return keepOrFail(final, 'tag');
      }
      const tag = buffer.slice(1, gt);
      buffer = buffer.slice(gt + 1);
      if (tag.startsWith('/')) {
        close(tag.slice(1).trim());
        continue;
      }
      const selfClosing = tag.endsWith('/');
      const body = selfClosing ? tag.slice(0, -1) : tag;
      const name = /^[A-Za-z_][\w.:-]*/.exec(body)?.[0];
      if (!name) throw new JUnitRefused('syntax', 'bad element name');
      open(name, attrs(body.slice(name.length)), selfClosing);
    }
  };
  const keepOrFail = (final, what) => {
    if (final) throw new JUnitRefused('syntax', `unterminated ${what}`);
  };

  const decoder = new TextDecoder('utf-8', { fatal: false });
  for await (const chunk of chunks) {
    total += chunk.length;
    if (total > limits.bytes) throw new JUnitRefused('limit', 'report too large');
    buffer += decoder.decode(chunk, { stream: true });
    step(false);
  }
  buffer += decoder.decode();
  step(true);
  if (stack.length > 0) throw new JUnitRefused('syntax', 'unclosed element');
  return { suites, cases };
}

export async function* bufferChunks(buffer, size = 64 * 1024) {
  for (let i = 0; i < buffer.length; i += size) yield buffer.subarray(i, i + size);
}

// ---------------------------------------------------------------------------------------------------------------
// libtest text lines (plain `cargo test`): `test <path> ... ok|FAILED|ignored[, reason]` and the result line.

export function readLibtest(text) {
  const cases = [];
  const results = [];
  const runs = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    const running = /^running (\d+) tests?$/.exec(line);
    if (running) runs.push(Number(running[1]));
    const match = /^test (.+?) \.\.\. (ok|FAILED|ignored(?:, .*)?|bench:.*)$/.exec(line);
    if (match) {
      const status = match[2] === 'ok' ? 'passed' : match[2] === 'FAILED' ? 'failed' : match[2].startsWith('ignored') ? 'skipped' : 'bench';
      const name = match[1].replace(/ - should panic$/, '');
      cases.push({ name: name.slice(0, 1_024), status });
    }
    const result = /^test result: (ok|FAILED)\. (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out/.exec(line);
    if (result) results.push({ ok: result[1] === 'ok', passed: +result[2], failed: +result[3], ignored: +result[4], measured: +result[5], filteredOut: +result[6] });
  }
  return { cases, results, runs };
}
