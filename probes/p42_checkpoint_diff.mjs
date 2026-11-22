// README: node p42_checkpoint_diff.mjs -- P42 checkpoint and diff edge cases. Builds a repo and a git worktree, simulates an agent turn (edit, add, delete, rename, chmod, binary, symlink, empty file, unusual names, large file), makes the checkpoint commit with hooks and signing disabled, collects git diff --binary --find-renames and compares a naive and a hunk-count parser with git's own -z raw output. A second part tests worktree .gitattributes and config that run programs (textconv, external diff, clean filter, fsmonitor, hooks) and the switches that disable them. No model is started.
import { join } from 'node:path';
import { mkdirSync, writeFileSync, symlinkSync, chmodSync, renameSync, rmSync, readFileSync, existsSync, statSync } from 'node:fs';
import { spawnSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fresh, cleanup, write, save } from './p_review_lib.mjs';
import { naiveParse, parseDiff } from './p42_diff_parse.mjs';

const sh = (cwd, args, { env = {}, input } = {}) => spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...env }, input, maxBuffer: 512 * 1024 * 1024 });
const must = (r, what) => { if (r.status !== 0) throw new Error(`${what}: ${r.stderr}`); return r.stdout; };
const SAFE = ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', '-c', 'core.fsmonitor=false', '-c', 'core.quotepath=true'];
const AUTHOR = { GIT_AUTHOR_NAME: 'agide', GIT_AUTHOR_EMAIL: 'agide@example.invalid', GIT_COMMITTER_NAME: 'agide', GIT_COMMITTER_EMAIL: 'agide@example.invalid' };
const lines = (n, f) => Array.from({ length: n }, (_, i) => f(i)).join('\n') + '\n';

const NAMES = ['sp ace.txt', 'tab\there.txt', 'ünï-çødé.txt', 'q"uote.txt', 'new\nline.txt', '-dash.txt', 'back\\slash.txt', 'dir with space/inner file.txt', '日本語.txt'];

function seedBase(d) {
  write(join(d, 'edit.txt'), lines(40, (i) => `line ${i}`));
  write(join(d, 'del.txt'), lines(10, (i) => `del ${i}`));
  write(join(d, 'rename-me.txt'), lines(30, (i) => `rename content ${i}`));
  write(join(d, 'mode.sh'), '#!/bin/sh\necho hi\n');
  write(join(d, 'crlf.txt'), 'a\r\nb\r\nc\r\n');
  write(join(d, 'noeol.txt'), 'no newline at end');
  write(join(d, 'bin-old.dat'), randomBytes(2048));
  write(join(d, 'typechange'), 'plain file\n');
  write(join(d, 'hooks-bait/readme'), 'x\n');
}
function agentTurn(d) {
  const t = (f) => join(d, f);
  writeFileSync(t('edit.txt'), lines(40, (i) => (i % 7 === 0 ? `line ${i} edited` : `line ${i}`)));
  write(t('new.txt'), 'brand new\n');
  rmSync(t('del.txt'));
  renameSync(t('rename-me.txt'), t('renamed.txt'));
  writeFileSync(t('renamed.txt'), lines(30, (i) => (i === 5 ? 'rename content 5 changed' : `rename content ${i}`)));
  chmodSync(t('mode.sh'), 0o755);
  writeFileSync(t('bin-old.dat'), randomBytes(4096));
  write(t('bin-new.dat'), Buffer.concat([Buffer.from([0, 1, 2, 3]), randomBytes(1000)]));
  symlinkSync('edit.txt', t('link-to-edit'));
  write(t('empty.txt'), '');
  write(t('crlf.txt'), 'a\r\nB\r\nc\r\n');
  write(t('noeol.txt'), 'no newline at end, edited');
  rmSync(t('typechange')); symlinkSync('edit.txt', t('typechange'));
  write(t('tricky-content.txt'), ['normal', '+++ b/fake.txt', '--- a/fake.txt', 'diff --git a/fake.txt b/fake.txt', '@@ -1,1 +1,1 @@', 'index 000..111', ' trailing'].join('\n') + '\n');
  for (const n of NAMES) write(t(n), `content of ${JSON.stringify(n)}\n`);
  write(t('large.txt'), lines(300000, (i) => `large file line number ${i} with some padding text to make it longer`));
}

function checkpoint(d, base) {
  must(sh(d, [...SAFE, 'add', '-A']), 'add');
  must(sh(d, [...SAFE, 'commit', '--no-verify', '-q', '-m', 'checkpoint', '--author', 'agide <agide@example.invalid>'], { env: AUTHOR }), 'commit');
  return must(sh(d, ['rev-parse', 'HEAD']), 'rev-parse').trim();
}

function truth(d, base, cp, extra = []) {
  const out = must(sh(d, ['diff', '-z', '--raw', '--find-renames', ...extra, base, cp]), 'raw');
  const parts = out.split('\0'); const files = [];
  for (let i = 0; i < parts.length - 1;) {
    const meta = parts[i++]; const st = meta.split(' ').pop()[0];
    if (st === 'R' || st === 'C') files.push({ status: st, oldPath: parts[i++], newPath: parts[i++] });
    else { const p = parts[i++]; files.push({ status: st, path: p }); }
  }
  return files;
}

async function timedDiff(d, args) {
  const t0 = Date.now();
  const child = spawn('git', args, { cwd: d });
  const chunks = []; let bytes = 0;
  child.stdout.on('data', (c) => { chunks.push(c); bytes += c.length; });
  await new Promise((r) => child.on('close', r));
  return { ms: Date.now() - t0, bytes, text: Buffer.concat(chunks).toString('utf8') };
}

async function scenario(kind) {
  const root = fresh(`p42-${kind}`);
  const main = join(root, 'main'); mkdirSync(main);
  must(sh(main, ['init', '-q', '-b', 'main']), 'init');
  // Hooks that would run, and a signing setup that would fail, if the overrides did not apply.
  write(join(main, '.git/hooks/pre-commit'), `#!/bin/sh\ntouch "${root}/HOOK_PRECOMMIT"\nexit 1\n`, 0o755);
  write(join(main, '.git/hooks/commit-msg'), `#!/bin/sh\ntouch "${root}/HOOK_COMMITMSG"\n`, 0o755);
  must(sh(main, ['config', 'commit.gpgsign', 'true']), 'cfg'); must(sh(main, ['config', 'gpg.program', '/nonexistent/gpg']), 'cfg');
  seedBase(main);
  must(sh(main, [...SAFE, 'add', '-A']), 'add'); must(sh(main, [...SAFE, 'commit', '--no-verify', '-q', '-m', 'base'], { env: AUTHOR }), 'base commit');
  const base = must(sh(main, ['rev-parse', 'HEAD']), 'rp').trim();
  let work = main;
  if (kind === 'worktree') { work = join(root, 'wt'); must(sh(main, ['worktree', 'add', '-q', '-b', 'agent', work, base]), 'worktree'); }
  agentTurn(work);
  const t0 = Date.now(); const cp = checkpoint(work, base); const checkpointMs = Date.now() - t0;
  const res = { kind, checkpointMs, hooksRan: existsSync(join(root, 'HOOK_PRECOMMIT')) || existsSync(join(root, 'HOOK_COMMITMSG')), cpAuthor: must(sh(work, ['log', '-1', '--format=%an <%ae>|%cn <%ce>', cp]), 'log').trim(), signed: must(sh(work, ['log', '-1', '--format=%G?', cp]), 'sig').trim() };
  res.statusAfter = must(sh(work, ['status', '--porcelain']), 'status').trim();

  const variants = { default: ['diff', '--binary', '--find-renames', base, cp], quotepath_false: ['-c', 'core.quotepath=false', 'diff', '--binary', '--find-renames', base, cp], no_prefix_noext: ['diff', '--binary', '--find-renames', '--no-ext-diff', '--no-textconv', '--src-prefix=a/', '--dst-prefix=b/', base, cp] };
  res.diff = {};
  const want = truth(work, base, cp);
  res.truthFiles = want.length;
  for (const [name, args] of Object.entries(variants)) {
    const r = await timedDiff(work, args);
    if (kind === 'repo' && name === 'default') save('p42_sample_diff_head.txt', r.text.split('\n').filter((l) => !/^[A-Za-z0-9+\/=]{40,}$/.test(l)).slice(0, 400).join('\n').slice(0, 60000));
    const t1 = Date.now(); const robust = parseDiff(r.text); const parseMs = Date.now() - t1;
    const naive = naiveParse(r.text);
    const wantPaths = want.map((f) => f.newPath ?? f.path).sort();
    const rob = robust.map((f) => f.path).sort();
    const nai = naive.map((f) => f.path).sort();
    const diffSet = (a, b) => ({ missing: b.filter((x) => !a.includes(x)), extra: a.filter((x) => !b.includes(x)) });
    const statusMismatch = robust.filter((f) => { const w = want.find((x) => (x.newPath ?? x.path) === f.path); return w && w.status !== f.status; }).map((f) => f.path);
    res.diff[name] = { ms: r.ms, bytes: r.bytes, parseMs, files: robust.length, hunks: robust.reduce((a, f) => a + f.hunks.length, 0), robustVsTruth: diffSet(rob, wantPaths), naiveVsTruth: diffSet(nai, wantPaths), statusMismatch, binaryFiles: robust.filter((f) => f.binary).map((f) => f.path), modeChanges: robust.filter((f) => f.mode && f.oldMode).map((f) => `${f.path} ${f.oldMode}->${f.mode}`), renames: robust.filter((f) => f.status === 'R').map((f) => `${f.oldPath}->${f.newPath} ${f.similarity}%`) };
    if (name === 'default') {
      const tr = robust.find((f) => f.path === 'tricky-content.txt');
      res.trickyContent = { robustHunks: tr?.hunks.length, naiveFiles: naive.filter((f) => /fake|tricky/.test(f.path)).map((f) => f.path), robustFakeFiles: robust.filter((f) => /fake/.test(f.path)).length };
      res.fileNames = Object.fromEntries(robust.filter((f) => NAMES.some((n) => f.path === n) || /\\|"/.test(f.header)).map((f) => [f.header.slice(0, 80), f.path]));
    }
    if (name === 'quotepath_false') res.quotepathFalseHeaders = r.text.split('\n').filter((l) => l.startsWith('diff --git') && /[^\x00-\x7f]/.test(l)).slice(0, 3);
    if (name === 'default') res.quotedHeaders = r.text.split('\n').filter((l) => l.startsWith('diff --git') && /\\"|\\[0-7]{3}|\\t|\\n/.test(l)).slice(0, 8);
  }
  // A -z numstat for counts without parsing patch text.
  res.numstatZ = must(sh(work, ['diff', '-z', '--numstat', '--find-renames', base, cp]), 'numstat').split('\0').filter(Boolean).length;
  // Scale: a few thousand changed lines across many files, no large file.
  const scale = fresh(`p42-scale-${kind}`);
  must(sh(scale, ['init', '-q', '-b', 'main']), 'init');
  for (let f = 0; f < 60; f++) write(join(scale, `src/mod${f}.ts`), lines(200, (i) => `export const v${f}_${i} = ${i};`));
  must(sh(scale, [...SAFE, 'add', '-A']), 'a'); must(sh(scale, [...SAFE, 'commit', '--no-verify', '-q', '-m', 'b'], { env: AUTHOR }), 'c');
  const sb = must(sh(scale, ['rev-parse', 'HEAD']), 'rp').trim();
  for (let f = 0; f < 60; f++) write(join(scale, `src/mod${f}.ts`), lines(200, (i) => (i % 3 === 0 ? `export const v${f}_${i} = ${i * 2}; // changed` : `export const v${f}_${i} = ${i};`)));
  const scp = checkpoint(scale, sb);
  const sd = await timedDiff(scale, ['diff', '--binary', '--find-renames', sb, scp]);
  const t2 = Date.now(); const sp = parseDiff(sd.text); const sparse = Date.now() - t2;
  res.scale = { changedLinesPerSide: sp.reduce((a, f) => a + f.hunks.reduce((b, h) => b + h.lines.filter((l) => l.startsWith('+')).length, 0), 0), files: sp.length, diffMs: sd.ms, bytes: sd.bytes, parseMs: sparse };
  cleanup(scale); cleanup(root);
  return res;
}

// Part 2: programs git may run because of files or config the agent controls.
async function programs() {
  const root = fresh('p42-prog');
  const main = join(root, 'main'); mkdirSync(main);
  must(sh(main, ['init', '-q', '-b', 'main']), 'init');
  write(join(main, 'a.txt'), 'one\n');
  must(sh(main, [...SAFE, 'add', '-A']), 'a'); must(sh(main, [...SAFE, 'commit', '--no-verify', '-q', '-m', 'base'], { env: AUTHOR }), 'c');
  const base = must(sh(main, ['rev-parse', 'HEAD']), 'rp').trim();
  const wt = join(root, 'wt'); must(sh(main, ['worktree', 'add', '-q', '-b', 'agent', wt, base]), 'wt');
  const marks = join(root, 'marks'); mkdirSync(marks);
  const script = (name) => { const p = join(root, `${name}.sh`); writeFileSync(p, `#!/bin/sh\ntouch "${marks}/${name}"\ncat "$@" 2>/dev/null\n`, { mode: 0o755 }); return p; };
  // What an agent can do from inside the worktree with its own tools: git config writes the shared repository config, .gitattributes is an ordinary file.
  const cfg = (k, v) => must(sh(wt, ['config', k, v]), `config ${k}`);
  cfg('filter.evil.clean', script('clean')); cfg('filter.evil.smudge', script('smudge'));
  cfg('diff.evil.textconv', script('textconv')); cfg('diff.external', script('external'));
  cfg('core.fsmonitor', script('fsmonitor')); cfg('core.hooksPath', join(root, 'hp'));
  mkdirSync(join(root, 'hp')); writeFileSync(join(root, 'hp/pre-commit'), `#!/bin/sh\ntouch "${marks}/hook"\n`, { mode: 0o755 });
  cfg('core.pager', script('pager')); cfg('diff.evil.command', script('diffcommand'));
  cfg('core.attributesFile', join(root, 'globalattrs')); writeFileSync(join(root, 'globalattrs'), '*.md diff=evil\n');
  write(join(wt, '.gitattributes'), '*.txt filter=evil diff=evil\n');
  write(join(wt, 'a.txt'), 'two\n'); write(join(wt, 'b.txt'), 'new\n'); write(join(wt, 'c.md'), 'md\n');
  const out = { gitConfigWrittenFromWorktree: must(sh(wt, ['config', '--local', '--get-regexp', '^(filter|diff|core\\.(fsmonitor|hookspath|pager|attributesfile))']), 'cfg list').split('\n').filter(Boolean).length > 0 };
  const seen = () => require_marks(marks);
  const reset = () => { for (const f of require_marks(marks)) rmSync(join(marks, f)); };
  // Unmitigated sequence.
  const un = sh(wt, ['add', '-A']); const un2 = sh(wt, ['commit', '-q', '-m', 'cp'], { env: AUTHOR });
  const cp1 = sh(wt, ['rev-parse', 'HEAD']).stdout.trim();
  sh(wt, ['diff', '--binary', base, cp1]);
  out.unmitigatedMarks = seen().sort(); out.unmitigatedCommitStatus = un2.status;
  reset(); sh(wt, ['diff', '--no-ext-diff', '--binary', base, cp1]); out.unmitigatedTextconvOnlyMarks = seen().sort();
  reset(); sh(wt, ['-c', 'core.pager=cat', 'diff', '--no-ext-diff', '--no-textconv', '--binary', base, cp1]); out.noTextconvMarks = seen().sort();
  // Mitigated: overrides on the command line, a fresh agent change, and the attribute source set to the base tree.
  reset();
  must(sh(main, ['reset', '-q', '--hard', 'agent'].slice(0, 0).concat(['status', '--porcelain'])), 'noop');
  write(join(wt, 'a.txt'), 'three\n'); write(join(wt, 'b.txt'), 'new2\n'); write(join(wt, 'c.md'), 'md2\n');
  const MIT = ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'commit.gpgsign=false', '-c', 'core.pager=cat', '-c', 'core.attributesFile=/dev/null'];
  const step = (label, args, env = {}) => { reset(); const r = sh(wt, args, { env }); return { label, status: r.status, marks: seen().sort(), stderr: r.stderr.slice(0, 160) }; };
  out.steps = [];
  out.steps.push(step('add -A with MIT overrides only', [...MIT, 'add', '-A']));
  out.steps.push(step('commit with MIT overrides, --no-verify', [...MIT, 'commit', '--no-verify', '-q', '-m', 'cp2'], AUTHOR));
  const cp2 = sh(wt, ['rev-parse', 'HEAD']).stdout.trim();
  out.steps.push(step('diff, MIT only', [...MIT, 'diff', '--binary', base, cp2]));
  out.steps.push(step('diff, MIT plus --no-ext-diff --no-textconv', [...MIT, 'diff', '--no-ext-diff', '--no-textconv', '--binary', base, cp2]));
  out.steps.push(step('diff with GIT_EXTERNAL_DIFF env set by agent-supplied environment', [...MIT, 'diff', '--no-ext-diff', '--no-textconv', '--binary', base, cp2], { GIT_EXTERNAL_DIFF: script('envext') }));
  out.steps.push(step('show --stat (porcelain-like read) with --no-ext-diff', [...MIT, 'show', '--no-ext-diff', '--no-textconv', '--stat', cp2]));
  // Clean filter when the attribute file is the one in the worktree: is there a switch that stops it?
  write(join(wt, 'a.txt'), 'four\n');
  out.steps.push(step('add with filters neutralised through GIT_CONFIG_COUNT (filter.evil.clean empty, process empty)', [...MIT, 'add', '-A'], { GIT_CONFIG_COUNT: '3', GIT_CONFIG_KEY_0: 'filter.evil.clean', GIT_CONFIG_VALUE_0: '', GIT_CONFIG_KEY_1: 'filter.evil.smudge', GIT_CONFIG_VALUE_1: '', GIT_CONFIG_KEY_2: 'filter.evil.required', GIT_CONFIG_VALUE_2: 'false' }));
  write(join(wt, 'a.txt'), 'five\n');
  out.steps.push(step('add with GIT_ATTR_SOURCE pointing at the base tree (attributes from the base commit, not the worktree)', [...MIT, '--attr-source', base, 'add', '-A']));
  out.steps.push(step('add with --attr-source and a non-attribute empty tree', [...MIT, '--attr-source', '4b825dc642cb6eb9a060e54bf8d69288fbee4904', 'add', '-A']));
  out.configInspection = sh(wt, ['config', '--local', '--list']).stdout.split('\n').filter((l) => /^(filter|diff|core\.(fsmonitor|hookspath|pager|attributesfile|sshcommand)|include)/i.test(l)).map((l) => l.split('=')[0]);
  out.worktreeGitFile = readFileSync(join(wt, '.git'), 'utf8').trim().replace(root, '<tmp>');
  cleanup(root);
  return out;
}
function require_marks(dir) { try { return spawnSync('ls', [dir], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean); } catch { return []; } }

const report = { git: spawnSync('git', ['--version'], { encoding: 'utf8' }).stdout.trim(), repo: await scenario('repo'), worktree: await scenario('worktree'), programs: await programs() };
save('p42_report.json', report);
console.log(JSON.stringify(report, null, 1).slice(0, 14000));
