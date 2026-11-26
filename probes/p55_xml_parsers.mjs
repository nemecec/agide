// README: P55, XML parsers against hostile test reports (checks-design, 2026-11-26).
// Candidates: saxes 6.0.0 (already in the app's node_modules as a dependency of jsdom), fast-xml-parser 5.11.2
// (taken from the local npm cache with `npm pack --offline`; pass its unpacked directory as FXP_DIR) with entity
// processing on (its default) and off, and the prototype JUnit subset reader of p_checks_lib.mjs.
// Cases: a valid report, billion laughs, very deep nesting, a huge attribute, a DOCTYPE with an external entity that
// names a canary file, an undeclared entity, and 200 MB of test cases. Each candidate and case runs in its own Node
// process with --max-old-space-size=2048 and a time limit; the child reports the outcome, the time and the peak RSS.
// Usage: FXP_DIR=<dir> node probes/p55_xml_parsers.mjs [case]...
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync, createReadStream, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP, TMP, run, save, readJUnit, JUNIT_LIMITS } from './p_checks_lib.mjs';

const ROOT = join(TMP, 'p55');
const SELF = fileURLToPath(import.meta.url);
const SAXES = join(APP, 'node_modules', '.pnpm', 'saxes@6.0.0', 'node_modules', 'saxes');
const FXP = process.env.FXP_DIR ? join(process.env.FXP_DIR, 'lib', 'fxp.cjs') : undefined;
const CANARY = 'canary-7f3a';

// ---------------------------------------------------------------------------------------------------------------
// Child: parse one file with one candidate.
if (process.argv[2] === '--child') {
  const [, , , candidate, file] = process.argv;
  const started = Date.now();
  const out = { candidate, file: file.split('/').at(-1) };
  try {
    let cases = 0;
    let sample = '';
    if (candidate === 'saxes') {
      const { SaxesParser } = createRequire(import.meta.url)(SAXES);
      const parser = new SaxesParser({ xmlns: false });
      let failure;
      parser.on('error', (error) => { failure ??= error; });
      parser.on('opentag', (node) => { if (node.name === 'testcase') { cases++; sample ||= String(node.attributes.name ?? '').slice(0, 80); } });
      parser.on('text', (text) => { if (text.includes(CANARY)) sample = `canary in text: ${text.slice(0, 40)}`; });
      for await (const chunk of createReadStream(file, { encoding: 'utf8', highWaterMark: 64 * 1024 })) {
        parser.write(chunk);
        if (failure) throw failure;
      }
      parser.close();
      if (failure) throw failure;
    } else if (candidate.startsWith('fxp')) {
      const { XMLParser } = createRequire(import.meta.url)(FXP);
      const options = { ignoreAttributes: false, attributeNamePrefix: '', isArray: (name) => name === 'testcase' || name === 'testsuite' };
      const parser = new XMLParser(candidate === 'fxp-off' ? { ...options, processEntities: false } : options);
      const tree = parser.parse(readFileSync(file, 'utf8'));
      const walk = (node, depth) => {
        if (depth > 10_000 || node === null || typeof node !== 'object') return;
        for (const [key, value] of Object.entries(node)) {
          if (key === 'testcase') for (const item of value) { cases++; sample ||= String(item.name ?? '').slice(0, 80); }
          else walk(value, depth + 1);
        }
      };
      walk(tree, 0);
      const text = JSON.stringify(tree).slice(0, 5_000_000);
      if (text.includes(CANARY)) sample = 'canary present in the parse tree';
      out.treeChars = text.length;
    } else {
      const limits = candidate === 'prototype-unlimited' ? { ...JUNIT_LIMITS, bytes: Infinity, testcases: Infinity } : JUNIT_LIMITS;
      const report = await readJUnit(createReadStream(file, { highWaterMark: 64 * 1024 }), limits);
      cases = report.cases.length;
      sample = report.cases[0]?.name.slice(0, 80) ?? '';
    }
    Object.assign(out, { outcome: 'parsed', cases, sample });
  } catch (error) {
    Object.assign(out, { outcome: 'refused', error: String(error?.message ?? error).split('\n')[0].slice(0, 160) });
  }
  out.ms = Date.now() - started;
  out.maxRssMb = Math.round(process.resourceUsage().maxRSS / 1024);
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

// ---------------------------------------------------------------------------------------------------------------
// Parent: write the inputs and run every candidate on every case.
mkdirSync(ROOT, { recursive: true });
const canaryFile = join(ROOT, 'canary.txt');
writeFileSync(canaryFile, `${CANARY}\n`);

const head = '<?xml version="1.0" encoding="UTF-8"?>\n';
const inputs = {
  valid: `${head}<testsuites><testsuite name="s" tests="2"><testcase classname="c" name="a &amp; b"/><testcase classname="c" name="fails"><failure message="x">boom</failure></testcase></testsuite></testsuites>\n`,
  billion_laughs: `${head}<!DOCTYPE lolz [\n<!ENTITY lol "lol">\n${Array.from({ length: 9 }, (_, i) => `<!ENTITY lol${i + 1} "${`&lol${i === 0 ? '' : i};`.repeat(10)}">`).join('\n')}\n]>\n<testsuites><testsuite name="s"><testcase classname="c" name="&lol9;"/></testsuite></testsuites>\n`,
  deep_nesting: `${head}<testsuites>${'<a>'.repeat(200_000)}${'</a>'.repeat(200_000)}</testsuites>\n`,
  huge_attribute: `${head}<testsuites><testsuite name="s"><testcase classname="c" name="${'x'.repeat(50 * 1024 * 1024)}"/></testsuite></testsuites>\n`,
  external_entity: `${head}<!DOCTYPE testsuites [ <!ENTITY ext SYSTEM "file://${canaryFile}"> ]>\n<testsuites><testsuite name="s"><testcase classname="c" name="&ext;"><failure message="&ext;">&ext;</failure></testcase></testsuite></testsuites>\n`,
  undeclared_entity: `${head}<testsuites><testsuite name="s"><testcase classname="c" name="&nope;"/></testsuite></testsuites>\n`,
};

const only = process.argv.slice(2);
const files = {};
for (const [name, text] of Object.entries(inputs)) {
  if (only.length > 0 && !only.includes(name)) continue;
  files[name] = join(ROOT, `${name}.xml`);
  writeFileSync(files[name], text);
}

if (only.length === 0 || only.includes('testcases_200mb')) {
  const path = join(ROOT, 'testcases_200mb.xml');
  if (!existsSync(path) || statSync(path).size < 200 * 1024 * 1024) {
    const stream = createWriteStream(path);
    stream.write(`${head}<testsuites><testsuite name="big">\n`);
    let written = 0;
    let i = 0;
    const line = () => `<testcase classname="pkg.Class${i % 997}" name="test number ${i}" time="0.001"/>\n`;
    while (written < 200 * 1024 * 1024) {
      const chunk = Array.from({ length: 10_000 }, () => { i++; return line(); }).join('');
      written += chunk.length;
      if (!stream.write(chunk)) await new Promise((resolve) => stream.once('drain', resolve));
    }
    stream.end('</testsuite></testsuites>\n');
    await new Promise((resolve) => stream.on('finish', resolve));
  }
  files.testcases_200mb = path;
}

const candidates = ['prototype', 'saxes', ...(FXP ? ['fxp-default', 'fxp-off'] : [])];
const results = [];
for (const [name, file] of Object.entries(files)) {
  for (const candidate of [...candidates, ...(name === 'testcases_200mb' ? ['prototype-unlimited'] : [])]) {
    const r = run(process.execPath, ['--max-old-space-size=2048', '--stack-size=984', SELF, '--child', candidate, file], { timeout: 180_000 });
    let parsed;
    try { parsed = JSON.parse(r.stdout); } catch { parsed = { candidate, outcome: r.signal ? `killed (${r.signal}, time limit)` : `crashed (status ${r.status})`, error: r.stderr.split('\n').filter(Boolean).slice(-2).join(' | ').slice(0, 200), ms: r.ms }; }
    parsed.case = name;
    results.push(parsed);
    console.log(JSON.stringify(parsed));
  }
}
save('p55_results.json', JSON.stringify(results, null, 2));
