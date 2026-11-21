// README: node p36_worktrees.mjs  -- P36 worktrees: a temporary repository under probes/work/, git worktree add into a second temporary directory, a haiku agent (stream-json, acceptEdits) edits and adds files there, the host collects the diff (git diff, status, intent-to-add, get_workspace_diff control request), and git worktree remove is tried with uncommitted changes, with --force and when clean. Budget-capped, no network.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { startStream, userMsg, resultsOf, save, sleep, fresh, cleanup, dump, brief, control, answerPrompts, toolUses } from './p_swarm_lib.mjs';

const report = {};
const GIT = ['-c', 'user.name=probe', '-c', 'user.email=probe@example.invalid', '-c', 'commit.gpgsign=false'];
const git = (cwd, ...a) => { try { return { ok: true, out: execFileSync('git', [...GIT, ...a], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }; } catch (e) { return { ok: false, out: String(e.stdout || ''), err: String(e.stderr || e.message) }; } };
const norm = (s, ...paths) => paths.reduce((t, p) => t.split(p).join('<dir>'), String(s ?? ''));

const base = fresh('p36-');
const repo = realpathSync(base);
const wtParent = fresh('p36-wt-');
const wt = join(realpathSync(wtParent), 'agent-1');
try {
  git(repo, 'init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'hello.txt'), 'hello\n');
  writeFileSync(join(repo, 'keep.txt'), 'keep\n');
  git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'init');
  const add = git(repo, 'worktree', 'add', '-q', '-b', 'agent/agent-1', wt, 'HEAD');
  report.worktree_add = { ok: add.ok, err: norm(add.err, repo, wt), list: norm(git(repo, 'worktree', 'list', '--porcelain').out, repo, wt), gitfile_in_worktree: norm(readFileSync(join(wt, '.git'), 'utf8'), repo, wt).trim() };

  const h = startStream(['--permission-mode', 'acceptEdits', '--permission-prompt-tool', 'stdio', '--strict-mcp-config', '--settings', '{"disableAllHooks":true}', '--tools', 'Read,Write,Edit,Bash'], { cwd: wt });
  const ans = answerPrompts(h, (r) => ({ behavior: 'allow', updatedInput: r.input }));
  h.send(userMsg('Edit hello.txt so that it contains the line "hello from agent" and create a new file notes.txt with the text "agent notes". Do not touch anything else. Reply: done'));
  await h.waitResult(1, 90000);
  const init = h.events.find((e) => e.subtype === 'init');
  report.agent = { result: brief(resultsOf(h.events)[0]), init_cwd_is_worktree: init?.cwd === wt, tool_uses: toolUses(h.events).map((u) => u.name), prompts: ans.seen.map((s) => s.tool_name) };
  const gd = await control(h, { subtype: 'get_workspace_diff' });
  const d = gd.response?.response?.diff;
  report.get_workspace_diff = { answered: gd.answered, subtype: gd.response?.subtype, stats: d?.stats, per_file: d?.perFileStats, source: d?.source, untracked_included: JSON.stringify(d || {}).includes('notes.txt'), hunk_keys: d?.hunks?.[0] && Object.keys(d.hunks[0]) };
  ans.stop(); await h.end(); dump('p36_agent', h);

  report.main_checkout_untouched = { status: git(repo, 'status', '--porcelain').out, hello: readFileSync(join(repo, 'hello.txt'), 'utf8') };
  const st = git(wt, 'status', '--porcelain=v1').out;
  const diffTracked = git(wt, 'diff').out;
  report.collect = { status_porcelain: st, git_diff_tracked_only: diffTracked.split('\n').filter((l) => /^[+-][^+-]/.test(l)), untracked_in_plain_diff: diffTracked.includes('notes.txt') };
  git(wt, 'add', '-N', '.');
  const diffN = git(wt, 'diff', '--stat', 'HEAD');
  const patch = git(wt, 'diff', 'HEAD').out;
  report.collect.after_intent_to_add = { stat: diffN.out, patch_has_notes: patch.includes('notes.txt'), patch_has_new_file_mode: patch.includes('new file mode') };
  report.collect.numstat = git(wt, 'diff', '--numstat', 'HEAD').out;
  report.collect.untracked_via_ls_files = git(wt, 'ls-files', '--others', '--exclude-standard').out;

  // removal behaviour
  const r1 = git(repo, 'worktree', 'remove', wt);
  report.remove_dirty = { ok: r1.ok, err: norm(r1.err, repo, wt), dir_still_exists: existsSync(wt) };
  git(wt, 'add', '-A');
  const r1b = git(repo, 'worktree', 'remove', wt);
  report.remove_staged = { ok: r1b.ok, err: norm(r1b.err, repo, wt), dir_still_exists: existsSync(wt) };
  const lock = git(repo, 'worktree', 'lock', '--reason', 'agent running', wt);
  const r1c = git(repo, 'worktree', 'remove', '--force', wt);
  report.remove_force_on_locked = { lock_ok: lock.ok, ok: r1c.ok, err: norm(r1c.err, repo, wt), dir_still_exists: existsSync(wt) };
  git(repo, 'worktree', 'unlock', wt);
  const r2 = git(repo, 'worktree', 'remove', '--force', wt);
  report.remove_force = { ok: r2.ok, err: norm(r2.err, repo, wt), dir_still_exists: existsSync(wt), branch_still_exists: git(repo, 'branch', '--list', 'agent/agent-1').out.trim(), branch_has_commits_beyond_main: git(repo, 'rev-list', '--count', 'main..agent/agent-1').out.trim() === '0' ? false : true, stash_empty_so_edits_are_lost: git(repo, 'stash', 'list').out === '' };
  // clean worktree removal and the commit-first path
  const wt2 = join(realpathSync(wtParent), 'agent-2');
  git(repo, 'worktree', 'add', '-q', '-b', 'agent/agent-2', wt2, 'HEAD');
  writeFileSync(join(wt2, 'hello.txt'), 'changed by agent 2\n');
  git(wt2, 'commit', '-qam', 'agent 2 work');
  const r3 = git(repo, 'worktree', 'remove', wt2);
  report.remove_committed_clean = { ok: r3.ok, err: norm(r3.err, repo, wt2), dir_still_exists: existsSync(wt2), branch_diff_vs_main: git(repo, 'diff', '--stat', 'main...agent/agent-2').out };
  // a worktree directory deleted by hand, then prune
  const wt3 = join(realpathSync(wtParent), 'agent-3');
  git(repo, 'worktree', 'add', '-q', '-b', 'agent/agent-3', wt3, 'HEAD');
  cleanup(wt3);
  report.deleted_by_hand = { list_shows_prunable: /prunable/.test(git(repo, 'worktree', 'list', '--porcelain').out), prune: git(repo, 'worktree', 'prune').ok, list_after_prune_has_agent3: /agent-3/.test(git(repo, 'worktree', 'list').out), branch_remains: git(repo, 'branch', '--list', 'agent/agent-3').out.trim() };
  report.git_version = git(repo, '--version').out.trim();
} catch (e) { report.error = String(e?.stack || e); }
save('p36_report.json', norm(JSON.stringify(report, null, 1), repo, wtParent));
cleanup(wtParent); cleanup(base);
console.log(norm(JSON.stringify(report, null, 1), repo, wtParent).replace(/"(in|out|cache_read|cache_create)": \d+,?\n/g, ''));
