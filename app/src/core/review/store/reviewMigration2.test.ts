import { describe, expect, it } from 'vitest';
import { migrate, openStore, type Database } from '../../store/Store';
import { SWARM_MODULE, swarmMigrations } from '../../swarm/manager/swarmMigrations';
import { REVIEW_MODULE, reviewMigrations } from './reviewMigrations';

const T = '2026-11-28T10:00:00.000Z';

function database(version: number): Database {
  const db = openStore(':memory:');
  db.exec('CREATE TABLE tree_nodes (id TEXT PRIMARY KEY)');
  migrate(db, SWARM_MODULE, swarmMigrations);
  migrate(db, REVIEW_MODULE, reviewMigrations.slice(0, version));
  db.exec("INSERT INTO review_policies (hash, source, repo_path, base_commit, effective_json, created_at) VALUES ('p', 'default', '/r', 'b', '{}', 't')");
  return db;
}

const swarm = (db: Database, id: string): void => {
  db.prepare("INSERT INTO swarms (id, depth, definition, state, usd_total, created_at, updated_at) VALUES (?, 0, '{}', 'running', 1, 't', 't')").run(id);
};
const changeset = (db: Database, id: string): void => {
  db.prepare(
    `INSERT INTO review_changesets (id, swarm_id, agent, session_id, seq, trigger, repo_path, common_dir, base_commit, head_commit, checkpoint_commit, checkpoint_tree,
       content_hash, policy_hash, patch_path, file_count, added, removed, worker_tier, telemetry, state, rung, floor, created_at, updated_at)
     VALUES (?, 's', 'a', 'x', 1, 'quiet-result', '/r', '/r/.git', 'b', 'h', 'c', 't', 'h', 'p', 'p.patch', 0, 0, 0, 'mid', '{}', 'captured', 'A', 'A', 't', 't')`,
  ).run(id);
};
const check = (db: Database, id: string, changesetId: string | null, rerunOf: string | null = null): void => {
  db.prepare(
    `INSERT INTO review_checks (id, changeset_id, target, commit_id, policy_hash, command, outcome, started_at, ended_at, rerun_of)
     VALUES (?, ?, ?, 'c', 'p', '[]', 'failed', 't', 't', ?)`,
  ).run(id, changesetId, changesetId === null ? 'base' : 'checkpoint', rerunOf);
};
const job = (db: Database, id: string, state: string, swarmId = 's', commit = 'c'): void => {
  db.prepare('INSERT INTO review_base_jobs (id, swarm_id, commit_id, policy_hash, trigger, state, requested_at, ended_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    id,
    swarmId,
    commit,
    'p',
    'swarm_start',
    state,
    T,
    ['queued', 'running', 'confirming'].includes(state) ? null : T,
  );
};
const count = (db: Database, table: string): number => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

describe('review migration 2', () => {
  it('keeps the rows of a database at version 1 and gives its checks an empty rerun', () => {
    const db = database(1);
    changeset(db, 'cs_1');
    db.prepare(
      "INSERT INTO review_checks (id, changeset_id, target, commit_id, policy_hash, command, outcome, started_at, ended_at) VALUES ('chk_1', 'cs_1', 'checkpoint', 'c', 'p', '[]', 'failed', 't', 't')",
    ).run();
    expect(migrate(db, REVIEW_MODULE, reviewMigrations), 'the module moves to version 2').toBe(2);
    expect(db.prepare('SELECT id, rerun_of FROM review_checks').all(), 'the check of version 1 is kept with no rerun').toEqual([{ id: 'chk_1', rerun_of: null }]);
    expect(count(db, 'review_base_jobs') + count(db, 'review_test_runs') + count(db, 'review_baselines'), 'the migration adds no rows').toBe(0);
    db.close();
  });

  it('has no foreign key from a base job to a swarm, so deleting a swarm that requested a job succeeds', () => {
    const db = database(2);
    expect(db.prepare("PRAGMA foreign_key_list('review_base_jobs')").all(), 'review_base_jobs refers to no table').toEqual([]);
    swarm(db, 's1');
    job(db, 'bjob_1', 'green', 's1');
    db.prepare('INSERT INTO review_base_job_swarms (job_id, swarm_id) VALUES (?, ?)').run('bjob_1', 's1');
    expect(() => db.prepare('DELETE FROM swarms WHERE id = ?').run('s1'), 'the swarm is deleted').not.toThrow();
    expect(count(db, 'review_base_jobs'), 'the job outlives the swarm row').toBe(1);
    expect(count(db, 'review_base_job_swarms'), 'the membership row goes with the swarm').toBe(0);
    expect(() => job(db, 'bjob_2', 'green', 'no-such-swarm', 'd'), 'a job may name a swarm that has no row').not.toThrow();
    db.close();
  });

  it('refuses a membership of an unknown swarm or an unknown job', () => {
    const db = database(2);
    swarm(db, 's1');
    job(db, 'bjob_1', 'green', 's1');
    expect(() => db.prepare('INSERT INTO review_base_job_swarms (job_id, swarm_id) VALUES (?, ?)').run('bjob_1', 'missing'), 'a swarm without a row').toThrow();
    expect(() => db.prepare('INSERT INTO review_base_job_swarms (job_id, swarm_id) VALUES (?, ?)').run('missing', 's1'), 'a job without a row').toThrow();
    db.close();
  });

  it('allows one open job per pair and ties the end time to the state', () => {
    const db = database(2);
    job(db, 'bjob_1', 'queued');
    expect(() => job(db, 'bjob_2', 'running'), 'a second open job of the pair').toThrow();
    expect(() => job(db, 'bjob_3', 'running', 's', 'other'), 'an open job of another pair').not.toThrow();
    db.prepare("UPDATE review_base_jobs SET state = 'green', ended_at = ? WHERE id = 'bjob_1'").run(T);
    expect(() => job(db, 'bjob_4', 'queued'), 'an open job after the earlier one ended').not.toThrow();
    expect(() => db.prepare("UPDATE review_base_jobs SET state = 'red' WHERE id = 'bjob_4'").run(), 'a final state without an end time').toThrow();
    expect(() => db.prepare("UPDATE review_base_jobs SET ended_at = ? WHERE id = 'bjob_3'").run(T), 'an end time on an open job').toThrow();
    expect(() => db.prepare("UPDATE review_base_jobs SET state = 'paused' WHERE id = 'bjob_3'").run(), 'a state outside the list').toThrow();
    expect(() => db.prepare("UPDATE review_base_jobs SET trigger = 'robot' WHERE id = 'bjob_3'").run(), 'a trigger outside the list').toThrow();
    db.close();
  });

  it('removes the test runs and failures of a check with the check, and the checks of a changeset with it', () => {
    const db = database(2);
    changeset(db, 'cs_1');
    check(db, 'chk_1', 'cs_1');
    db.prepare("INSERT INTO review_test_runs (check_id, source, status, executed, passed, failed) VALUES ('chk_1', 'junit', 'parsed', 3, 2, 1)").run();
    db.prepare("INSERT INTO review_test_failures (check_id, test_key, suite, name, status) VALUES ('chk_1', ?, 's', 'n', 'failed')").run('a'.repeat(64));
    db.prepare('DELETE FROM review_changesets WHERE id = ?').run('cs_1');
    expect(count(db, 'review_checks'), 'the check goes with its changeset').toBe(0);
    expect(count(db, 'review_test_runs'), 'the test run goes with its check').toBe(0);
    expect(count(db, 'review_test_failures'), 'the failures go with their check').toBe(0);
    db.close();
  });

  it('empties the rerun of a check whose first run is deleted', () => {
    const db = database(2);
    check(db, 'chk_first', null);
    check(db, 'chk_second', null, 'chk_first');
    expect(() => check(db, 'chk_third', null, 'chk_missing'), 'a rerun of a check that does not exist').toThrow();
    db.prepare("DELETE FROM review_checks WHERE id = 'chk_first'").run();
    expect(db.prepare("SELECT rerun_of FROM review_checks WHERE id = 'chk_second'").get(), 'the rerun is kept and names nothing').toEqual({ rerun_of: null });
    db.close();
  });

  it('refuses test rows the design forbids', () => {
    const db = database(2);
    check(db, 'chk_1', null);
    const run = (patch: string) => () => db.exec(`INSERT INTO review_test_runs (check_id, status, executed, passed, failed${patch}`);
    expect(run(") VALUES ('chk_1', 'parsed', 3, 2, 1)"), 'consistent counts').not.toThrow();
    db.exec('DELETE FROM review_test_runs');
    expect(run(") VALUES ('chk_1', 'parsed', 3, 2, 2)"), 'executed is passed plus failed').toThrow();
    expect(run(") VALUES ('chk_1', 'unread', 0, 0, 0)"), 'a status outside the list').toThrow();
    expect(run(`, refusal) VALUES ('chk_1', 'refused', 0, 0, 0, '${'x'.repeat(301)}')`), 'a refusal text over 300 characters').toThrow();
    expect(run(", sets) VALUES ('chk_1', 'parsed', 0, 0, 0, 'not json')"), 'failure sets that are not JSON').toThrow();
    expect(run(", sets) VALUES ('chk_1', 'parsed', 0, 0, 0, '{}')"), 'failure sets as JSON').not.toThrow();
    db.exec('DELETE FROM review_test_runs');
    expect(() => db.prepare("INSERT INTO review_test_failures (check_id, test_key, suite, name, status) VALUES ('chk_1', 'short', 's', 'n', 'failed')").run(), 'a key that is not 64 characters').toThrow();
    expect(() => db.prepare("INSERT INTO review_test_failures (check_id, test_key, suite, name, status) VALUES ('chk_1', ?, 's', 'n', 'passed')").run('b'.repeat(64)), 'a failure with status passed').toThrow();
    db.close();
  });

  it('ties a baseline to its job and refuses a state outside the list', () => {
    const db = database(2);
    const baseline = (jobId: string, state: string) =>
      db.prepare("INSERT INTO review_baselines (job_id, commit_id, policy_hash, state, executed, created_at) VALUES (?, 'c', 'p', ?, 3, ?)").run(jobId, state, T);
    expect(() => baseline('missing', 'clean'), 'a baseline of a job without a row').toThrow();
    job(db, 'bjob_1', 'green');
    expect(() => baseline('bjob_1', 'perfect'), 'a state outside the list').toThrow();
    expect(() => baseline('bjob_1', 'flaky'), 'a baseline of its job').not.toThrow();
    expect(() => baseline('bjob_1', 'clean'), 'a second baseline of one job').toThrow();
    db.close();
  });
});
