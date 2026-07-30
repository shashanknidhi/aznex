import { test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { runMigrations, reposWithoutOrg } from './migrations.js';
import { ensureSchema } from './schema.js';
import { OrgRepository } from '../repositories/org.js';
import { RepoRepository } from '../repositories/repo.js';
import { UserRepository } from '../repositories/user.js';
import { MemoryRepository } from '../repositories/memory.js';
import { GithubInstallationRepository } from '../repositories/github-installation.js';

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

// A live single-tenant deployment at v2: full schema, real rows, no orgs and no
// repo.org_id. Reproduced by building the current schema and then stripping what
// v3 introduces, so the backfill runs against production-shaped data.
function preV3Database(): Database {
  const db = new Database(':memory:');
  db.run('PRAGMA foreign_keys = ON');
  ensureSchema(db);

  const users = new UserRepository(db);
  const alice = users.create({ github_id: '1', github_login: 'Alice', display_name: null, avatar_url: null, metadata: {} });
  users.create({ github_id: '2', github_login: 'bob', display_name: null, avatar_url: null, metadata: {} });
  new GithubInstallationRepository(db).create({
    installation_id: 42, account_type: 'org', account_login: 'acme', metadata: {},
  });
  const repos = new RepoRepository(db);
  repos.create({
    fingerprint: 'github.com/acme/widget', canonical: 'acme/widget', github_repo_id: '9001',
    github_installation_id: 42, org_id: null, status: 'active', metadata: {},
  });
  repos.create({
    fingerprint: 'github.com/acme/old', canonical: 'acme/old', github_repo_id: '9002',
    github_installation_id: 42, org_id: null, status: 'inactive', metadata: {},
  });
  new MemoryRepository(db).create({
    id: 'mem_1', repo_fingerprint: 'github.com/acme/widget', session_id: null, author_id: alice.id,
    agent: 'claude-code', kind: 'observation', type: 'extracted_learning',
    title: null, content: 'existing knowledge', narrative: null, facts: [], concepts: [],
    files_read: [], files_modified: [], ai_extracted: true, metadata: {},
  });

  db.run('DELETE FROM org_membership');
  db.run('DELETE FROM org');
  db.run('UPDATE repo SET org_id = NULL');
  return db;
}

test('v3 moves a live single-tenant deployment into one org without losing anything', () => {
  const db = preV3Database();
  process.env['AZNEX_ADMIN_GITHUB_LOGINS'] = 'Alice';
  try {
    runMigrations(db);
  } finally {
    delete process.env['AZNEX_ADMIN_GITHUB_LOGINS'];
  }

  const orgs = new OrgRepository(db);
  const pilot = orgs.getBySlug('pilot')!;
  expect(pilot.status).toBe('active');

  // Every repo joins the org — including the de-boarded one, so re-onboarding works.
  const repos = new RepoRepository(db);
  expect(repos.getByFingerprint('github.com/acme/widget')?.org_id).toBe(pilot.id);
  expect(repos.getByFingerprint('github.com/acme/old')?.org_id).toBe(pilot.id);
  expect(reposWithoutOrg(db)).toBe(0);

  // Every existing user keeps sign-in; the configured operator becomes org admin.
  expect(orgs.roleFor(pilot.id, 'alice')).toBe('admin');
  expect(orgs.roleFor(pilot.id, 'bob')).toBe('member');

  // No data touched.
  expect((db.prepare('SELECT COUNT(*) AS n FROM memory').get() as { n: number }).n).toBe(1);
  expect(new MemoryRepository(db).getById('mem_1')?.content).toBe('existing knowledge');
});

test('v3 is idempotent and does not re-seed on a second run', () => {
  const db = preV3Database();
  runMigrations(db);
  const orgs = new OrgRepository(db);
  const pilot = orgs.getBySlug('pilot')!;
  orgs.setMember(pilot.id, 'bob', 'admin'); // a change made after the migration

  runMigrations(db);
  expect(orgs.list().length).toBe(1);
  expect(orgs.roleFor(pilot.id, 'bob')).toBe('admin'); // not reset to member
});

test('v3 seeds nothing on a fresh database — the first org is created deliberately', () => {
  const db = new Database(':memory:');
  db.run('PRAGMA foreign_keys = ON');
  ensureSchema(db);
  runMigrations(db);
  expect(new OrgRepository(db).list()).toEqual([]);
  expect(reposWithoutOrg(db)).toBe(0);
});

test('v2 is idempotent and a no-op on a database that never had the columns', () => {
  const db = v1Database();
  runMigrations(db);
  runMigrations(db); // second call must not throw on already-dropped columns
  expect(columns(db, 'memory')).toEqual(['id', 'repo_fingerprint', 'content']);
  expect(db.prepare('SELECT version FROM schema_versions ORDER BY version').all()).toEqual([
    { version: 1 },
    { version: 2 },
    { version: 3 },
  ]);
});
