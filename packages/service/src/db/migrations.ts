import { Database } from 'bun:sqlite';

function ensureMigrationsTable(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS schema_versions (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);
}

function hasVersion(db: Database, version: number): boolean {
  return db.prepare('SELECT 1 FROM schema_versions WHERE version = ?').get(version) != null;
}

function markVersion(db: Database, version: number): void {
  db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(version, Date.now());
}

function hasColumn(db: Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return rows.some((r) => r.name === column);
}

/**
 * v2 — drop promotion_state, freshness_state, confirmed_commit and
 * memory_anchor.commit_sha. Every memory is team-visible on ingest and there is
 * no staleness engine, so these only ever hid memory. `ensureSchema` uses
 * CREATE TABLE IF NOT EXISTS, so an already-deployed table keeps its columns
 * until something drops them explicitly — that something is here.
 *
 * SQLite allows DROP COLUMN through a column-level CHECK (verified on the
 * bundled version) but not through an index, so the two indexes go first.
 * Triggers survive DROP COLUMN because none of them reference these columns.
 */
function dropPromotionAndFreshness(db: Database): void {
  db.transaction(() => {
    db.run('DROP INDEX IF EXISTS idx_memory_promotion');
    db.run('DROP INDEX IF EXISTS idx_memory_freshness');
    for (const column of ['promotion_state', 'freshness_state', 'confirmed_commit']) {
      if (hasColumn(db, 'memory', column)) db.run(`ALTER TABLE memory DROP COLUMN ${column}`);
    }
    if (hasColumn(db, 'memory_anchor', 'commit_sha')) {
      db.run('ALTER TABLE memory_anchor DROP COLUMN commit_sha');
    }
  })();
}

export function runMigrations(db: Database): void {
  ensureMigrationsTable(db);
  // v1 = initial schema (all 9 tables). Future structural changes (ADD COLUMN,
  // new index, etc.) get a new version number and a guarded method here.
  if (!hasVersion(db, 1)) markVersion(db, 1);
  if (!hasVersion(db, 2)) {
    dropPromotionAndFreshness(db);
    markVersion(db, 2);
  }
}
