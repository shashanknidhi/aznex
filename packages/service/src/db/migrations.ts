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

export function runMigrations(db: Database): void {
  ensureMigrationsTable(db);
  // v1 = initial schema (all 9 tables). Future structural changes (ADD COLUMN,
  // new index, etc.) get a new version number and a guarded method here.
  if (!hasVersion(db, 1)) markVersion(db, 1);
}
