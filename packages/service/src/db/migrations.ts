import { randomUUID } from 'crypto';
import { Database } from 'bun:sqlite';
import { hasColumn } from './schema.js';

function ensureMigrationsTable(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS schema_versions (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);
}

function hasTable(db: Database, table: string): boolean {
  return db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) != null;
}

function hasVersion(db: Database, version: number): boolean {
  return db.prepare('SELECT 1 FROM schema_versions WHERE version = ?').get(version) != null;
}

function markVersion(db: Database, version: number): void {
  db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(version, Date.now());
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

/**
 * v3 — multi-tenancy. `org` / `org_membership` / `repo.org_id` are created by
 * ensureSchema; what only a migration can do is move an existing single-tenant
 * deployment into an org without locking its users out.
 *
 * Every pre-existing repo joins one "pilot" org and every pre-existing user
 * becomes a member of it, because from this version on `authorizeRepo` requires
 * a membership row — an empty org table would 403 the whole live deployment.
 * Idempotent on its own (INSERT OR IGNORE / WHERE org_id IS NULL), not just via
 * the version guard.
 */
function seedDefaultOrg(db: Database): void {
  // ensureSchema always runs first in the real path, so these tables exist. A
  // caller that runs migrations against a partial database gets a skip, not a crash.
  if (!hasTable(db, 'repo') || !hasTable(db, 'user') || !hasTable(db, 'org')) return;

  const repoCount = (db.prepare('SELECT COUNT(*) AS n FROM repo').get() as { n: number }).n;
  const userCount = (db.prepare('SELECT COUNT(*) AS n FROM user').get() as { n: number }).n;
  // A fresh database has nothing to rescue; leave it clean so the first org is
  // created deliberately (admin-cli add-org or POST /api/admin/orgs).
  if (repoCount === 0 && userCount === 0) return;

  const superAdmins = (process.env['AZNEX_ADMIN_GITHUB_LOGINS'] ?? '')
    .split(',')
    .map((l) => l.trim().toLowerCase())
    .filter(Boolean);

  db.transaction(() => {
    const now = Date.now();
    const existing = db.prepare("SELECT id FROM org WHERE slug = 'pilot'").get() as { id: string } | null;
    const orgId = existing?.id ?? randomUUID();
    if (!existing) {
      db.prepare(`
        INSERT INTO org (id, slug, name, status, metadata, created_at_epoch, updated_at_epoch)
        VALUES (?, 'pilot', 'Pilot', 'active', '{}', ?, ?)
      `).run(orgId, now, now);
    }

    db.prepare('UPDATE repo SET org_id = ?, updated_at_epoch = ? WHERE org_id IS NULL').run(orgId, now);

    const logins = db.prepare('SELECT DISTINCT github_login FROM user').all() as { github_login: string }[];
    const insertMember = db.prepare(`
      INSERT OR IGNORE INTO org_membership (org_id, github_login, role, invited_by_login, created_at_epoch, updated_at_epoch)
      VALUES (?, ?, ?, NULL, ?, ?)
    `);
    for (const { github_login } of logins) {
      const login = github_login.toLowerCase();
      insertMember.run(orgId, login, superAdmins.includes(login) ? 'admin' : 'member', now, now);
    }
    // A super admin who already had a member row gets promoted — they were the
    // operator of this deployment before orgs existed.
    for (const login of superAdmins) {
      db.prepare('UPDATE org_membership SET role = ?, updated_at_epoch = ? WHERE org_id = ? AND github_login = ?')
        .run('admin', now, orgId, login);
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
  if (!hasVersion(db, 3)) {
    if (hasTable(db, 'repo') && !hasColumn(db, 'repo', 'org_id')) {
      db.run('ALTER TABLE repo ADD COLUMN org_id TEXT');
    }
    seedDefaultOrg(db);
    markVersion(db, 3);
  }
}

/**
 * Post-migration integrity signal: an active repo with no org is denied by
 * authorizeRepo, so it is an outage for that repo, not a silent widening.
 * Surfaced on /health so a bad deploy is visible instead of mysterious 403s.
 */
export function reposWithoutOrg(db: Database): number {
  if (!hasTable(db, 'repo')) return 0;
  return (
    db.prepare("SELECT COUNT(*) AS n FROM repo WHERE status = 'active' AND org_id IS NULL").get() as {
      n: number;
    }
  ).n;
}
