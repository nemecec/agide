import { describe, expect, it } from 'vitest';
import { migrate, openStore, type Database } from '../store/index';
import { treeMigrations, TREE_MODULE } from '../tree/treeMigrations';
import { INBOX_MODULE, inboxMigrations, TASKS_MODULE, taskMigrations } from './inboxMigrations';

function fresh(upTo: number): Database {
  const db = openStore(':memory:');
  migrate(db, TREE_MODULE, treeMigrations);
  migrate(db, INBOX_MODULE, inboxMigrations.filter((migration) => migration.version <= upTo));
  return db;
}

const refused = (db: Database, sql: string, ...values: (string | number | null)[]): boolean => {
  try {
    db.prepare(sql).run(...values);
    return false;
  } catch {
    return true;
  }
};

function item(db: Database, id: string): void {
  db.prepare(
    "INSERT INTO inbox_items (id, kind, source, origin, message, text_author, created_at, updated_at) VALUES (?, 'input', 'agent', 'mcp:inbox_ask', 'Ship it?', 'agent', 't', 't')",
  ).run(id);
}

const ASK = "INSERT INTO inbox_asks (item_id, session_id, options, allow_free_text, wait, timeout_at, call_state, answer_choice, answered_at) VALUES (?, 's', '[]', 1, 1, 't', ?, ?, ?)";

describe('inbox migration 2', () => {
  it('moves a database of migration 1 on without losing items or summaries', () => {
    const db = fresh(1);
    item(db, 'i1');
    db.prepare("INSERT INTO session_summaries (session_id, summary, generated_at) VALUES ('s', 'Fixed the build', 't')").run();
    expect(migrate(db, INBOX_MODULE, inboxMigrations), 'the module reaches the last version').toBe(inboxMigrations.length);
    expect(db.prepare('SELECT count(*) AS n FROM inbox_items').get(), 'the item is still there').toEqual({ n: 1 });
    expect(db.prepare('SELECT summary, turns_at, transcript_bytes_at FROM session_summaries').get(), 'the summary has empty counters').toEqual({
      summary: 'Fixed the build',
      turns_at: null,
      transcript_bytes_at: null,
    });
    expect(migrate(db, INBOX_MODULE, inboxMigrations), 'a second run changes nothing').toBe(inboxMigrations.length);
  });

  it('refuses an answered ask without an answer, and an ask with an unknown call state or delivery', () => {
    const db = fresh(2);
    item(db, 'i1');
    expect(refused(db, ASK, 'i1', 'returned', null, 'now'), 'an answer time without an answer').toBe(true);
    expect(refused(db, ASK, 'i1', 'frozen', null, null), 'an unknown call state').toBe(true);
    expect(refused(db, ASK, 'i1', 'returned', 'yes', 'now'), 'a choice with an answer time').toBe(false);
    expect(refused(db, "UPDATE inbox_asks SET delivery = 'telepathy'"), 'an unknown delivery').toBe(true);
    expect(refused(db, "UPDATE inbox_asks SET answer_text = ?", 'x'.repeat(4001)), 'an answer text above 4000 characters').toBe(true);
  });

  it('keeps the tool use id of the call with the ask', () => {
    const db = fresh(2);
    item(db, 'i1');
    db.prepare(ASK).run('i1', 'waiting', null, null);
    expect(db.prepare('SELECT tool_use_id FROM inbox_asks').get(), 'a new ask has no tool use id until the service sets it').toEqual({ tool_use_id: null });
    db.prepare("UPDATE inbox_asks SET tool_use_id = 'toolu_1'").run();
    expect(db.prepare('SELECT tool_use_id FROM inbox_asks').get(), 'the id is stored').toEqual({ tool_use_id: 'toolu_1' });
  });

  it('removes an ask with its item', () => {
    const db = fresh(2);
    item(db, 'i1');
    db.prepare(ASK).run('i1', 'waiting', null, null);
    db.prepare("DELETE FROM inbox_items WHERE id = 'i1'").run();
    expect(db.prepare('SELECT count(*) AS n FROM inbox_asks').get(), 'the ask went with the item').toEqual({ n: 0 });
  });

  it('removes a view with its folder and refuses a view without a name or with an unknown sort', () => {
    const db = fresh(2);
    db.prepare("INSERT INTO tree_nodes (id, parent_id, kind, title, position) VALUES ('f1', NULL, 'folder', 'P', 0)").run();
    const view = "INSERT INTO inbox_views (id, name, folder_id, filter, sort, position) VALUES (?, ?, 'f1', '{}', ?, 0)";
    expect(refused(db, view, 'v1', '', 'time'), 'an empty name').toBe(true);
    expect(refused(db, view, 'v1', 'Mine', 'random'), 'an unknown sort').toBe(true);
    expect(refused(db, view, 'v1', 'Mine', 'project'), 'a valid view').toBe(false);
    db.prepare("DELETE FROM tree_nodes WHERE id = 'f1'").run();
    expect(db.prepare('SELECT count(*) AS n FROM inbox_views').get(), 'the view went with its folder').toEqual({ n: 0 });
  });

  it('keeps turn counters of a session non-negative', () => {
    const db = fresh(2);
    expect(refused(db, "INSERT INTO session_activity (session_id, turns, updated_at) VALUES ('s', -1, 't')"), 'a negative count').toBe(true);
    expect(refused(db, "INSERT INTO session_activity (session_id, turns, updated_at) VALUES ('s', 3, 't')"), 'a count').toBe(false);
  });

  it('leaves the tasks module on top of it unchanged', () => {
    const db = fresh(2);
    expect(migrate(db, TASKS_MODULE, taskMigrations), 'the tasks tables still follow').toBe(taskMigrations.length);
  });
});
