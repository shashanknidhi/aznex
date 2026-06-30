import { Database } from 'bun:sqlite';
import { ensureSchema } from './schema.js';
import { runMigrations } from './migrations.js';

export function openDatabase(path = process.env['DATABASE_PATH'] ?? process.env['AZNEX_DB_PATH'] ?? 'aznex.db'): Database {
  const db = new Database(path);
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA synchronous = NORMAL');
  db.run('PRAGMA foreign_keys = ON');
  db.run('PRAGMA journal_size_limit = 4194304');
  ensureSchema(db);
  runMigrations(db);
  return db;
}
