import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { migrate, openStore } from '../../store/Store';
import { SWARM_MODULE, swarmMigrations } from '../../swarm/manager/swarmMigrations';
import { describeChangesetStoreContract, describeTestRunStoreContract } from './changesetStoreContract';
import { InMemoryChangesetStore } from './InMemoryChangesetStore';
import { REVIEW_MODULE, reviewMigrations } from './reviewMigrations';
import { sqliteHarness } from './sqliteHarness';

describeChangesetStoreContract('in-memory store', async () => ({ store: new InMemoryChangesetStore(), close: () => undefined }));

describeChangesetStoreContract('sqlite store', async () => sqliteHarness());

describeTestRunStoreContract('in-memory store', async () => ({ store: new InMemoryChangesetStore(), close: () => undefined }));

describe('review migration', () => {
  it('applies after the tree and swarm migrations and refuses rows the design forbids', () => {
    const db: DatabaseSync = openStore(':memory:');
    db.exec('CREATE TABLE tree_nodes (id TEXT PRIMARY KEY)');
    migrate(db, SWARM_MODULE, swarmMigrations);
    expect(migrate(db, REVIEW_MODULE, reviewMigrations), 'the review module is at version 2').toBe(2);
    db.exec(
      "INSERT INTO review_policies (hash, source, repo_path, base_commit, effective_json, created_at) VALUES ('p', 'default', '/r', 'b', '{}', 't')",
    );
    const insert = (rung: string, floor: string) =>
      db
        .prepare(
          `INSERT INTO review_changesets (id, swarm_id, agent, session_id, seq, trigger, repo_path, common_dir, base_commit, head_commit,
             checkpoint_commit, checkpoint_tree, content_hash, policy_hash, patch_path, file_count, added, removed, worker_tier,
             telemetry, state, rung, floor, created_at, updated_at)
           VALUES (?, 's', 'a', 'x', ?, 'quiet-result', '/r', '/r/.git', 'b', 'h', 'c', 't', 'h', 'p', 'p.patch', 0, 0, 0, 'mid',
             '{}', 'captured', ?, ?, 't', 't')`,
        )
        .run(`cs_${rung}${floor}`, rung.charCodeAt(0), rung, floor);
    expect(() => insert('C', 'B'), 'a rung above the floor is stored').not.toThrow();
    expect(() => insert('A', 'C'), 'a rung below the floor is refused').toThrow();
    expect(() => db.exec("INSERT INTO review_decisions (id, changeset_id, actor, action, from_state, to_state, from_rung, to_rung, content_hash, created_at) VALUES ('d', 'cs_CB', 'app', 'undeliverable', 'sent_back', 'awaiting_human', 'C', 'C', 'h', 't')"), 'the actions added by 0041 are allowed').not.toThrow();
    expect(() => db.exec("INSERT INTO review_decisions (id, changeset_id, actor, action, from_state, to_state, from_rung, to_rung, content_hash, created_at) VALUES ('f', 'cs_CB', 'robot', 'accept', 'in_review', 'accepted', 'C', 'C', 'h', 't')"), 'an unknown actor is refused').toThrow();
    expect(() => db.prepare('SELECT policy_hash, base_differs FROM review_repo_snapshots').all(), 'the swarm policy on the repository snapshot').not.toThrow();
    expect(() => db.prepare('SELECT prompt_version FROM review_runs').all(), 'the prompt version on a run').not.toThrow();
    db.close();
  });
});
