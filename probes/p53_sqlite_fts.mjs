// README: P53. Whether the `node:sqlite` driver of the app has FTS5 with the unicode61 and trigram tokenizers,
// external-content tables kept by triggers, bm25 ranking and snippets, and what indexing and searching 2000 notes
// of about 2 KB cost. Run with plain Node and with ELECTRON_RUN_AS_NODE=1 and the Electron binary.
// Output: probes/out/p53_sqlite_fts_<runtime>.json.
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { runtimeFacts, runtimeLabel, writeOut } from './p_notes_lib.mjs';

const NOTES = Number(process.env.P53_NOTES ?? 2000);
const WORDS = ['retry', 'uploader', 'timeout', 'schedule', 'reminder', 'battery', 'activation', 'review', 'merge', 'sandbox', 'õhtu', 'päev', 'naïve', 'Straße', 'mount', 'watcher'];

function body(i) {
  const words = [];
  const seed = createHash('sha256').update(`note-${i}`).digest();
  for (let w = 0; w < 300; w += 1) words.push(WORDS[seed[w % seed.length] % WORDS.length] + (w % 7 === 0 ? ` ${i}` : ''));
  return `# Note ${i}\n\n- [ ] item ${i}\n${words.join(' ')}\n`;
}

function tryExec(db, sql) {
  try {
    db.exec(sql);
    return 'ok';
  } catch (error) {
    return String(error.message);
  }
}

function main() {
  const db = new DatabaseSync(':memory:');
  const result = { facts: { ...runtimeFacts(), notes: NOTES } };
  result.compileOptions = db.prepare('PRAGMA compile_options').all().map((row) => Object.values(row)[0]).filter((o) => /FTS|JSON|ICU/.test(o));
  result.unicode61 = tryExec(db, "CREATE VIRTUAL TABLE t1 USING fts5(body, tokenize = 'unicode61 remove_diacritics 2')");
  result.trigram = tryExec(db, "CREATE VIRTUAL TABLE t2 USING fts5(body, tokenize = 'trigram')");

  db.exec(`
    CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL);
    CREATE VIRTUAL TABLE notes_fts USING fts5(title, body, content = 'notes', content_rowid = 'rowid', tokenize = 'unicode61 remove_diacritics 2');
    CREATE TRIGGER notes_ai AFTER INSERT ON notes BEGIN INSERT INTO notes_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body); END;
    CREATE TRIGGER notes_ad AFTER DELETE ON notes BEGIN INSERT INTO notes_fts(notes_fts, rowid, title, body) VALUES ('delete', old.rowid, old.title, old.body); END;
    CREATE TRIGGER notes_au AFTER UPDATE ON notes BEGIN
      INSERT INTO notes_fts(notes_fts, rowid, title, body) VALUES ('delete', old.rowid, old.title, old.body);
      INSERT INTO notes_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
    END;
  `);
  const insert = db.prepare('INSERT INTO notes (id, title, body) VALUES (?, ?, ?)');
  const t0 = performance.now();
  db.exec('BEGIN');
  for (let i = 0; i < NOTES; i += 1) insert.run(`n${i}`, `Note ${i}`, body(i));
  db.exec('COMMIT');
  result.indexMs = Math.round(performance.now() - t0);
  result.bodyBytes = body(1).length;

  const search = db.prepare(`
    SELECT n.id, snippet(notes_fts, 1, '[', ']', '…', 8) AS snip, bm25(notes_fts) AS rank
    FROM notes_fts JOIN notes n ON n.rowid = notes_fts.rowid
    WHERE notes_fts MATCH ? ORDER BY rank LIMIT 20`);
  const queries = { word: 'uploader', two: 'retry AND timeout', prefix: 'activ*', phrase: '"retry uploader"', diacriticFolded: 'ohtu', diacriticExact: 'õhtu', number: '1234', title: 'title:"Note 7"' };
  result.queries = {};
  for (const [name, q] of Object.entries(queries)) {
    const t = performance.now();
    try {
      const rows = search.all(q);
      result.queries[name] = { q, rows: rows.length, ms: Math.round((performance.now() - t) * 10) / 10, first: rows[0]?.snip?.slice(0, 80) ?? null };
    } catch (error) {
      result.queries[name] = { q, error: String(error.message) };
    }
  }
  result.userInputWithQuote = (() => { try { search.all('say "hi'); return 'accepted'; } catch (e) { return `error: ${e.message}`; } })();
  const quoted = (text) => text.split(/\s+/).filter(Boolean).map((w) => `"${w.replaceAll('"', '""')}"`).join(' ');
  result.userInputQuoted = (() => { try { return { q: quoted('say "hi retry'), rows: search.all(quoted('say "hi retry')).length }; } catch (e) { return `error: ${e.message}`; } })();

  const tu = performance.now();
  db.prepare('UPDATE notes SET body = ? WHERE id = ?').run('fresh text about zebras', 'n5');
  result.updateMs = Math.round((performance.now() - tu) * 10) / 10;
  result.afterUpdate = { zebra: search.all('zebras').map((r) => r.id), oldWordStillFindsN5: search.all('uploader').some((r) => r.id === 'n5') };
  db.prepare('DELETE FROM notes WHERE id = ?').run('n6');
  result.afterDelete = { n6Found: search.all('"Note 6"').some((r) => r.id === 'n6') };
  result.integrity = tryExec(db, "INSERT INTO notes_fts(notes_fts, rank) VALUES ('integrity-check', 1)");

  db.exec("CREATE VIRTUAL TABLE tri USING fts5(body, tokenize = 'trigram')");
  const insTri = db.prepare('INSERT INTO tri(body) VALUES (?)');
  const t3 = performance.now();
  db.exec('BEGIN');
  for (let i = 0; i < NOTES; i += 1) insTri.run(body(i));
  db.exec('COMMIT');
  result.trigramIndexMs = Math.round(performance.now() - t3);
  const t4 = performance.now();
  result.trigramSubstring = { rows: db.prepare("SELECT count(*) AS c FROM tri WHERE tri MATCH 'ploade'").get().c, ms: Math.round((performance.now() - t4) * 10) / 10 };
  result.dbPages = db.prepare('PRAGMA page_count').get();
  db.close();
  console.log(writeOut(`p53_sqlite_fts_${runtimeLabel()}.json`, result));
}

main();
