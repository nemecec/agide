import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { captureFixture, changesetRecord, policySnapshot, sha256Of } from '../fakes/fixtures';
import { openStore } from '../../store/Store';
import { ReviewError } from '../types';
import { sqliteHarness } from './sqliteHarness';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const policy = policySnapshot();
const rows = () => changesetRecord(captureFixture({ seed: 'persist', policyHash: policy.hash, files: [{ path: 'src/a.ts', hunks: [' a\n-b\n+c', '+d'] }] }));

describe('sqlite changeset store', () => {
  it('keeps every record, the diff text included, across closing and reopening the database file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'review-store-'));
    dirs.push(dir);
    const file = join(dir, 'app.db');
    const first = sqliteHarness(openStore(file));
    first.store.putPolicy(policy);
    const { changeset, files, hunks } = rows();
    first.store.insert(changeset, files, hunks);
    first.store.addReasons(changeset.id, [{ id: 'file.binary', subject: 'a.png', source: 'rule', evidence: { size: 3 }, minRung: 'B', hard: false }], '2026-11-21T10:00:00.000Z');
    first.close();

    const second = sqliteHarness(openStore(file));
    expect(second.store.get(changeset.id), 'the changeset').toEqual(changeset);
    expect(second.store.hunks(changeset.id).map((hunk) => hunk.body), 'the hunk text is in the database, not in a work tree or a patch file').toEqual([' a\n-b\n+c', '+d']);
    expect(second.store.reasons(changeset.id).map((reason) => [reason.id, reason.evidence]), 'the reasons').toEqual([['file.binary', { size: 3 }]]);
    expect(second.store.policy(policy.hash)?.effective, 'the policy the swarm was captured under').toEqual(policy.effective);
    second.close();
  });

  it('lets only one of two writers move a changeset out of a state', () => {
    const { store, db, close } = sqliteHarness();
    store.putPolicy(policy);
    const { changeset, files, hunks } = rows();
    store.insert(changeset, files, hunks);
    const other = sqliteHarness(db).store;
    const decision = (id: string) => ({ id, changesetId: changeset.id, actor: 'app' as const, actorSessionId: null, action: 'start_check' as const, fromState: 'captured' as const, toState: 'checking' as const, fromRung: 'A' as const, toRung: 'A' as const, contentHash: sha256Of('x'), reason: null, createdAt: '2026-11-21T10:00:00.000Z' });
    expect(store.applyDecision(decision('d1'), { state: 'checking', rung: 'A', floor: 'A' })?.state, 'the first writer moved it').toBe('checking');
    expect(other.applyDecision(decision('d2'), { state: 'checking', rung: 'A', floor: 'A' }), 'the second writer, who read the old state, wrote nothing').toBeUndefined();
    expect(store.decisions(changeset.id).map((row) => row.id), 'one decision row').toEqual(['d1']);
    close();
  });

  it('answers a violated constraint with a refusal, not a crash, and rolls the whole insert back', () => {
    const { store, close } = sqliteHarness();
    store.putPolicy(policy);
    const { changeset, files, hunks } = rows();
    store.insert(changeset, files, hunks);
    const again = changesetRecord(captureFixture({ seed: 'persist', policyHash: policy.hash }), 2);
    expect(() => store.insert(again.changeset, again.files, again.hunks), 'a used id').toThrow(ReviewError);
    expect(store.latest('sw1', 'worker')?.seq, 'the first changeset is the latest').toBe(1);
    const broken = changesetRecord(captureFixture({ seed: 'rollback', policyHash: policy.hash }), 2);
    expect(() => store.insert(broken.changeset, [...broken.files, broken.files[0]!], broken.hunks), 'a file index twice').toThrow(ReviewError);
    expect(store.get(broken.changeset.id), 'nothing of the failed insert is stored').toBeUndefined();
    close();
  });
});
