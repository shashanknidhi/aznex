import { test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { runMigrations } from './migrations.js';

// A pre-v2 `memory` table: the columns and indexes the deployed database still
// has, since ensureSchema's CREATE TABLE IF NOT EXISTS never rewrites it.
function v1Database(): Database {
  const db = new Database(':memory:');
  db.run(`
    CREATE TABLE memory (
      id TEXT PRIMARY KEY,
      repo_fingerprint TEXT NOT NULL,
      content TEXT NOT NULL,
      freshness_state TEXT NOT NULL DEFAULT 'fresh' CHECK(freshness_state IN ('fresh', 'stale_suspected')),
      promotion_state TEXT NOT NULL DEFAULT 'private' CHECK(promotion_state IN ('private', 'pending', 'team_shared')),
      confirmed_commit TEXT
    );
    CREATE TABLE memory_anchor (
      memory_id TEXT NOT NULL,
      path TEXT NOT NULL,
      commit_sha TEXT,
      PRIMARY KEY (memory_id, path)
    );
  `);
  db.run('CREATE INDEX idx_memory_promotion ON memory(promotion_state)');
  db.run('CREATE INDEX idx_memory_freshness ON memory(freshness_state)');
  return db;
}

function columns(db: Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((r) => r.name);
}

test('v2 drops the promotion/freshness columns and keeps every row', () => {
  const db = v1Database();
  db.run("INSERT INTO memory (id, repo_fingerprint, content, promotion_state) VALUES ('m1', 'github.com/a/b', 'kept', 'team_shared')");
  db.run("INSERT INTO memory (id, repo_fingerprint, content) VALUES ('m2', 'github.com/a/b', 'also kept')");
  db.run("INSERT INTO memory_anchor (memory_id, path, commit_sha) VALUES ('m1', 'src/a.ts', 'abc123')");

  runMigrations(db);

  expect(columns(db, 'memory')).toEqual(['id', 'repo_fingerprint', 'content']);
  expect(columns(db, 'memory_anchor')).toEqual(['memory_id', 'path']);
  expect(db.prepare('SELECT id, content FROM memory ORDER BY id').all()).toEqual([
    { id: 'm1', content: 'kept' },
    { id: 'm2', content: 'also kept' },
  ]);
  expect(db.prepare('SELECT * FROM memory_anchor').all()).toEqual([{ memory_id: 'm1', path: 'src/a.ts' }]);
});

test('v2 is idempotent and a no-op on a database that never had the columns', () => {
  const db = v1Database();
  runMigrations(db);
  runMigrations(db); // second call must not throw on already-dropped columns
  expect(columns(db, 'memory')).toEqual(['id', 'repo_fingerprint', 'content']);
  expect(db.prepare('SELECT version FROM schema_versions ORDER BY version').all()).toEqual([
    { version: 1 },
    { version: 2 },
  ]);
});
